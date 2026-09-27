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
echo === SYNC - Pemuda Surau (DigitalOcean) ===
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

REM ConnectTimeout bounds how long a dead/rebooting droplet can hang the script;
REM ServerAlive* detects a connection that dies mid-command.
set "SSH_OPTS=-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -i "%KEY_FILE%""

REM Transient network blips between here and the droplet are common, so every
REM SSH call is retried a few times (see :ssh_run / :ssh_pipe) before the sync
REM is considered failed.
set SSH_RETRIES=5

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
call :ssh_run "mkdir -p %REMOTE_DIR%"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Could not create remote directory. Droplet may still be booting.
    exit /b 1
)
echo [OK] Remote directory ready.

echo [3/5] Copying to droplet...
call :ssh_pipe "%TEMP%\%PROJECT_NAME%.tar" "cat > %REMOTE_DIR%/app.tar"
set SCP_RC=%ERRORLEVEL%
del "%TEMP%\%PROJECT_NAME%.tar" 2>nul
if not %SCP_RC% equ 0 (
    echo [ERROR] Upload failed. Droplet may still be booting, or SSH not ready yet.
    exit /b 1
)
echo [OK] Uploaded.

REM -- Extract + configure .env ---------------------------------------
echo [4/5] Extracting and configuring environment...
call :ssh_run "cd %REMOTE_DIR% && tar -xf app.tar && rm -f app.tar"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Extraction failed.
    exit /b 1
)

REM Create .env on first deploy, then patch the values we manage.
REM NOTE: every env edit runs in ONE ssh call so a dropped connection cannot
REM       leave a half-applied .env (previously each sed was its own ssh call
REM       with no exit-code check, so a timeout silently kept .env.example
REM       defaults - e.g. ADMIN_PHONES and POSTGRES_PASSWORD).
call :ssh_run "cd %REMOTE_DIR% && test -f .env || cp .env.example .env"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Could not create/verify remote .env. Droplet may be unreachable.
    exit /b 1
)

REM Configure the remote .env by piping deploy\configure-env.sh over stdin.
REM NOTE: the shell code lives in a file (not a cmd string) because cmd.exe
REM       does NOT treat '\' as an escape - building the script inline left
REM       injected quotes unbalanced, so cmd split the ssh line on '&&'/'|'
REM       and tried to run '$1' as a command. Values are passed as positional
REM       args so tokens with ':' or '+' are never re-parsed by cmd.
set "ENV_TMP=%TEMP%\%PROJECT_NAME%-configure-env.sh"
powershell -NoProfile -Command "(Get-Content -Raw '%DEPLOY_DIR%\configure-env.sh') -replace [char]13, '' | Set-Content -NoNewline '%ENV_TMP%' -Encoding ascii"
if not exist "%ENV_TMP%" (
    echo [ERROR] Could not prepare configure-env.sh.
    exit /b 1
)

call :ssh_pipe "%ENV_TMP%" "bash -s -- '%REMOTE_DIR%' '%ADMIN_PHONES%' '%OTP_CHANNEL%' '%TELEGRAM_BOT_TOKEN%' '%TELEGRAM_BOT_USERNAME%' '%SMS_PROVIDER%' '%SMS_API_KEY%' '%SMS_SENDER_ID%' '%DOMAIN%'"
set ENV_RC=%ERRORLEVEL%
del "%ENV_TMP%" 2>nul
if not %ENV_RC% equ 0 (
    echo [ERROR] Failed to configure remote .env - SSH error or sed failure.
    echo         Nothing was started. Re-run sync.bat once the droplet is reachable.
    exit /b 1
)
echo [OK] Environment ready.

REM -- Start containers -----------------------------------------------
echo [5/5] Starting containers...
set REMOTE_CMD=cd %REMOTE_DIR% ^&^& docker compose up -d
if %BUILD% equ 1 set REMOTE_CMD=!REMOTE_CMD! --build

call :ssh_run "!REMOTE_CMD!"
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
call :ssh_run "cd %REMOTE_DIR% && docker compose ps"

REM -- Quick tunnel URL (random *.trycloudflare.com) -------------------
REM NOTE: a plain `sync.bat` does NOT recreate the quicktunnel container, so the
REM URL is RETAINED across normal syncs. It only changes when the container is
REM restarted/recreated (docker compose down/up, droplet reboot, or a compose
REM change). We use `tail -1` so we print the CURRENT URL, not the first one ever
REM logged (logs accumulate across restarts, so `head -1` could show a dead URL).
set QUICK_URL=
echo.
echo [INFO] Waiting for the quick tunnel URL...
for /l %%n in (1,1,15) do (
    if "!QUICK_URL!"=="" (
        ssh %SSH_OPTS% root@%PUBLIC_IP% "cd %REMOTE_DIR% && docker compose logs quicktunnel | grep -o https://[a-z0-9-]*\.trycloudflare\.com | tail -1" <nul > "%TEMP%\%PROJECT_NAME%-quick-url.txt" 2>nul
        for /f "usebackq delims=" %%u in ("%TEMP%\%PROJECT_NAME%-quick-url.txt") do set QUICK_URL=%%u
        if "!QUICK_URL!"=="" ping -n 3 127.0.0.1 >nul 2>&1
    )
)
del "%TEMP%\%PROJECT_NAME%-quick-url.txt" 2>nul

echo.
if not "!QUICK_URL!"=="" (
    echo [OK] App: !QUICK_URL!
    echo [INFO] This URL is random and changes whenever the tunnel restarts.
    echo [INFO] Telegram uses long-polling, so OTP works regardless of the URL.
) else (
    echo [WARN] Quick tunnel URL not ready yet. Check:
    echo        ssh -i %KEY_FILE% root@%PUBLIC_IP% "cd %REMOTE_DIR% && docker compose logs quicktunnel"
)

goto :sync_end

REM -------------------------------------------------------------------
REM  Retry helpers. Transient SSH failures are common, so retry a few
REM  times before giving up. Both return 0 on success, 1 on final failure.
REM -------------------------------------------------------------------
:ssh_run
set /a SSH_TRY=0
:ssh_run_loop
set /a SSH_TRY+=1
ssh %SSH_OPTS% root@%PUBLIC_IP% %* <nul
if %ERRORLEVEL% equ 0 exit /b 0
if %SSH_TRY% geq %SSH_RETRIES% exit /b 1
echo [WARN] SSH attempt %SSH_TRY%/%SSH_RETRIES% failed - retrying...
ping -n 5 127.0.0.1 >nul
goto :ssh_run_loop

:ssh_pipe
set /a SSH_TRY=0
:ssh_pipe_loop
set /a SSH_TRY+=1
type "%~1" | ssh %SSH_OPTS% root@%PUBLIC_IP% %2
if %ERRORLEVEL% equ 0 exit /b 0
if %SSH_TRY% geq %SSH_RETRIES% exit /b 1
echo [WARN] SSH attempt %SSH_TRY%/%SSH_RETRIES% failed - retrying...
ping -n 5 127.0.0.1 >nul
goto :ssh_pipe_loop

:sync_end
endlocal