@echo off
setlocal enabledelayedexpansion

REM ===================================================================
REM  destroy.bat - Tear down the DigitalOcean droplet (+ SSH key)
REM  WARNING: permanently deletes the droplet and all data on it.
REM ===================================================================

cd /d "%~dp0"

if not exist "config.bat" (
  echo [destroy] config.bat not found. Run deploy.bat first.
  exit /b 1
)
call config.bat

echo.
echo ===============================================================
echo    DESTROY - Pemuda Surau (DigitalOcean)
echo ===============================================================
echo.

set /p CONFIRM="Type DESTROY to confirm: "
if not "%CONFIRM%"=="DESTROY" (
    echo Aborted.
    exit /b 0
)

REM -- Delete droplet -------------------------------------------------
echo [1/2] Deleting droplet %DROPLET_NAME%...
doctl compute droplet get %DROPLET_NAME% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    doctl compute droplet delete %DROPLET_NAME% --force >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo [OK] Droplet deleted.
    ) else (
        echo [WARN] Failed to delete droplet - check the DO console.
    )
) else (
    echo [SKIP] No droplet named %DROPLET_NAME% found.
)

REM -- Delete SSH key from DO (keeps the local key file) --------------
echo [2/2] Removing SSH key from DO...
set KEY_ID=
for /f "tokens=1" %%i in ('doctl compute ssh-key list --format ID^,Name --no-header ^| findstr /c:"%KEY_NAME%"') do set KEY_ID=%%i
if not "%KEY_ID%"=="" (
    doctl compute ssh-key delete %KEY_ID% --force >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        echo [OK] SSH key removed from DO ^(local key file kept at %KEY_FILE%^).
    ) else (
        echo [WARN] Failed to remove SSH key from DO ^(ID: %KEY_ID%^).
        echo        Remove manually: doctl compute ssh-key delete %KEY_ID%
    )
) else (
    echo [SKIP] No matching SSH key on DO.
)

REM -- Clean cached state ---------------------------------------------
del "%TEMP%\%PROJECT_NAME%-do-ip.txt" 2>nul

echo.
echo ===============================================================
echo    DESTROY COMPLETE
echo ===============================================================

endlocal