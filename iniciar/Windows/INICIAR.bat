@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0..\.."

echo ========================================
echo   Velocely — Windows
echo ========================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo ERRO: Docker nao encontrado.
  echo Instala Docker Desktop:
  echo   https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo ERRO: Docker Desktop nao esta a correr.
  echo Abre o Docker Desktop, espera ficar Running, e volta a clicar neste ficheiro.
  pause
  exit /b 1
)

set "ENV_FILE="
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if /I "%BRANCH%"=="QA" set "ENV_FILE=.env.qa"
if /I "%BRANCH%"=="PROD" set "ENV_FILE=.env.prod"
if /I "%BRANCH%"=="DEV" set "ENV_FILE=.env.dev"
if "%ENV_FILE%"=="" set "ENV_FILE=.env.dev"

if not exist "%ENV_FILE%" (
  if exist ".env.shared" (
    set "ENV_FILE=.env.shared"
  ) else (
    echo ERRO: Falta o ficheiro de ambiente.
    echo   DEV  - copia .env.dev.example  para .env.dev
    echo   QA   - copia .env.qa.example   para .env.qa
    echo   PROD - copia .env.prod.example para .env.prod
    pause
    exit /b 1
  )
)

set "DB_NAME=velocely"
set "COMPOSE_PROJECT_NAME=velocely-remote"
set "WEB_PUBLISH_PORT=3080"
for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
  set "K=%%a"
  set "V=%%b"
  if /I "!K!"=="DB_NAME" set "DB_NAME=!V!"
  if /I "!K!"=="COMPOSE_PROJECT_NAME" set "COMPOSE_PROJECT_NAME=!V!"
  if /I "!K!"=="WEB_PUBLISH_PORT" set "WEB_PUBLISH_PORT=!V!"
)
set "DB_NAME=%DB_NAME:"=%"
set "COMPOSE_PROJECT_NAME=%COMPOSE_PROJECT_NAME:"=%"
set "WEB_PUBLISH_PORT=%WEB_PUBLISH_PORT:"=%"

echo Ambiente: %ENV_FILE%  ^|  BD: %DB_NAME%  ^|  Docker: %COMPOSE_PROJECT_NAME%
echo A preparar (a 1.a vez pode demorar 10-20 minutos^)...
docker compose -p %COMPOSE_PROJECT_NAME% -f docker-compose.remote.yml --env-file %ENV_FILE% up -d --build
if errorlevel 1 (
  echo ERRO ao subir os contentores.
  pause
  exit /b 1
)

echo.
echo A aguardar a API (ate 3 minutos^)...
set OK=0
for /L %%i in (1,1,90) do (
  if !OK! EQU 0 (
    curl -fsS http://127.0.0.1:8000/docs >nul 2>&1
    if not errorlevel 1 set OK=1
  )
  if !OK! EQU 0 timeout /t 2 /nobreak >nul
)

if !OK! EQU 0 (
  echo Ainda nao respondeu. No terminal:
  echo   docker compose -p %COMPOSE_PROJECT_NAME% -f docker-compose.remote.yml --env-file %ENV_FILE% logs -f
  pause
  exit /b 1
)

echo.
echo OK — Velocely a correr.
echo   App: http://localhost:%WEB_PUBLISH_PORT%
echo   BD:  %DB_NAME%
echo   Login: ver ADMIN_EMAIL / ADMIN_PASSWORD no %ENV_FILE%
echo.
start "" "http://localhost:%WEB_PUBLISH_PORT%"
pause
