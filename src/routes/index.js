const express = require("express");
const router = express.Router();
const sessionManager = require("../services/sessionManager");

/**
 * @swagger
 * /auth:
 *   get:
 *     tags: [auth]
 *     summary: 🔐 Autenticar Cliente WhatsApp
 *     description: |
 *       **Autentica um cliente no WhatsApp Business** gerando QR Code ou verificando sessão existente.
 *       
 *       ### 🔄 Comportamento:
 *       - **Primeira vez**: Gera QR Code para autenticação
 *       - **Já autenticado**: Retorna status de conexão
 *       - **Desconectado**: Recria sessão automaticamente
 *       
 *       ### ⏱️ Timeout: 30 segundos para geração do QR Code
 *       
 *       ### 💡 Dica: 
 *       Use o app WhatsApp no celular para escanear o QR Code retornado.
 *     parameters:
 *       - in: query
 *         name: id_cliente
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *           pattern: '^[a-zA-Z0-9_-]+$'
 *           example: "cliente_123"
 *         description: |
 *           **ID único do cliente** para identificar a sessão.
 *           
 *           - Apenas letras, números, hífens e underscores
 *           - Máximo 50 caracteres
 *           - Case sensitive
 *     responses:
 *       200:
 *         description: ✅ Autenticação processada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   title: "QR Code Gerado"
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "ok"
 *                     id_cliente:
 *                       type: string
 *                       example: "cliente_123"
 *                     qr_code:
 *                       type: string
 *                       example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 *                       description: "QR Code em formato base64 (Data URL)"
 *                     message:
 *                       type: string
 *                       example: "QR Code gerado. Escaneie para autenticar."
 *                     authenticated:
 *                       type: boolean
 *                       example: false
 *                 - type: object
 *                   title: "Já Autenticado"
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "ok"
 *                     id_cliente:
 *                       type: string
 *                       example: "cliente_123"
 *                     message:
 *                       type: string
 *                       example: "Sessão já está autenticada e conectada."
 *                     authenticated:
 *                       type: boolean
 *                       example: true
 *                     session_state:
 *                       type: string
 *                       example: "CONNECTED"
 *       400:
 *         description: ❌ Parâmetros inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "id_cliente é obrigatório"
 *       408:
 *         description: ⏰ Timeout - QR Code não gerado em 30 segundos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Timeout aguardando QR Code"
 *               details: "O QR Code não foi gerado dentro do tempo limite de 30 segundos."
 *       500:
 *         description: 💥 Erro interno do servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/auth", async (req, res) => {
    const { id_cliente } = req.query;

    if (!id_cliente) {
        return res.status(400).json({ error: "id_cliente é obrigatório" });
    }

    try {
        // Verifica o status real da sessão
        const sessionStatus = await sessionManager.getSessionStatus(id_cliente);
        
        if (sessionStatus.connected) {
            return res.json({
                status: "ok",
                id_cliente,
                message: "Sessão já está autenticada e conectada.",
                authenticated: true,
                session_state: sessionStatus.state
            });
        }

        // Se a sessão existe mas não está conectada, destrói e recria
        if (sessionStatus.exists && !sessionStatus.connected) {
            console.log(`🔄 Sessão ${id_cliente} existe mas não está conectada. Recriando...`);
            await sessionManager.destroySession(id_cliente);
        }

        // Cria a sessão se não existir ou se foi destruída
        await sessionManager.createSession(id_cliente);
        
        // Aguarda o QR Code ser gerado (máximo 30 segundos)
        const qrCode = await sessionManager.waitForQRCode(id_cliente, 30000);
        
        res.json({
            status: "ok",
            id_cliente,
            qr_code: qrCode,
            message: "QR Code gerado. Escaneie para autenticar.",
            authenticated: false
        });
        
    } catch (err) {
        if (err.message === 'Sessão já está autenticada') {
            return res.json({
                status: "ok",
                id_cliente,
                message: "Sessão já está autenticada e conectada.",
                authenticated: true
            });
        }
        
        if (err.message === 'Timeout aguardando QR Code') {
            return res.status(408).json({ 
                error: "Timeout aguardando QR Code", 
                details: "O QR Code não foi gerado dentro do tempo limite de 30 segundos." 
            });
        }
        
        res.status(500).json({ 
            error: "Erro ao criar sessão ou gerar QR Code", 
            details: err.message 
        });
    }
});

/**
 * @swagger
 * /status:
 *   get:
 *     tags: [auth]
 *     summary: 📊 Verificar Status de Sessão
 *     description: |
 *       **Verifica o status detalhado de uma sessão específica** sem interferir na conexão.
 *       
 *       ### 📋 Informações Retornadas:
 *       - **exists**: Se a sessão existe na memória
 *       - **connected**: Se está conectada ao WhatsApp  
 *       - **state**: Estado atual da conexão
 *       - **info**: Dados da conta (quando conectada)
 *       
 *       ### 🎯 Use Cases:
 *       - Monitoramento de conexões
 *       - Health checks automatizados
 *       - Debugging de problemas
 *       
 *       ### 💡 Dica:
 *       Este endpoint é **read-only** e não afeta a sessão existente.
 *     parameters:
 *       - in: query
 *         name: id_cliente
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 50
 *           pattern: '^[a-zA-Z0-9_-]+$'
 *           example: "cliente_123"
 *         description: |
 *           **ID único do cliente** para verificar o status.
 *           
 *           Deve ser o mesmo ID usado na autenticação.
 *     responses:
 *       200:
 *         description: ✅ Status recuperado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       example: "ok"
 *                     id_cliente:
 *                       type: string
 *                       example: "cliente_123"
 *                 - $ref: '#/components/schemas/SessionStatus'
 *             examples:
 *               connected:
 *                 summary: "Sessão Conectada"
 *                 value:
 *                   status: "ok"
 *                   id_cliente: "cliente_123"
 *                   exists: true
 *                   connected: true
 *                   state: "CONNECTED"
 *                   info:
 *                     wid: "5511999999999@c.us"
 *                     pushname: "João Silva"
 *               disconnected:
 *                 summary: "Sessão Desconectada"
 *                 value:
 *                   status: "ok"
 *                   id_cliente: "cliente_456"
 *                   exists: true
 *                   connected: false
 *                   state: "DISCONNECTED"
 *               not_found:
 *                 summary: "Sessão Não Encontrada"
 *                 value:
 *                   status: "ok"
 *                   id_cliente: "cliente_inexistente"
 *                   exists: false
 *                   connected: false
 *                   state: "NOT_FOUND"
 *       400:
 *         description: ❌ Parâmetros inválidos
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "id_cliente é obrigatório"
 *       500:
 *         description: 💥 Erro interno do servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/status", async (req, res) => {
    const { id_cliente } = req.query;

    if (!id_cliente) {
        return res.status(400).json({ error: "id_cliente é obrigatório" });
    }

    try {
        const sessionStatus = await sessionManager.getSessionStatus(id_cliente);
        
        res.json({
            status: "ok",
            id_cliente,
            ...sessionStatus
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao verificar status da sessão", 
            details: err.message 
        });
    }
});

/**
 * @swagger
 * /sessions:
 *   get:
 *     tags: [auth]
 *     summary: 📋 Listar Todas as Sessões
 *     description: |
 *       **Lista todas as sessões ativas** com status detalhado de cada uma.
 *       
 *       ### 📊 Dashboard de Sessões:
 *       - **Visão geral**: Total de sessões em memória
 *       - **Status individual**: Estado de cada cliente
 *       - **Monitoramento**: Identifica problemas rapidamente
 *       
 *       ### 🎯 Use Cases:
 *       - **Administração**: Painel de controle de sessões
 *       - **Monitoramento**: Health check de todas as conexões
 *       - **Analytics**: Métricas de uso da API
 *       - **Debugging**: Identificar sessões com problemas
 *       
 *       ### ⚡ Performance:
 *       Esta operação é otimizada e não afeta as sessões existentes.
 *     responses:
 *       200:
 *         description: ✅ Lista de sessões recuperada com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 total_sessions:
 *                   type: integer
 *                   minimum: 0
 *                   description: "Número total de sessões em memória"
 *                   example: 3
 *                 sessions:
 *                   type: array
 *                   description: "Array com detalhes de cada sessão"
 *                   items:
 *                     allOf:
 *                       - type: object
 *                         properties:
 *                           id_cliente:
 *                             type: string
 *                             example: "cliente_123"
 *                       - $ref: '#/components/schemas/SessionStatus'
 *             examples:
 *               multiple_sessions:
 *                 summary: "Múltiplas Sessões"
 *                 value:
 *                   status: "ok"
 *                   total_sessions: 3
 *                   sessions:
 *                     - id_cliente: "loja_principal"
 *                       exists: true
 *                       connected: true
 *                       state: "CONNECTED"
 *                       info:
 *                         wid: "5511999999999@c.us"
 *                         pushname: "Loja Principal"
 *                     - id_cliente: "atendimento_01"
 *                       exists: true
 *                       connected: false
 *                       state: "DISCONNECTED"
 *                     - id_cliente: "suporte_24h"
 *                       exists: true
 *                       connected: true
 *                       state: "CONNECTED"
 *                       info:
 *                         wid: "5511888888888@c.us"
 *                         pushname: "Suporte 24h"
 *               no_sessions:
 *                 summary: "Nenhuma Sessão"
 *                 value:
 *                   status: "ok"
 *                   total_sessions: 0
 *                   sessions: []
 *       500:
 *         description: 💥 Erro interno do servidor
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/sessions", async (req, res) => {
    try {
        const sessionsList = [];
        const sessionManager = require("../services/sessionManager");
        
        // Pega todas as sessões da memória
        const activeSessionIds = Array.from(sessionManager.sessions.keys());
        
        for (const clientId of activeSessionIds) {
            const sessionStatus = await sessionManager.getSessionStatus(clientId);
            sessionsList.push({
                id_cliente: clientId,
                ...sessionStatus
            });
        }

        res.json({
            status: "ok",
            total_sessions: sessionsList.length,
            sessions: sessionsList
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao listar sessões", 
            details: err.message 
        });
    }
});

module.exports = router;
