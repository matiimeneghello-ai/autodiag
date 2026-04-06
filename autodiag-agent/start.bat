@echo off
title AutoDiag Pro - Agente J2534
color 0B

echo.
echo  ============================================
echo    AUTODIAG PRO - Agente J2534 v1.0
echo  ============================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Node.js no esta instalado.
    echo.
    echo  1. Abri este link en el browser:
    echo     https://nodejs.org
    echo  2. Descarga la version LTS
    echo  3. Instala y vuelve a abrir este archivo
    echo.
    pause
    exit /b 1
)

:: Install ws dependency if needed
if not exist node_modules\ws (
    echo  Instalando dependencias (solo la primera vez)...
    call npm install ws --silent
    echo  Listo!
    echo.
)

echo  Conectando con AutoDiag Pro...
echo  (Para cerrar: presiona Ctrl+C)
echo.

node agent-lite.js %*

echo.
echo  El agente se cerro.
pause
