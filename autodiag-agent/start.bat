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
    echo  [ERROR] Node.js no esta instalado!
    echo.
    echo  Instala Node.js desde: https://nodejs.org
    echo  Descarga la version LTS (recomendada)
    echo.
    pause
    exit /b 1
)

:: Install ws if needed
if not exist node_modules\ws (
    echo  Instalando dependencias...
    npm install ws
    echo.
)

echo  Iniciando agente...
echo  (Cerralo con Ctrl+C cuando termines)
echo.

node agent-lite.js %*
pause
