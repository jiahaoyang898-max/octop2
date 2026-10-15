@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

REM ===========================================================================
REM  Octop container management (Windows)
REM
REM    octop-ctl.cmd status     - container status + health check
REM    octop-ctl.cmd logs       - follow application logs (Ctrl+C to exit)
REM    octop-ctl.cmd password   - print first-login credential
REM    octop-ctl.cmd restart    - restart containers
REM    octop-ctl.cmd down       - stop and remove containers (data preserved)
REM    octop-ctl.cmd shell      - open a shell inside the container
REM    octop-ctl.cmd nuke       - DESTRUCTIVE: remove containers AND all data
REM ===========================================================================

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "ENV_FILE=%SCRIPT_DIR%oneclick.env"
set "COMPOSE_FILE=%SCRIPT_DIR%docker-compose.oneclick.yml"
set "CMD=%~1"
if "%CMD%"=="" set "CMD=status"

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] docker not found in PATH.
    exit /b 1
)

set "PORT="
set "OCTOP_DATA_LOCAL="
for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
    if /I "%%a"=="OCTOP_PORT" set "PORT=%%b"
    if /I "%%a"=="OCTOP_DATA" set "OCTOP_DATA_LOCAL=%%b"
)
if "%PORT%"=="" set "PORT=8088"
if "%OCTOP_DATA_LOCAL%"=="" set "OCTOP_DATA_LOCAL=D:/octop-data/.octop"

if /I "%CMD%"=="status" (
    echo [octop] Container status:
    docker ps -a --filter "name=octop" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo.
    echo [octop] Health check: http://127.0.0.1:%PORT%/api/health
    curl -fsS --noproxy "*" --max-time 8 "http://127.0.0.1:%PORT%/api/health"
    if errorlevel 1 (echo   FAILED - service down or not ready) else (echo. & echo [octop] OK)
    exit /b 0
)

if /I "%CMD%"=="logs" (
    docker logs -f --tail 200 octop
    exit /b 0
)

if /I "%CMD%"=="password" (
    if exist "%OCTOP_DATA_LOCAL%\credential.txt" (
        type "%OCTOP_DATA_LOCAL%\credential.txt"
    ) else (
        echo [octop] Credential file not generated yet. Reading from container...
        docker exec octop sh -c "cat $HOME/.octop/credential.txt 2>/dev/null"
    )
    exit /b 0
)

if /I "%CMD%"=="restart" (
    pushd "%REPO_ROOT%"
    docker compose --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" restart
    popd
    echo [octop] Restarted.
    exit /b 0
)

if /I "%CMD%"=="down" (
    pushd "%REPO_ROOT%"
    docker compose --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" down --remove-orphans
    popd
    echo [octop] Stopped. Data directory %OCTOP_DATA_LOCAL% is preserved.
    exit /b 0
)

if /I "%CMD%"=="shell" (
    docker exec -it octop bash
    if errorlevel 1 docker exec -it octop sh
    exit /b 0
)

if /I "%CMD%"=="nuke" (
    echo ===============================================================
    echo  WARNING: THIS IS DESTRUCTIVE AND LOSES DATA IRREVERSIBLY
    echo ===============================================================
    echo  Will delete:
    echo    - containers octop / octop-postgres
    echo    - volume octop_pgdata
    echo    - data directory %OCTOP_DATA_LOCAL%
    echo.
    set "ANSWER="
    set /p "ANSWER=Type YES (uppercase) to confirm: "
    if not "%ANSWER%"=="YES" (
        echo [octop] Cancelled.
        exit /b 1
    )
    pushd "%REPO_ROOT%"
    docker compose --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" --profile postgres down -v --remove-orphans
    popd
    echo [octop] Removing data directory %OCTOP_DATA_LOCAL% ...
    rmdir /s /q "%OCTOP_DATA_LOCAL%"
    echo [octop] Done.
    exit /b 0
)

if /I "%CMD%"=="help" (
    echo Usage: octop-ctl.cmd [status^|logs^|password^|restart^|down^|shell^|nuke]
    exit /b 0
)

echo [ERROR] Unknown command: %CMD%
echo Usage: octop-ctl.cmd [status^|logs^|password^|restart^|down^|shell^|nuke]
exit /b 2
