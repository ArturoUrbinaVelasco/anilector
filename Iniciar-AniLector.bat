@echo off
REM ==== AniLector - arranque local (doble clic) ====
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Necesitas Node.js instalado: https://nodejs.org  (version LTS^)
  echo.
  pause
  exit /b
)
echo.
echo  Iniciando AniLector...  (cierra esta ventana para detener^)
echo.
node server.mjs
pause
