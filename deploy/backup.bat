@echo off
setlocal enabledelayedexpansion

REM ===================================================================
REM  backup.bat - Manage PostgreSQL backups on the droplet
REM
REM  Usage:
REM    backup.bat              take a backup now
REM    backup.bat --list       list available backups (local + remote)
REM    backup.bat --restore    restore the latest backup (DESTRUCTIVE)
REM    backup.bat --logs       show recent backup logs
REM ===================================================================

cd /d "%~dp0"

if not exist "config.bat" (
  echo [backup] config.bat not found. Run deploy.bat first.
  exit /b 1
)
call config.bat

REM -- Resolve public IP ----------------------------------------------
set PUBLIC_IP=
if exist "%TEMP%\%PROJECT_NAME%-do-ip.txt" set /p PUBLIC_IP=<"%TEMP%\%PROJECT_NAME%-do-ip.txt"
if "%PUBLIC_IP%"=="" (
    for /f %%i in ('doctl compute droplet get %DROPLET_NAME% --format PublicIPv4 --no-header 2^>nul') do set PUBLIC_IP=%%i
)
if "%PUBLIC_IP%"=="" (
    echo [ERROR] No droplet IP found. Run deploy.bat first.
    exit /b 1
)

if not exist "%KEY_FILE%" (
    echo [ERROR] SSH key not found: %KEY_FILE%
    exit /b 1
)

set "SSH_OPTS=-o StrictHostKeyChecking=accept-new -i "%KEY_FILE%""

echo.
echo === BACKUP - Pemuda Surau (%PUBLIC_IP%) ===
echo.

if "%1"=="--list" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && docker compose exec -T backup restore.sh --list" <nul
    goto :eof
)

if "%1"=="--logs" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && docker compose logs backup --tail 40" <nul
    goto :eof
)

if "%1"=="--restore" (
    echo [WARN] This will DROP and recreate the database from the latest backup.
    set /p CONFIRM=Type YES to continue: 
    if /i not "!CONFIRM!"=="YES" (
        echo [backup] aborted.
        goto :eof
    )
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && docker compose exec -T -e FORCE=1 backup restore.sh --latest" <nul
    goto :eof
)

REM Default: take a backup now.
ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && docker compose exec -T backup backup.sh --once" <nul

endlocal
