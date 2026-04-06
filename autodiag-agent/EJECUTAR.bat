@echo off
title AutoDiag Pro - Agente
color 0A
cd /d "%~dp0"

echo.
echo ==========================================
echo   AUTODIAG PRO - Agente J2534
echo ==========================================
echo.

:: Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo.
    echo Abre este link en Chrome e instala:
    echo https://nodejs.org/en/download
    echo.
    echo Luego vuelve a abrir este archivo.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js instalado
echo.

:: Instalar ws si no esta
if not exist node_modules\ws (
    echo Instalando componentes (solo la primera vez)...
    npm install ws
    echo.
    echo [OK] Componentes instalados
    echo.
)

:: Verificar que existe agent-lite.js
if not exist agent-lite.js (
    echo [ERROR] No se encuentra agent-lite.js
    echo.
    echo Asegurate de estar en la carpeta correcta:
    echo autodiag-agent\
    echo.
    pause
    exit /b 1
)

echo Iniciando agente...
echo.
echo ==========================================
echo   DEJA ESTA VENTANA ABIERTA
echo   Para cerrar: presiona Ctrl+C
echo ==========================================
echo.

node agent-lite.js

echo.
echo El agente se cerro.
echo.
pause
