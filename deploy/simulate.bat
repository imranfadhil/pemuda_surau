@echo off
setlocal enabledelayedexpansion

REM ===================================================================
REM  simulate.bat - Seed / clear demo data on the droplet
REM  Resolves the droplet IP automatically via doctl (no manual IP).
REM
REM  Usage:
REM    simulate.bat                       seed 60 dummy members (90 days)
REM    simulate.bat --clear               remove all dummy data
REM    simulate.bat --status              show dummy vs real counts
REM    simulate.bat --total 70 --teachers 6 --ajk 10 --days 90
REM
REM  Only rows tagged is_dummy = TRUE are ever removed, so real accounts
REM  (including the admin) are never touched.
REM ===================================================================

cd /d "%~dp0"

if not exist "config.bat" (
  echo [simulate] config.bat not found. Run deploy.bat first.
  exit /b 1
)
call config.bat

REM -- Parse args ------------------------------------------------------
REM NOTE: no parenthesised blocks here - an unescaped ')' inside a block
REM       closes it early. Unmatched args are simply skipped.
set MODE=seed
set SIM_TOTAL=
set SIM_TEACHERS=
set SIM_AJK=
set SIM_DAYS=

:parse
if "%~1"=="" goto :parsed
if /i "%~1"=="--clear"    set MODE=clear
if /i "%~1"=="--status"   set MODE=status
if /i "%~1"=="--total"    set SIM_TOTAL=%~2
if /i "%~1"=="--teachers" set SIM_TEACHERS=%~2
if /i "%~1"=="--ajk"      set SIM_AJK=%~2
if /i "%~1"=="--days"     set SIM_DAYS=%~2
shift
goto :parse
:parsed

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

REM ConnectTimeout bounds how long a dead/rebooting droplet can hang the script;
REM ServerAlive* detects a connection that dies mid-command.
set "SSH_OPTS=-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -i "%KEY_FILE%""

REM Transient network blips are common, so every SSH call is retried.
set SSH_RETRIES=4

echo.
echo === SIMULATE - Pemuda Surau (%PUBLIC_IP%) ===
echo.

if "%MODE%"=="status" (
    call :ssh_run "cd %REMOTE_DIR% && docker compose exec -T db psql -U surau -d pemuda_surau -c 'SELECT is_dummy, count(1) AS members FROM users GROUP BY is_dummy ORDER BY is_dummy;'"
    goto :sim_end
)

if "%MODE%"=="clear" (
    echo [INFO] Removing all dummy data ^(is_dummy = TRUE^)...
    call :ssh_run "cd %REMOTE_DIR% && docker compose exec -T api node scripts/simulate.mjs --clear"
    goto :sim_end
)

REM -- Seed ------------------------------------------------------------
REM Build the -e flags for any tunables the user supplied.
set SIM_ENV=
if not "%SIM_TOTAL%"==""    set SIM_ENV=!SIM_ENV! -e SIM_TOTAL=%SIM_TOTAL%
if not "%SIM_TEACHERS%"=="" set SIM_ENV=!SIM_ENV! -e SIM_TEACHERS=%SIM_TEACHERS%
if not "%SIM_AJK%"==""      set SIM_ENV=!SIM_ENV! -e SIM_AJK=%SIM_AJK%
if not "%SIM_DAYS%"==""     set SIM_ENV=!SIM_ENV! -e SIM_DAYS=%SIM_DAYS%

echo [INFO] Seeding demo data!SIM_ENV!
call :ssh_run "cd %REMOTE_DIR% && docker compose exec -T!SIM_ENV! api node scripts/simulate.mjs"

:sim_end
echo.
echo [OK] Done.
goto :eof

REM -------------------------------------------------------------------
REM  Retry helper. Transient SSH failures are common, so retry a few
REM  times before giving up. Returns 0 on success, 1 on final failure.
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

endlocal
