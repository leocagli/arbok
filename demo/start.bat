@echo off
echo Verificando Node.js...

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js NO esta instalado.
    echo.
    echo Descargalo desde: https://nodejs.org
    echo Presiona cualquier tecla para abrir el navegador...
    pause >nul
    start https://nodejs.org/en/download/
    exit /b
)

echo Node.js encontrado!
echo Iniciando servidor en http://localhost:8000
echo.
echo Presiona Ctrl+C para detener
echo.

node server.js
