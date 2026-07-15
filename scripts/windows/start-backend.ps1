# Arranca el backend AgroPack en Windows (sin Docker)
# Uso: clic derecho → Ejecutar con PowerShell
#  o:  powershell -ExecutionPolicy Bypass -File C:\AgroPack-Llano\scripts\windows\start-backend.ps1

$ErrorActionPreference = "Stop"
$BackendDir = Join-Path $PSScriptRoot "..\..\backend" | Resolve-Path

Set-Location $BackendDir

$venvPython = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "No existe .venv. Ejecuta primero:" -ForegroundColor Red
    Write-Host "  cd C:\AgroPack-Llano\backend"
    Write-Host "  python -m venv .venv"
    Write-Host "  .\.venv\Scripts\Activate.ps1"
    Write-Host "  pip install -r requirements.txt"
    exit 1
}

$envFile = Join-Path $BackendDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Host "Falta backend\.env — créalo con SECRET_KEY y DATABASE_URL" -ForegroundColor Red
    exit 1
}

Write-Host "Iniciando AgroPack backend en http://0.0.0.0:8000 ..." -ForegroundColor Green
Write-Host "Docs: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "Ctrl+C para detener" -ForegroundColor Yellow

& $venvPython -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
