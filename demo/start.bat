@echo off
echo ========================================
echo Arbok - Setup y Ejecucion
echo ========================================
echo.

cd /d "%~dp0.."

echo [1/4] Verificando Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no encontrado
    echo Instala Node.js desde: https://nodejs.org
    pause
    exit /b 1
)
node --version

echo.
echo [2/4] Instalando dependencias...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Fallo npm install
    pause
    exit /b 1
)

echo.
echo [3/4] Compilando proyecto...
call npm run build
if %errorlevel% neq 0 (
    echo ERROR: Fallo npm run build
    pause
    exit /b 1
)

echo.
echo [4/4] Iniciando servidor...
cd demo
start http://localhost:3000
python server.py
