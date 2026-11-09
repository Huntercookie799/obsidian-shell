@echo off
:: ============================================================================
:: Instalador del Certificado de Confianza - ObsidianShell
:: ============================================================================
:: Registra el certificado digital en el almacen de "Entidades de certificacion
:: raiz de confianza" del equipo para erradicar las alertas de Windows SmartScreen.
:: ============================================================================

title Instalador de Certificado ObsidianShell
echo ========================================================
echo   Instalando Certificado de Confianza para ObsidianShell
echo ========================================================
echo.

set "CER_FILE=%~dp0ObsidianShell-Certificado-Publico.cer"

if not exist "%CER_FILE%" (
    set "CER_FILE=%~dp0..\ObsidianShell-Certificado-Publico.cer"
)

if not exist "%CER_FILE%" (
    echo [ERROR] No se encontro el archivo ObsidianShell-Certificado-Publico.cer
    echo Asegurate de que el certificado este en la misma carpeta que este script.
    echo.
    pause
    exit /b 1
)

echo Importando certificado al almacen de confianza de Windows...
certutil -addstore -f "Root" "%CER_FILE%"

if %ERRORLEVEL% equ 0 (
    echo.
    echo [EXITO] El certificado de ObsidianShell ha sido instalado correctamente.
    echo Ya puedes instalar y ejecutar ObsidianShell sin bloqueos ni falsos positivos de SmartScreen.
) else (
    echo.
    echo [AVISO] Se requieren permisos de Administrador para registrar el certificado.
    echo Haz clic derecho sobre este archivo y selecciona "Ejecutar como administrador".
)

echo.
pause
