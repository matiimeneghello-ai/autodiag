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
    echo  Instala Node.js desde: https://nodejs.org
    echo  Descarga la version LTS y vuelve a ejecutar este archivo.
    echo.
    start https://nodejs.org
    pause
    exit /b 1
)

:: Install ws dependency if needed
if not exist node_modules\ws (
    echo  Instalando dependencias (solo la primera vez)...
    npm install ws --silent
    echo.
)

echo  Iniciando conexion con AutoDiag Pro...
echo  (Cerralo con Ctrl+C cuando termines el diagnostico)
echo.

node agent-lite.js %*
pause
