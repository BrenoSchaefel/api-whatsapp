const swaggerJsDoc = require("swagger-jsdoc");

const swaggerOptions = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "🚀 API WhatsApp Business",
            version: "1.0.0",
            description: `
## 📱 API para Integração com WhatsApp Business

Esta API permite integrar aplicações com o WhatsApp Web de forma programática, oferecendo funcionalidades como:

- 🔐 **Autenticação via QR Code** - Sistema seguro de login
- 🔄 **Restauração Automática** - Sessões persistentes entre reinicializações  
- 📊 **Monitoramento** - Status em tempo real das conexões
- 🛡️ **Gerenciamento de Sessões** - Controle completo do ciclo de vida

### 🔧 Como Usar

1. **Autenticar**: Use \`GET /auth\` para obter QR Code
2. **Escanear**: Use o app WhatsApp para escanear o código
3. **Monitorar**: Use \`GET /status\` para verificar conexão
4. **Listar**: Use \`GET /sessions\` para ver todas as sessões

### ⚡ Recursos

- ✅ Múltiplas sessões simultâneas
- ✅ Reconexão automática
- ✅ Timeouts configuráveis  
- ✅ Logs detalhados
- ✅ Estados de conexão em tempo real
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
                description: "🔐 **Autenticação e Gerenciamento de Sessões**\n\nEndpoints para autenticar, monitorar e gerenciar sessões do WhatsApp Business."
            }
        ],
        components: {
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
