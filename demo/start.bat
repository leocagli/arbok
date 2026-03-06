@echo off
echo ========================================
echo Arbok - Setup y Ejecucion
echo ========================================
echo.

cd /d "%~dp0.."

echo [1/3] Verificando build en dist...
if exist dist\index.mjs (
    echo OK: dist\index.mjs encontrado
) else (
    echo dist\index.mjs no existe. Intentando compilar...
    where node >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: falta dist\index.mjs y Node.js no esta instalado.
        echo Instala Node.js y ejecuta: npm install ^&^& npm run build
        pause
        exit /b 1
    )

    echo.
    echo [2/3] Instalando dependencias...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: Fallo npm install
        pause
        exit /b 1
    )

    echo.
    echo [3/3] Compilando proyecto...
    call npm run build
    if %errorlevel% neq 0 (
        echo ERROR: Fallo npm run build
        pause
        exit /b 1
    )
)

echo.
echo Iniciando servidor Python en http://localhost:8010/demo/
start http://localhost:8010/demo/
python demo\server.py
