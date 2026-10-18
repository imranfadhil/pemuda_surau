@echo off
setlocal enabledelayedexpansion

REM ===================================================================
REM  backup.bat - Manage PostgreSQL backups on the droplet
REM
REM  Usage:
REM    backup.bat                 take a backup now (on the droplet)
REM    backup.bat --pull [name]   download a dump to your machine
REM    backup.bat --latest        download the newest dump to your machine
REM    backup.bat --list          list available backups (local + remote)
REM    backup.bat --restore       restore the latest backup (DESTRUCTIVE)
REM    backup.bat --logs          show recent backup logs
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

set "SSH_OPTS=-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -i "%KEY_FILE%""
set SSH_RETRIES=4

echo.
echo === BACKUP - Pemuda Surau (%PUBLIC_IP%) ===
echo.

if "%1"=="--list" (
    call :ssh_run "cd %REMOTE_DIR% && docker compose exec -T backup restore.sh --list"
    goto :backup_end
)

if "%1"=="--logs" (
    call :ssh_run "cd %REMOTE_DIR% && docker compose logs backup --tail 40"
    goto :backup_end
)

if "%1"=="--pull"   goto :pull
if "%1"=="--latest" goto :pull
if "%1"=="--download" goto :pull

if "%1"=="--restore" (
    echo [WARN] This will DROP and recreate the database from the latest backup.
    set /p CONFIRM=Type YES to continue: 
    if /i not "!CONFIRM!"=="YES" (
        echo [backup] aborted.
        goto :backup_end
    )
    call :ssh_run "cd %REMOTE_DIR% && docker compose exec -T -e FORCE=1 backup restore.sh --latest"
    goto :backup_end
)

REM Default: take a backup now.
call :ssh_run "cd %REMOTE_DIR% && docker compose exec -T backup backup.sh --once"

goto :backup_end


REM -------------------------------------------------------------------
REM  Download a dump to this machine.
REM    backup.bat --latest             newest dump on the droplet
REM    backup.bat --pull <name>.dump   a specific dump
REM  The dump is streamed over SSH (no scp), so it works with the same
REM  key/host settings used everywhere else. When
REM  BACKUP_ENCRYPT_PASSPHRASE is set the file lands as .dump.enc and the
REM  plaintext never touches the local disk.
REM -------------------------------------------------------------------
:pull
set DUMP_NAME=
if /i "%1"=="--pull" if not "%~2"=="" set DUMP_NAME=%~2

echo [1/3] Creating local backup folder...
if not exist "%LOCAL_BACKUP_DIR%" mkdir "%LOCAL_BACKUP_DIR%"
if not exist "%LOCAL_BACKUP_DIR%" (
    echo [ERROR] Could not create local backup folder: %LOCAL_BACKUP_DIR%
    echo         Set LOCAL_BACKUP_DIR in deploy\config.bat to a writable path.
    goto :backup_end
)

REM Resolve the newest dump in a SEPARATE ssh call, and keep the pipeline inside
REM a for /f. A pipeline written inline - `ssh ... "ls -t ... | head -1"` - would
REM NOT survive: cmd.exe expands %VAR% during parsing and then re-parses the
REM result, so the '|' inside the expanded command would run `head` LOCALLY.
REM `ls -t` prints a full path, so take the basename before building local names.
if "%DUMP_NAME%"=="" (
    echo [INFO] Looking up the newest dump on the droplet...
    set DUMP_PATH=
    for /f "usebackq delims=" %%n in (`ssh %SSH_OPTS% root@%PUBLIC_IP% "ls -t %REMOTE_DIR%/backups/*.dump 2^>nul ^| head -1"`) do set DUMP_PATH=%%n
    if "!DUMP_PATH!"=="" (
        echo [ERROR] No dump found on the droplet.
        echo         Take one first:  backup.bat
        echo         Or list them:    backup.bat --list
        goto :backup_end
    )
    for %%b in ("!DUMP_PATH!") do set DUMP_NAME=%%~nxb
)

REM Only plain filenames are accepted, so nothing can escape the backups folder
REM or write outside LOCAL_BACKUP_DIR.
echo !DUMP_NAME!| findstr /r /c:"^[A-Za-z0-9._-]*\.dump$" >nul
if !ERRORLEVEL! neq 0 (
    echo [ERROR] Not a dump filename: !DUMP_NAME!
    echo         Expected something like pemuda_surau_2026-10-18_030000.dump
    goto :backup_end
)

set ENCRYPT=0
set OUT_SUFFIX=
if not "%BACKUP_ENCRYPT_PASSPHRASE%"=="" (
    set ENCRYPT=1
    set OUT_SUFFIX=.enc
)

set "OUT_FILE=%LOCAL_BACKUP_DIR%\!DUMP_NAME!!OUT_SUFFIX!"
set "REMOTE_FILE=%REMOTE_DIR%/backups/!DUMP_NAME!"

if "%ENCRYPT%"=="1" (
    where openssl >nul 2>&1
    if !ERRORLEVEL! neq 0 (
        echo [ERROR] BACKUP_ENCRYPT_PASSPHRASE is set but openssl is not on PATH.
        echo         Install OpenSSL, or clear BACKUP_ENCRYPT_PASSPHRASE for plain dumps.
        goto :backup_end
    )
)

echo [2/3] Downloading !DUMP_NAME! to !OUT_FILE!
set /a PULL_TRY=0
set PASS_FILE=
:pull_retry
set /a PULL_TRY+=1
if "%ENCRYPT%"=="1" (
    REM OpenSSL 3.x will NOT take a passphrase from plain stdin - it prompts on
    REM the CONSOLE instead and the pipe deadlocks. It must be handed a file
    REM (`-pass file:`), which also keeps the secret off the command line. The
    REM dump stays the only thing on stdin, so openssl is its sole reader.
    set "PASS_FILE=%TEMP%\pemuda_surau-pass-!RANDOM!!RANDOM!.tmp"
    powershell -NoProfile -Command "Set-Content -LiteralPath '!PASS_FILE!' -Value $env:BACKUP_ENCRYPT_PASSPHRASE -NoNewline -Encoding ascii" >nul 2>&1
    if not exist "!PASS_FILE!" (
        echo [ERROR] Could not write the temporary passphrase file.
        goto :backup_end
    )
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cat !REMOTE_FILE!" | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass file:"!PASS_FILE!" -out "!OUT_FILE!"
    set PULL_RC=!ERRORLEVEL!
    del "!PASS_FILE!" >nul 2>&1
) else (
    ssh %SSH_OPTS% root@%PUBLIC_IP% "cat !REMOTE_FILE!" <nul > "!OUT_FILE!"
    set PULL_RC=!ERRORLEVEL!
)
if !PULL_RC! neq 0 (
    if !PULL_TRY! geq %SSH_RETRIES% (
        echo [ERROR] Download failed after !PULL_TRY! attempts.
        del "!OUT_FILE!" 2>nul
        goto :backup_end
    )
    echo [WARN] Download attempt !PULL_TRY!/%SSH_RETRIES% failed - retrying...
    ping -n 5 127.0.0.1 >nul
    goto :pull_retry
)

REM Guard against a "successful" ssh that transferred nothing (e.g. the dump was
REM deleted between the lookup and the copy) - a real custom-format dump is far
REM bigger than this.
set FILE_SIZE=0
if exist "!OUT_FILE!" for %%s in ("!OUT_FILE!") do set FILE_SIZE=%%~zs
if !FILE_SIZE! lss 1024 (
    echo [ERROR] Downloaded only !FILE_SIZE! bytes - the dump was not transferred.
    echo         Check what exists on the droplet:  backup.bat --list
    del "!OUT_FILE!" 2>nul
    goto :backup_end
)

echo [3/3] Verifying...
if "%ENCRYPT%"=="1" (
    echo        !FILE_SIZE! bytes - contents are ENCRYPTED, so they cannot be verified here.
    echo        To verify, put the passphrase in pass.txt ^(one line, no trailing newline^):
    echo          openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:pass.txt -in "!OUT_FILE!" -out check.dump
    echo          pg_restore --list check.dump
    echo        Keep BACKUP_ENCRYPT_PASSPHRASE safe - the file is unrecoverable without it.
) else (
    where pg_restore >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        pg_restore --list "!OUT_FILE!" >nul 2>&1
        if !ERRORLEVEL! equ 0 (
            echo [OK] Dump verified with pg_restore - it is a readable custom-format backup.
        ) else (
            echo [WARN] pg_restore could not read the file - the download may be truncated.
        )
    ) else (
        echo [INFO] pg_restore not on PATH - skipped verification ^(!FILE_SIZE! bytes^).
    )
)

echo.
echo [OK] Saved: !OUT_FILE!
if "%ENCRYPT%"=="1" (
    echo [INFO] It is encrypted. Decrypt first, then restore:
    echo          openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:pass.txt -in "!OUT_FILE!" -out restore.dump
    echo          pg_restore -d ^<db^> restore.dump
) else (
    echo [INFO] Restore locally with:  pg_restore -d ^<db^> "!OUT_FILE!"
)
echo [INFO] Restore on the droplet: backup.bat --restore

goto :backup_end


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

:backup_end
endlocal
