#Requires -Version 5.1
<#
.SYNOPSIS
    Generates and applies an Alembic migration against a local Postgres,
    starting the db container if needed and cleaning up afterward.
.PARAMETER Message
    The migration message, passed to `alembic revision --autogenerate -m`.
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = $ScriptDir
$ComposeDir = Join-Path $ScriptDir ".."

$dbWasRunning = $false

function Invoke-Cleanup {
    if (-not $script:dbWasRunning) {
        Write-Host "Cleaning up: stopping db (it was not running before this script)."
        Push-Location $ComposeDir
        try {
            docker compose stop db
        } finally {
            Pop-Location
        }
    } else {
        Write-Host "Leaving db running (it was already running before this script)."
    }
}

try {
    Push-Location $ComposeDir

    # --- Determine if db was already running BEFORE we touch anything ---
    $runningServices = docker compose ps --status running --services
    if ($runningServices -contains "db") {
        $dbWasRunning = $true
        Write-Host "db is already running - will leave it running afterward."
    } else {
        Write-Host "db is not running - starting it."
        docker compose up -d db
        if ($LASTEXITCODE -ne 0) {
            throw "docker compose up failed with exit code $LASTEXITCODE"
        }
    }

    # --- Wait for readiness using the container's own healthcheck ---
    Write-Host "Waiting for db to become healthy..."
    $maxAttempts = 30
    $attempts = 0
    while ($true) {
        $health = docker compose ps --format "{{.Health}}" db
        if ($health -eq "healthy") {
            break
        }
        $attempts++
        if ($attempts -ge $maxAttempts) {
            throw "db did not become healthy in time."
        }
        Start-Sleep -Seconds 1
    }
    Write-Host "db is healthy."

    # --- Load env vars for host-side tooling from ../.env ---
    $envFile = Join-Path $ComposeDir ".env"
    if (-not (Test-Path $envFile)) {
        throw ".env not found at $envFile"
    }
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $key, $value = $line -split "=", 2
            [System.Environment]::SetEnvironmentVariable($key.Trim(), $value.Trim(), "Process")
        }
    }
    # Override — this script talks to Postgres from the host, not from inside
    # the Compose network, so POSTGRES_HOST must be localhost here regardless
    # of what .env has configured for inter-container communication.
    $env:POSTGRES_HOST = "localhost"

    # --- Run Alembic from the backend directory ---
    Pop-Location
    Push-Location $BackendDir

    Write-Host "Generating migration: $Message"
    poetry run alembic revision --autogenerate -m $Message
    if ($LASTEXITCODE -ne 0) {
        throw "alembic revision --autogenerate failed with exit code $LASTEXITCODE"
    }

    Write-Host "Applying migrations"
    poetry run alembic upgrade head
    if ($LASTEXITCODE -ne 0) {
        throw "alembic upgrade head failed with exit code $LASTEXITCODE"
    }

    Write-Host "Done."
}
finally {
    Pop-Location -ErrorAction SilentlyContinue
    Invoke-Cleanup
}
