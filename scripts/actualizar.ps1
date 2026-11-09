# ==============================================================================
# Script de Actualización Directa a la Última Versión - ObsidianShell
# ==============================================================================
# Descarga e instala de forma limpia y transparente la última versión estable (.msi)
# desde GitHub Releases, evitando los falsos positivos de Windows Defender.
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "==> [ObsidianShell] Consultando la última versión en GitHub..." -ForegroundColor Cyan

try {
    $latest = Invoke-RestMethod "https://github.com/Huntercookie799/obsidian-shell/releases/latest/download/latest.json"
} catch {
    Write-Host "[ERROR] No se pudo obtener la información de actualización: $_" -ForegroundColor Red
    exit 1
}

$version = $latest.version
$msiUrl = $latest.platforms.'windows-x86_64'.url

if (-not $msiUrl) {
    Write-Host "[ERROR] No se encontró el paquete MSI de Windows en la respuesta de GitHub." -ForegroundColor Red
    exit 1
}

Write-Host "==> Descargando ObsidianShell v$version..." -ForegroundColor Green
$tempMsi = Join-Path $env:TEMP "ObsidianShell-v$version.msi"

try {
    Invoke-WebRequest -Uri $msiUrl -OutFile $tempMsi -UseBasicParsing
} catch {
    Write-Host "[ERROR] Falló la descarga del archivo: $_" -ForegroundColor Red
    exit 1
}

Write-Host "==> Cerrando instancias activas de ObsidianShell..." -ForegroundColor Yellow
Stop-Process -Name "obsidian-shell", "vayli-terminal" -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

Write-Host "==> Instalando ObsidianShell v$version (Windows Installer nativo)..." -ForegroundColor Cyan
$installProc = Start-Process msiexec.exe -ArgumentList "/i `"$tempMsi`" /passive /norestart" -PassThru -Wait

if ($installProc.ExitCode -eq 0) {
    Write-Host "==> ¡ObsidianShell v$version actualizado con éxito!" -ForegroundColor Green
} else {
    Write-Host "==> Proceso de instalación finalizado con código: $($installProc.ExitCode)" -ForegroundColor Yellow
}

# Limpieza del instalador temporal
Remove-Item $tempMsi -Force -ErrorAction SilentlyContinue

# Iniciar la aplicación actualizada
$possiblePaths = @(
    "$env:ProgramFiles\ObsidianShell\obsidian-shell.exe",
    "$env:LOCALAPPDATA\Programs\ObsidianShell\obsidian-shell.exe",
    "$env:ProgramFiles(x86)\ObsidianShell\obsidian-shell.exe"
)

foreach ($path in $possiblePaths) {
    if (Test-Path $path) {
        Write-Host "==> Iniciando ObsidianShell..." -ForegroundColor Cyan
        Start-Process $path
        break
    }
}
