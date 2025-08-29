# 🛡️ Sistema de Segurança da API WhatsApp

## 🔐 Visão Geral

A API implementa um sistema de autenticação baseado em JWT (JSON Web Tokens) que garante que cada usuário tenha acesso apenas aos seus próprios recursos do WhatsApp.

## 🚀 Como Funciona

### 1. Autenticação Inicial
```bash
# 1. Inicie uma nova sessão
GET /auth?id_cliente=meu_cliente_123

# Resposta: QR Code e chave de sessão
{
  "status": "ok",
  "id_cliente": "meu_cliente_123",
  "qr_code": "data:image/png;base64,iVBORw0KGgoAAAA...",
  "session_key": "550e8400-e29b-41d4-a716-446655440000",
  "message": "QR Code gerado. Escaneie para autenticar e use a session_key para obter o token JWT.",
  "authenticated": false,
  "key_expires_in": "10 minutos"
}
```

### 2. Obter Token JWT
```bash
# 2. Após escanear o QR Code, obtenha o token usando a chave
POST /get-token
Content-Type: application/json

{
  "id_cliente": "meu_cliente_123",
  "session_key": "550e8400-e29b-41d4-a716-446655440000"
}

# Resposta com token
{
  "status": "ok",
  "id_cliente": "meu_cliente_123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "message": "Token JWT gerado com sucesso!",
  "expires_in": "24 horas"
}
```

### 3. Usar Token nas Rotas Protegidas
```bash
# 3. Envie mensagens usando o token
POST /send-message
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "to": "5511999999999",
  "message": "Olá! Mensagem segura!"
}
```

## 🔒 Rotas Protegidas

### Rotas que REQUEREM Token JWT:
- `POST /send-message` - Enviar mensagens
- `GET /status` - Status da sessão
- `GET /my-sessions` - Ver dados da sessão
- `POST /logout` - Deslogar WhatsApp

### Rotas Públicas:
- `GET /auth` - Gerar QR Code e session_key
- `POST /get-token` - Obter JWT (requer session_key)

## 🛡️ Benefícios de Segurança

### ✅ Isolamento de Clientes
- Cada cliente só acessa seus próprios recursos
- Token vinculado ao `id_cliente` específico
- Impossível acessar dados de outros usuários

### ✅ Chaves de Sessão Seguras
- Chave única gerada a cada autenticação
- Válida por apenas 10 minutos
- One-time use (consumida após gerar token)
- Impossível obter token sem a chave correta

### ✅ Sem Banco de Dados
- Autenticação baseada na própria conexão WhatsApp
- Não armazena senhas ou dados sensíveis
- Sistema stateless com JWT

### ✅ Expiração Automática
- Tokens JWT expiram em 24 horas
- Chaves de sessão expiram em 10 minutos
- Limpeza automática de chaves expiradas
- Invalidação em caso de desconexão

## 🔧 Configuração

### Chave Secreta JWT
Por padrão, usa uma chave interna. Em produção, defina:

```bash
# .env
JWT_SECRET=sua_chave_super_secreta_aqui_2024
```

### Token Lifetime
Tokens expiram em 24 horas por padrão. Para alterar:

```javascript
// src/middleware/auth.js
jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' }); // 12 horas
```

## 📱 Exemplo Completo

```javascript
// 1. Autenticar e obter chave de sessão
const authResponse = await fetch('/auth?id_cliente=cliente_123');
const { qr_code, session_key } = await authResponse.json();

// 2. Mostrar QR Code para usuário escanear
// (aguardar usuário escanear...)

// 3. Obter token usando a chave de sessão
const getToken = async () => {
  const response = await fetch('/get-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id_cliente: 'cliente_123',
      session_key: session_key
    })
  });
  
  const data = await response.json();
  
  if (data.status === 'ok' && data.token) {
    localStorage.setItem('whatsapp_token', data.token);
    return data.token;
  }
  
  if (data.status === 'pending') {
    // Ainda não autenticado, tentar novamente em 3 segundos
    setTimeout(getToken, 3000);
    return;
  }
  
  throw new Error('Erro ao obter token: ' + data.message);
};

const token = await getToken();

// 4. Enviar mensagem com token
const sendMessage = async () => {
  const response = await fetch('/send-message', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: '5511999999999',
      message: 'Olá! Mensagem segura!'
    })
  });
  
  const result = await response.json();
  console.log('Mensagem enviada:', result);
};

await sendMessage();
```

## ⚠️ Importantes

1. **Guarde a Session Key**: Salve temporariamente para obter o token
2. **Guarde o Token**: Salve o token JWT localmente (válido por 24h)
3. **Renovação**: Se o token expirar, faça nova autenticação completa
4. **Segurança**: Nunca exponha token ou session_key em logs/URLs
5. **HTTPS**: Em produção, sempre use HTTPS

## 🚫 O que NÃO é Possível

- ❌ Acessar sessões de outros clientes
- ❌ Usar um token de cliente A para cliente B  
- ❌ Obter token sem session_key válida
- ❌ Reutilizar session_key (one-time use)
- ❌ Usar session_key expirada (10 min)
- ❌ Tokens infinitos (máximo 24h)

Este sistema garante que cada usuário tenha acesso isolado e seguro apenas aos seus próprios recursos do WhatsApp!
