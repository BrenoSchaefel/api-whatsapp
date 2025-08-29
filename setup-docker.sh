#!/bin/bash

# 🐳 Script de Setup Docker - API WhatsApp
# =========================================

set -e  # Para na primeira falha

echo "🚀 Iniciando setup da API WhatsApp com Docker..."

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para print colorido
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCESSO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[AVISO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERRO]${NC} $1"
}

# Verificar se Docker está instalado
if ! command -v docker &> /dev/null; then
    print_error "Docker não está instalado!"
    echo "Instale o Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Verificar se Docker Compose está instalado
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose não está instalado!"
    echo "Instale o Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

print_success "Docker e Docker Compose encontrados!"

# Verificar se o Docker está rodando
if ! docker info &> /dev/null; then
    print_error "Docker não está rodando!"
    echo "Inicie o Docker e tente novamente."
    exit 1
fi

print_success "Docker está rodando!"

# Verificar se docker-compose.yml existe
if [ ! -f "docker-compose.yml" ]; then
    print_error "Arquivo docker-compose.yml não encontrado!"
    exit 1
fi

print_status "Parando containers existentes (se houver)..."
docker-compose down 2>/dev/null || true

print_status "Fazendo build da aplicação..."
docker-compose build

print_status "Subindo os serviços..."
docker-compose up -d

print_status "Aguardando serviços ficarem prontos..."
sleep 10

# Verificar se os containers estão rodando
if docker-compose ps | grep -q "Up"; then
    print_success "Containers iniciados com sucesso!"
else
    print_error "Problemas ao iniciar containers!"
    echo "Verifique os logs: docker-compose logs"
    exit 1
fi

# Verificar se a API está respondendo
print_status "Testando conectividade da API..."
sleep 5

if curl -s http://localhost:3000/api-docs > /dev/null; then
    print_success "API está respondendo!"
else
    print_warning "API pode ainda estar inicializando..."
    print_status "Verificando logs..."
    docker-compose logs --tail=20 whatsapp-api
fi

echo ""
echo "🎉 Setup concluído!"
echo ""
echo "📋 Informações importantes:"
echo "  • API WhatsApp: http://localhost:3000"
echo "  • Documentação: http://localhost:3000/api-docs"
echo ""
echo "🔧 Comandos úteis:"
echo "  • Ver logs: docker-compose logs -f whatsapp-api"
echo "  • Parar tudo: docker-compose down"
echo "  • Status: docker-compose ps"
echo ""
echo "📁 Sessões persistentes em volumes Docker:"
echo "  • whatsapp_sessions (autenticações)"
echo "  • whatsapp_cache (cache do navegador)"
echo ""
echo "🔐 IMPORTANTE: Altere a JWT_SECRET no docker-compose.yml em produção!"
echo ""
print_success "Sua API WhatsApp está pronta para uso! 🚀"
