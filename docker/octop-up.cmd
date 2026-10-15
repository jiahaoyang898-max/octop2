@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

REM ===========================================================================
REM  Octop one-click launcher (Windows)
REM
REM  Double-click this file to build and start all Octop services.
REM  Default mode is SQLite (zero external dependency, fastest way to run).
REM  It also makes sure the demo login account advertised on the login page
REM  (demo / Demo@2026) really exists - see the "demo account" step below.
REM
REM  PostgreSQL mode - run from a command prompt instead:
REM      octop-up.cmd --postgres
REM
REM  To change port / data directory, edit: docker\oneclick.env
REM  Default data directory is D:\octop-data\.octop (kept off the system drive).
REM ===========================================================================

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%.."
set "ENV_FILE=%SCRIPT_DIR%oneclick.env"
set "COMPOSE_FILE=%SCRIPT_DIR%docker-compose.oneclick.yml"

if not exist "%ENV_FILE%" (
    echo [ERROR] Missing config file: %ENV_FILE%
    pause
    exit /b 1
)
if not exist "%COMPOSE_FILE%" (
    echo [ERROR] Missing compose file: %COMPOSE_FILE%
    pause
    exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
    echo [ERROR] docker not found in PATH. Please install Docker Desktop first.
    echo.
    pause
    exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker daemon is not running. Please start Docker Desktop first.
    echo.
    pause
    exit /b 1
)

REM ---- read defaults from oneclick.env ----
set "PORT="
set "OCTOP_DATA_LOCAL="
for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
    if /I "%%a"=="OCTOP_PORT" set "PORT=%%b"
    if /I "%%a"=="OCTOP_DATA" set "OCTOP_DATA_LOCAL=%%b"
)
if "%PORT%"=="" set "PORT=8088"
if "%OCTOP_DATA_LOCAL%"=="" set "OCTOP_DATA_LOCAL=D:/octop-data/.octop"

REM ---- database mode ----
set "PROFILE_ARGS="
if /I "%~1"=="--postgres" (
    set "PROFILE_ARGS=--profile postgres"
    set "OCTOP_DATABASE_DRIVER=postgresql"
    set "OCTOP_DATABASE_URL=postgresql://octop:octop@postgres:5432/octop"
    set "OCTOP_DATABASE_HOST=postgres"
    set "OCTOP_DATABASE_PORT=5432"
    set "OCTOP_DATABASE_NAME=octop"
    set "OCTOP_DATABASE_USER=octop"
    set "OCTOP_DATABASE_PASSWORD=octop"
    echo [octop] Database mode: PostgreSQL ^(pgvector:pg16^)
) else (
    set "OCTOP_DATABASE_DRIVER="
    set "OCTOP_DATABASE_URL="
    echo [octop] Database mode: SQLite
)

echo [octop] Data directory: %OCTOP_DATA_LOCAL%
echo [octop] Service port  : %PORT%
echo.

pushd "%REPO_ROOT%"
echo [octop] Building and starting. The first build downloads dependencies and
echo [octop] can take 10-30 minutes. Please wait...
docker compose --env-file "%ENV_FILE%" -f "%COMPOSE_FILE%" %PROFILE_ARGS% up -d --build --remove-orphans
if errorlevel 1 (
    echo.
    echo [ERROR] docker compose up failed. Check the output above.
    echo         For details:  docker logs octop
    popd
    echo.
    pause
    exit /b 1
)
popd

echo.
echo [octop] Waiting for the service to become healthy...
set "READY=0"
for /L %%i in (1,1,60) do (
    if "!READY!"=="0" (
        curl -fsS --noproxy "*" --max-time 5 "http://127.0.0.1:%PORT%/api/health" >nul 2>nul
        if not errorlevel 1 (set "READY=1") else (timeout /t 5 /nobreak >nul)
    )
)

REM ===========================================================================
REM  Demo account (idempotent)
REM
REM  The login page advertises demo / Demo@2026 for one-click fill, so the
REM  account must really exist in this backend - otherwise the hint misleads.
REM  Only done once the health check passed: the CLI opens the database
REM  offline, and running it before the container's first-run "octop init"
REM  would let the CLI create an empty database and skip that bootstrap.
REM  An existing account is skipped, so re-running this script is safe.
REM  In --postgres mode the container already carries OCTOP_DATABASE_*, so the
REM  CLI talks to the same database.
REM  NOTE: the same credentials live in dashboard/src/pages/Login/index.tsx
REM  (DEMO_USERNAME / DEMO_PASSWORD) - change both sides together.
REM ===========================================================================
set "DEMO_USER=demo"
set "DEMO_PASS=Demo@2026"
set "DEMO_STATE=skipped"

if "!READY!"=="1" (
    curl -fsS --noproxy "*" --max-time 5 "http://127.0.0.1:%PORT%/api/health" 2>nul | findstr /R /C:"users_loaded..[1-9]" /C:"users_loaded.: [1-9]" >nul
    if errorlevel 1 (
        echo [octop] WARN: no account yet - first-run setup is still in progress.
        echo [octop]       Demo account skipped. Rerun this script once healthy, or:
        echo [octop]         docker exec -it octop octop user create %DEMO_USER% --password "%DEMO_PASS%" --role admin
    ) else (
        docker exec octop octop --json user list 2>nul | findstr /C:"username" | findstr /C:"%DEMO_USER%" >nul
        if errorlevel 1 (
            docker exec octop octop user create %DEMO_USER% --password "%DEMO_PASS%" --role admin >nul 2>nul
            if errorlevel 1 (
                echo [octop] WARN: demo account was not created. Try manually:
                echo [octop]   docker exec -it octop octop user create %DEMO_USER% --password "%DEMO_PASS%" --role admin
            ) else (
                set "DEMO_STATE=ready"
                echo [octop] Demo account created: %DEMO_USER% / %DEMO_PASS%
            )
        ) else (
            set "DEMO_STATE=ready"
            echo [octop] Demo account already exists: %DEMO_USER%
        )
    )
) else (
    echo [octop] Service is not ready yet - demo account skipped. Once healthy run:
    echo [octop]   docker exec -it octop octop user create %DEMO_USER% --password "%DEMO_PASS%" --role admin
)

echo.
echo ===================================================================
echo   Octop is running
echo   URL      : http://localhost:%PORT%
echo   Database : %OCTOP_DATABASE_DRIVER%
if "%OCTOP_DATABASE_DRIVER%"=="" echo   Database : sqlite
echo -------------------------------------------------------------------
echo   First-login credential file:
echo     %OCTOP_DATA_LOCAL%/credential.txt
if exist "%OCTOP_DATA_LOCAL%\credential.txt" (
    echo.
    type "%OCTOP_DATA_LOCAL%\credential.txt"
) else (
    echo     ^(not generated yet - the container is still initializing^)
    echo     Run:  octop-ctl.cmd password
)
if "!DEMO_STATE!"=="ready" echo   Demo login : %DEMO_USER% / %DEMO_PASS%  ^(one-click fill on the login page^)
echo.
if "!READY!"=="1" (
    echo   Health check: PASSED
) else (
    echo   Health check: NOT READY YET - see logs via: octop-ctl.cmd logs
)
echo ===================================================================
echo   Manage:
echo     stop    : octop-ctl.cmd down
echo     logs    : octop-ctl.cmd logs
echo     status  : octop-ctl.cmd status
echo     password: octop-ctl.cmd password
echo ===================================================================
echo.
pause
