@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0..\.."
echo A parar Velocely...

set "ENV_FILE="
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH=%%b"
if /I "%BRANCH%"=="QA" set "ENV_FILE=.env.qa"
if /I "%BRANCH%"=="PROD" set "ENV_FILE=.env.prod"
if /I "%BRANCH%"=="DEV" set "ENV_FILE=.env.dev"
if "%ENV_FILE%"=="" set "ENV_FILE=.env.dev"
if not exist "%ENV_FILE%" if exist ".env.shared" set "ENV_FILE=.env.shared"

set "COMPOSE_PROJECT_NAME=velocely-remote"
if exist "%ENV_FILE%" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
    set "K=%%a"
    set "V=%%b"
    if /I "!K!"=="COMPOSE_PROJECT_NAME" set "COMPOSE_PROJECT_NAME=!V!"
  )
  set "COMPOSE_PROJECT_NAME=%COMPOSE_PROJECT_NAME:"=%"
  docker compose -p %COMPOSE_PROJECT_NAME% -f docker-compose.remote.yml --env-file %ENV_FILE% down
)

echo Parado.
pause
