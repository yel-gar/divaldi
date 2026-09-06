param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeDir = Join-Path $ScriptDir ".."

# Load .env (still shared with the containerized setup, for consistent credentials)
Get-Content (Join-Path $ComposeDir ".env") | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
        $key, $value = $line -split "=", 2
        [System.Environment]::SetEnvironmentVariable($key.Trim(), $value.Trim(), "Process")
    }
}
$env:POSTGRES_HOST = "localhost"  # native install, always localhost — no container networking at all

Write-Host "Generating migration: $Message"
poetry run alembic revision --autogenerate -m $Message

Write-Host "Applying migrations"
poetry run alembic upgrade head
