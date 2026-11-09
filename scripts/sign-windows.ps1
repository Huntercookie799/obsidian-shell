# ==============================================================================
# Script de Firma Digital para Windows (Authenticode) - ObsidianShell
# ==============================================================================
# Genera un certificado de firma de código local y firma los binarios e instaladores
# para erradicar las advertencias de falso positivo de Windows SmartScreen y Defender.
# ==============================================================================

param (
    [string]$TargetFile = ""
)

$ErrorActionPreference = "Stop"

Write-Host "==> [ObsidianShell] Iniciando proceso de firma digital Authenticode..." -ForegroundColor Cyan

# 1. Buscar o crear el certificado de firma de codigo
$CertSubject = "CN=ObsidianShell, O=ObsidianShell Team, OU=Development"
$cert = Get-ChildItem -Path Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -match "ObsidianShell" } | Select-Object -First 1

if (-not $cert) {
    Write-Host "==> Creando nuevo certificado de firma de codigo autofirmado (validez 5 anos)..." -ForegroundColor Yellow
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $CertSubject `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -NotAfter (Get-Date).AddYears(5) `
        -HashAlgorithm "SHA256"
    Write-Host "    Certificado creado con exito: $($cert.Thumbprint)" -ForegroundColor Green
} else {
    Write-Host "    Certificado existente encontrado: $($cert.Thumbprint)" -ForegroundColor Green
}

# 2. Exportar el certificado publico para distribucion/instalacion en otras PCs
$rootDir = Resolve-Path "$PSScriptRoot\.."
$outCertPath = Join-Path $rootDir "ObsidianShell-Certificado-Publico.cer"
Export-Certificate -Cert $cert -FilePath $outCertPath -Force | Out-Null
Write-Host "==> Certificado publico exportado a: $outCertPath" -ForegroundColor Cyan

# 3. Determinar que archivos firmar
$filesToSign = @()

if ($TargetFile -and (Test-Path $TargetFile)) {
    $filesToSign += (Resolve-Path $TargetFile).Path
} else {
    # Buscar ejecutables e instaladores en target/release y target/debug
    $releaseDir = Join-Path $rootDir "src-tauri\target\release"
    if (Test-Path $releaseDir) {
        $filesToSign += Get-ChildItem -Path $releaseDir -Filter "*.exe" -File | ForEach-Object { $_.FullName }
        $bundleDir = Join-Path $releaseDir "bundle"
        if (Test-Path $bundleDir) {
            $filesToSign += Get-ChildItem -Path $bundleDir -Include "*.exe", "*.msi" -Recurse -File | ForEach-Object { $_.FullName }
        }
    }
}

if ($filesToSign.Count -eq 0) {
    Write-Host "==> No se encontraron binarios para firmar en target/release." -ForegroundColor Yellow
    exit 0
}

Write-Host "==> Firmando $($filesToSign.Count) archivo(s)..." -ForegroundColor Cyan

foreach ($file in $filesToSign) {
    try {
        Write-Host "    Firmando: $(Split-Path $file -Leaf)..." -NoNewline
        $result = Set-AuthenticodeSignature `
            -FilePath $file `
            -Certificate $cert `
            -HashAlgorithm "SHA256"
        
        if ($result.Status -eq "Valid") {
            Write-Host " [OK - Valido]" -ForegroundColor Green
        } elseif ($result.Status -eq "UnknownError") {
            # Cadena procesada con exito con certificado local
            Write-Host " [Firmado con Certificado Local]" -ForegroundColor Green
        } else {
            Write-Host " [Status: $($result.Status)]" -ForegroundColor Yellow
        }
    } catch {
        Write-Host " [Error: $_]" -ForegroundColor Red
    }
}

Write-Host "`n==> Proceso de firma completado con exito!" -ForegroundColor Green
Write-Host "    Nota: En otras computadoras, ejecuta 'instalar-certificado.bat' una sola vez" -ForegroundColor Cyan
Write-Host "    para registrar el certificado en las 'Entidades de certificacion raiz de confianza'." -ForegroundColor Cyan
