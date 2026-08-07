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

if not exist ".env.shared" (
  echo ERRO: Falta o ficheiro .env.shared na pasta do projeto.
  echo Copia .env.shared.example para .env.shared e preenche ^(ou pede o ficheiro a quem configurou^).
  pause
  exit /b 1
)

echo A preparar (a 1.a vez pode demorar 10-20 minutos^)...
docker compose -f docker-compose.remote.yml --env-file .env.shared up -d --build
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
  echo   docker compose -f docker-compose.remote.yml --env-file .env.shared logs -f
  pause
  exit /b 1
)

echo.
echo OK — Velocely a correr.
echo   App: http://localhost:3080
echo   Login: ver ADMIN_EMAIL / ADMIN_PASSWORD no ficheiro .env.shared
echo.
start "" "http://localhost:3080"
pause
