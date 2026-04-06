@echo off
echo ================================================
echo   AutoDiag Pro - Instalacion del Agente J2534
echo ================================================
echo.

:: Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js no esta instalado.
    echo Descargalo desde: https://nodejs.org
    echo Instala la version LTS y vuelve a ejecutar este script.
    pause
    exit /b 1
)

echo [OK] Node.js detectado
echo.
echo Instalando dependencias...
npm install --production
echo.
echo ================================================
echo   Instalacion completada!
echo   Ejecuta: start.bat para iniciar el agente
echo ================================================
pause
