# Compila el frontend para producción (Windows)
# Uso:
#   powershell -ExecutionPolicy Bypass -File build-frontend.ps1 -ApiUrl "http://192.168.1.50:8000"

param(
    [Parameter(Mandatory = $true)]
    [string]$ApiUrl
)

$ErrorActionPreference = "Stop"
$FrontendDir = Join-Path $PSScriptRoot "..\..\frontend" | Resolve-Path

Set-Location $FrontendDir

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js/npm no está instalado. Instala Node 20 LTS." -ForegroundColor Red
    exit 1
}

Write-Host "API URL para el build: $ApiUrl" -ForegroundColor Cyan
Write-Host "Instalando dependencias..." -ForegroundColor Yellow
npm ci

$env:VITE_API_URL = $ApiUrl
Write-Host "Compilando..." -ForegroundColor Yellow
npm run build

Write-Host ""
Write-Host "OK. Carpeta lista: $FrontendDir\dist" -ForegroundColor Green
Write-Host "Publica esa carpeta en IIS (puerto 80) o ejecuta:" -ForegroundColor Green
Write-Host "  npx serve -s dist -l 80"
