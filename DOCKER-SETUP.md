# 🐳 Docker Setup - API WhatsApp

## 🚀 Deploy Rápido

```bash
# 1. Clone e entre no diretório
git clone <seu-repo>
cd api-whatsapp

# 2. Subir toda a infraestrutura
docker-compose up -d

# 3. Verificar logs
docker-compose logs -f whatsapp-api
```

## 📦 Componentes

### **Container API WhatsApp**
- **Porta**: `3000`
- **Volumes**: Sessões WhatsApp persistentes
- **Healthcheck**: Monitoramento automático
- **Dependências**: Apenas sessões locais (sem banco)

## 💾 Persistência das Sessões

### **Problema Resolvido**
As sessões do WhatsApp Web ficavam **perdidas** quando o container era reiniciado.

### **Solução Implementada**
```yaml
volumes:
  # Sessões autenticadas (QR Codes escaneados)
  - whatsapp_sessions:/app/.wwebjs_auth
  # Cache do navegador
  - whatsapp_cache:/app/.wwebjs_cache
```

### **Onde Ficam os Dados**
- **Host**: Docker gerencia automaticamente
- **Container**: `/app/.wwebjs_auth` e `/app/.wwebjs_cache`
- **Persistência**: Dados mantidos entre restarts

## 🔧 Configuração

### **1. Variáveis de Ambiente**
Edite o `docker-compose.yml`:

```yaml
environment:
  # 🔐 ALTERE ESTA CHAVE EM PRODUÇÃO!
  JWT_SECRET: "sua_chave_super_secreta_aqui"
  
  # 🗄️ Banco de dados (opcional - já configurado)
  DB_HOST: postgres
  DB_NAME: whatsapp_api
  DB_USER: whatsapp_user
  DB_PASS: sua_senha_segura
```

### **2. Portas Customizadas**
```yaml
ports:
  - "8080:3000"  # API na porta 8080
```

## 🔒 Segurança em Produção

### **1. Alterar Senhas Padrão**
```yaml
environment:
  JWT_SECRET: "gere_uma_chave_de_32_caracteres"
```

### **2. Usar HTTPS**
Configure um proxy reverso (Nginx/Traefik):

```nginx
server {
    listen 443 ssl;
    server_name api.seudominio.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### **3. Firewall**
```bash
# Permitir apenas porta da API
ufw allow 3000 # API (ou 443 se usar HTTPS)
```

## 🛠️ Comandos Úteis

### **Gerenciamento de Containers**
```bash
# Subir serviços
docker-compose up -d

# Ver logs em tempo real
docker-compose logs -f whatsapp-api

# Parar todos os serviços
docker-compose down

# Rebuild da API (após mudanças no código)
docker-compose build whatsapp-api
docker-compose up -d whatsapp-api
```

### **Backup das Sessões**
```bash
# Criar backup das sessões
docker run --rm -v whatsapp_sessions:/source -v $(pwd):/backup alpine tar czf /backup/sessions-backup.tar.gz -C /source .

# Restaurar backup
docker run --rm -v whatsapp_sessions:/target -v $(pwd):/backup alpine tar xzf /backup/sessions-backup.tar.gz -C /target
```

### **Monitoramento**
```bash
# Status dos containers
docker-compose ps

# Uso de recursos
docker stats

# Logs específicos
docker-compose logs postgres
docker-compose logs whatsapp-api
```

## 🐞 Troubleshooting

### **Problema**: Container não inicia
```bash
# Ver logs detalhados
docker-compose logs whatsapp-api

# Verificar configuração
docker-compose config
```

### **Problema**: Sessões perdidas
```bash
# Verificar volumes
docker volume ls
docker volume inspect whatsapp_sessions

# Verificar permissões
docker-compose exec whatsapp-api ls -la /app/.wwebjs_auth
```

### **Problema**: Erro de conectividade
```bash
# Verificar se container está ativo
docker-compose ps

# Testar API diretamente
curl http://localhost:3000/api-docs
```

## 📊 Health Checks

### **Automático**
O container da API possui healthcheck integrado que verifica se a aplicação está respondendo.

### **Manual**
```bash
# Verificar API
curl http://localhost:3000/api-docs

# Verificar logs da aplicação
docker-compose logs whatsapp-api
```

## 🔄 Atualizações

### **Atualizar Código**
```bash
# 1. Parar API
docker-compose stop whatsapp-api

# 2. Rebuild
docker-compose build whatsapp-api

# 3. Subir novamente
docker-compose up -d whatsapp-api
```

### **Manter Sessões**
As sessões do WhatsApp **não são perdidas** durante atualizações por estarem em volumes persistentes.

## 🎯 Resumo dos Benefícios

✅ **Deploy em 1 comando**  
✅ **Sessões persistentes** (não perde QR Codes)  
✅ **Sem dependências externas** (não precisa de banco)  
✅ **Healthcheck automático**  
✅ **Fácil backup/restore das sessões**  
✅ **Configuração via environment**  
✅ **Preparado para futuro** (banco comentado)  

Agora sua API WhatsApp roda de forma **simples** e **segura** em containers! 🚀
