#Requires -Version 5.1
<#
.SYNOPSIS
    Creates a new superuser inside docker database
#>

docker compose exec backend poetry run python createsuperuser.py
