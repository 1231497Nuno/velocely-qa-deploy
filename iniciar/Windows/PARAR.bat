@echo off
chcp 65001 >nul
cd /d "%~dp0..\.."
echo A parar Velocely...
if exist ".env.shared" (
  docker compose -f docker-compose.remote.yml --env-file .env.shared down
) else (
  docker compose -f docker-compose.remote.yml down
)
echo Parado.
pause
