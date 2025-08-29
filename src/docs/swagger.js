const swaggerJsDoc = require("swagger-jsdoc");

const swaggerOptions = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "🚀 API WhatsApp Business",
            version: "1.0.0",
            description: `
## 📱 API WhatsApp Business - Segura e Simples

Integre aplicações com WhatsApp Web de forma segura usando autenticação JWT.

### 🚀 Fluxo de Uso

1. **Autenticar** → \`GET /auth\` (QR Code + session_key)
2. **Escanear** → Use o WhatsApp no celular
3. **Token JWT** → \`POST /get-token\` (com session_key)
4. **Enviar** → \`POST /send-message\` (com token)

### 🔐 Segurança

- **Session Keys** únicas e temporárias (10 min)
- **Tokens JWT** com expiração (24h)
- **Isolamento** total entre clientes
- **One-time use** para session keys

### 📝 Headers Obrigatórios (Rotas Protegidas)

\`\`\`
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
\`\`\`
            `,
            contact: {
                name: "Suporte API WhatsApp",
                email: "suporte@exemplo.com"
            },
            license: {
                name: "MIT",
                url: "https://opensource.org/licenses/MIT"
            }
        },
        servers: [
            {
                url: "http://localhost:3000",
                description: "Servidor de Desenvolvimento"
            },
            {
                url: "https://api.exemplo.com",
                description: "Servidor de Produção"
            }
        ],
        tags: [
            {
                name: "auth",
                description: "🔐 **Autenticação**\n\nQR Code e obtenção de tokens JWT."
            },
            {
                name: "messages", 
                description: "📤 **Mensagens** (🔒 JWT)\n\nEnvio de mensagens e gerenciamento da sessão."
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT",
                    description: "Token JWT obtido após autenticação via QR Code"
                }
            },
            schemas: {
                SessionStatus: {
                    type: "object",
                    properties: {
                        exists: {
                            type: "boolean",
                            description: "Indica se a sessão existe na memória"
                        },
                        connected: {
                            type: "boolean", 
                            description: "Indica se a sessão está conectada ao WhatsApp"
                        },
                        state: {
                            type: "string",
                            enum: ["CONNECTED", "DISCONNECTED", "LOADING", "QR_CODE", "AUTHENTICATED", "INITIALIZING", "RESTORING", "AUTH_FAILURE", "ERROR", "NOT_FOUND"],
                            description: "Estado atual da sessão"
                        },
                        info: {
                            type: "object",
                            description: "Informações da sessão quando conectada (número, nome, etc.)"
                        }
                    }
                },
                Error: {
                    type: "object",
                    properties: {
                        error: {
                            type: "string",
                            description: "Mensagem de erro"
                        },
                        details: {
                            type: "string", 
                            description: "Detalhes técnicos do erro"
                        }
                    }
                }
            }
        }
    },
    apis: ["./src/routes/*.js"],
};

module.exports = swaggerJsDoc(swaggerOptions);
