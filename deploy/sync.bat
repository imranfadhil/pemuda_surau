@echo off
setlocal enabledelayedexpansion

REM ===================================================================
REM  sync.bat - Push code to the DigitalOcean droplet over SSH
REM  Resolves the droplet IP automatically via doctl (no manual IP).
REM
REM  Usage:
REM    sync.bat              push code + restart containers
REM    sync.bat --restart    force docker rebuild
REM    sync.bat --from-deploy called by deploy.bat (first push)
REM ===================================================================

cd /d "%~dp0"
set DEPLOY_DIR=%CD%

if not exist "config.bat" (
  echo [sync] config.bat not found. Run deploy.bat first.
  exit /b 1
)
call config.bat

set BUILD=0
if "%1"=="--restart"     set BUILD=1
if "%1"=="--from-deploy" set BUILD=1

echo.
echo === SYNC - Surau Al-Abqori (DigitalOcean) ===
echo.

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
echo [INFO] Target: %PUBLIC_IP%

if not exist "%KEY_FILE%" (
    echo [ERROR] SSH key not found: %KEY_FILE%
    exit /b 1
)

set "SSH_OPTS=-o StrictHostKeyChecking=accept-new -i "%KEY_FILE%""

REM -- Package code (exclude node_modules, .git, build output) --------
echo [1/5] Packaging project...
cd /d "%~dp0.."
if exist "%TEMP%\%PROJECT_NAME%.tar" del "%TEMP%\%PROJECT_NAME%.tar"
tar -cf "%TEMP%\%PROJECT_NAME%.tar" --exclude="node_modules" --exclude=".git" --exclude="dist" --exclude=".env" --exclude="deploy" --exclude="*.log" *
if %ERRORLEVEL% neq 0 (
    echo [ERROR] tar packaging failed.
    exit /b 1
)
echo [OK] Packaged.

REM -- Copy to droplet ------------------------------------------------
echo [2/5] Ensuring remote directory exists...
ssh %SSH_OPTS% root@%PUBLIC_IP% "mkdir -p %REMOTE_DIR%" <nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Could not create remote directory. Droplet may still be booting.
    exit /b 1
)
echo [OK] Remote directory ready.

echo [3/5] Copying to droplet...
type "%TEMP%\%PROJECT_NAME%.tar" | ssh %SSH_OPTS% root@%PUBLIC_IP% "cat > %REMOTE_DIR%/app.tar"
set SCP_RC=%ERRORLEVEL%
del "%TEMP%\%PROJECT_NAME%.tar" 2>nul
if not %SCP_RC% equ 0 (
    echo [ERROR] Upload failed. Droplet may still be booting, or SSH not ready yet.
    exit /b 1
)
echo [OK] Uploaded.

REM -- Extract + configure .env ---------------------------------------
echo [4/5] Extracting and configuring environment...
ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && tar -xf app.tar && rm -f app.tar" <nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Extraction failed.
    exit /b 1
)

REM Create .env on first deploy, then patch the values we manage.
ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && test -f .env || cp .env.example .env" <nul

REM Generate a strong JWT secret + DB password on first run (only if still default).
ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && grep -q '^JWT_SECRET=change_this' .env && sed -i \"s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|\" .env || true" <nul
ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && grep -q '^POSTGRES_PASSWORD=change_this' .env && sed -i \"s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|\" .env || true" <nul

REM Apply values from config.bat.
if not "%CLOUDFLARE_TUNNEL_TOKEN%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=%CLOUDFLARE_TUNNEL_TOKEN%|\" .env" <nul
)
if not "%DOMAIN%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^CORS_ORIGIN=.*|CORS_ORIGIN=https://%DOMAIN%|\" .env" <nul
)
if not "%ADMIN_PHONES%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^ADMIN_PHONES=.*|ADMIN_PHONES=%ADMIN_PHONES%|\" .env" <nul
)
if not "%OTP_CHANNEL%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^OTP_CHANNEL=.*|OTP_CHANNEL=%OTP_CHANNEL%|\" .env" <nul
)
if not "%TELEGRAM_BOT_TOKEN%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=%TELEGRAM_BOT_TOKEN%|\" .env" <nul
)
if not "%TELEGRAM_BOT_USERNAME%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^TELEGRAM_BOT_USERNAME=.*|TELEGRAM_BOT_USERNAME=%TELEGRAM_BOT_USERNAME%|\" .env" <nul
)
if not "%TELEGRAM_WEBHOOK_SECRET%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^TELEGRAM_WEBHOOK_SECRET=.*|TELEGRAM_WEBHOOK_SECRET=%TELEGRAM_WEBHOOK_SECRET%|\" .env" <nul
)
if not "%TELEGRAM_MODE%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^TELEGRAM_MODE=.*|TELEGRAM_MODE=%TELEGRAM_MODE%|\" .env" <nul
)
if not "%DOMAIN%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^PUBLIC_URL=.*|PUBLIC_URL=https://%DOMAIN%|\" .env" <nul
)
if not "%SMS_PROVIDER%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^SMS_PROVIDER=.*|SMS_PROVIDER=%SMS_PROVIDER%|\" .env" <nul
)
if not "%SMS_API_KEY%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^SMS_API_KEY=.*|SMS_API_KEY=%SMS_API_KEY%|\" .env" <nul
)
if not "%SMS_SENDER_ID%"=="" (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && sed -i \"s|^SMS_SENDER_ID=.*|SMS_SENDER_ID=%SMS_SENDER_ID%|\" .env" <nul
)
echo [OK] Environment ready.

REM -- Start containers -----------------------------------------------
echo [5/5] Starting containers...
set REMOTE_CMD=cd %REMOTE_DIR% ^&^& docker compose
if not "%COMPOSE_PROFILE%"=="" set REMOTE_CMD=!REMOTE_CMD! --profile %COMPOSE_PROFILE%
set REMOTE_CMD=!REMOTE_CMD! up -d
if %BUILD% equ 1 set REMOTE_CMD=!REMOTE_CMD! --build

ssh %SSH_OPTS% root@%PUBLIC_IP% "!REMOTE_CMD!" <nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Remote deploy failed. Check the droplet:
    echo         ssh -i %KEY_FILE% root@%PUBLIC_IP%
    exit /b 1
)

echo.
echo [OK] Sync complete.
if %BUILD% equ 1 echo [OK] Containers rebuilt.

echo.
echo [INFO] Container status:
ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && docker compose ps" <nul

if not "%DOMAIN%"=="" (
    echo.
    echo [OK] App: https://%DOMAIN%/
) else (
    echo.
    echo [OK] App: http://%PUBLIC_IP%/
)

endlocal