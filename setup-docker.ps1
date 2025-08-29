# 🐳 Script de Setup Docker - API WhatsApp (PowerShell)
# =====================================================

# Configurar cores para output
function Write-Status {
    param($Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param($Message)
    Write-Host "[SUCESSO] $Message" -ForegroundColor Green
}

function Write-Warning {
    param($Message)
    Write-Host "[AVISO] $Message" -ForegroundColor Yellow
}

function Write-Error {
    param($Message)
    Write-Host "[ERRO] $Message" -ForegroundColor Red
}

Write-Host "🚀 Iniciando setup da API WhatsApp com Docker..." -ForegroundColor Cyan

# Verificar se Docker está instalado
try {
    $dockerVersion = docker --version 2>$null
    if (-not $dockerVersion) {
        throw "Docker não encontrado"
    }
    Write-Success "Docker encontrado: $dockerVersion"
} catch {
    Write-Error "Docker não está instalado!"
    Write-Host "Instale o Docker Desktop: https://docs.docker.com/desktop/windows/"
    exit 1
}

# Verificar se Docker Compose está disponível
try {
    $composeVersion = docker-compose --version 2>$null
    if (-not $composeVersion) {
        throw "Docker Compose não encontrado"
    }
    Write-Success "Docker Compose encontrado: $composeVersion"
} catch {
    Write-Error "Docker Compose não está disponível!"
    Write-Host "Certifique-se de que o Docker Desktop está instalado corretamente."
    exit 1
}

# Verificar se o Docker está rodando
try {
    docker info 2>$null | Out-Null
    Write-Success "Docker está rodando!"
} catch {
    Write-Error "Docker não está rodando!"
    Write-Host "Inicie o Docker Desktop e tente novamente."
    exit 1
}

# Verificar se docker-compose.yml existe
if (-not (Test-Path "docker-compose.yml")) {
    Write-Error "Arquivo docker-compose.yml não encontrado!"
    exit 1
}

Write-Status "Parando containers existentes (se houver)..."
docker-compose down 2>$null

Write-Status "Fazendo build da aplicação..."
docker-compose build

if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha no build da aplicação!"
    exit 1
}

Write-Status "Subindo os serviços..."
docker-compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Error "Falha ao iniciar os serviços!"
    exit 1
}

Write-Status "Aguardando serviços ficarem prontos..."
Start-Sleep -Seconds 10

# Verificar se os containers estão rodando
$runningContainers = docker-compose ps --filter "status=running"
if ($runningContainers) {
    Write-Success "Containers iniciados com sucesso!"
} else {
    Write-Error "Problemas ao iniciar containers!"
    Write-Host "Verifique os logs: docker-compose logs"
    exit 1
}

# Verificar se a API está respondendo
Write-Status "Testando conectividade da API..."
Start-Sleep -Seconds 5

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api-docs" -UseBasicParsing -TimeoutSec 10 2>$null
    if ($response.StatusCode -eq 200) {
        Write-Success "API está respondendo!"
    } else {
        throw "API não respondeu corretamente"
    }
} catch {
    Write-Warning "API pode ainda estar inicializando..."
    Write-Status "Verificando logs..."
    docker-compose logs --tail=20 whatsapp-api
}

Write-Host ""
Write-Host "🎉 Setup concluído!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Informações importantes:" -ForegroundColor Cyan
Write-Host "  • API WhatsApp: http://localhost:3000"
Write-Host "  • Documentação: http://localhost:3000/api-docs"
Write-Host "  • PostgreSQL: localhost:5432"
Write-Host ""
Write-Host "🔧 Comandos úteis:" -ForegroundColor Cyan
Write-Host "  • Ver logs: docker-compose logs -f whatsapp-api"
Write-Host "  • Parar tudo: docker-compose down"
Write-Host "  • Status: docker-compose ps"
Write-Host ""
Write-Host "📁 Sessões persistentes em volumes Docker:" -ForegroundColor Cyan
Write-Host "  • whatsapp_sessions (autenticações)"
Write-Host "  • whatsapp_cache (cache do navegador)"
Write-Host ""
Write-Host "🔐 IMPORTANTE: Altere a JWT_SECRET no docker-compose.yml em produção!" -ForegroundColor Yellow
Write-Host ""
Write-Success "Sua API WhatsApp está pronta para uso! 🚀"
