const express = require("express");
const router = express.Router();
const sessionManager = require("../services/sessionManager");
const { generateToken, optionalAuth, authenticateToken } = require("../middleware/auth");

/**
 * @swagger
 * /auth:
 *   get:
 *     tags: [auth]
 *     summary: 🔐 Gerar QR Code
 *     description: |
 *       Gera QR Code para autenticação no WhatsApp e retorna session_key.
 *       
 *       **Próximo passo**: Escaneie o QR Code e use `/get-token` com a session_key.
 *     parameters:
 *       - in: query
 *         name: id_cliente
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-zA-Z0-9_-]+$'
 *           example: "cliente_123"
 *         description: ID único do cliente (letras, números, _ e -)
 *     responses:
 *       200:
 *         description: ✅ QR Code gerado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 id_cliente:
 *                   type: string
 *                   example: "cliente_123"
 *                 qr_code:
 *                   type: string
 *                   description: "QR Code em base64"
 *                 session_key:
 *                   type: string
 *                   description: "Chave para obter JWT (válida 10 min)"
 *                 key_expires_in:
 *                   type: string
 *                   example: "10 minutos"
 *       400:
 *         description: ❌ id_cliente obrigatório
 *       408:
 *         description: ⏰ Timeout QR Code (30s)
 *       500:
 *         description: 💥 Erro interno
 */
router.get("/auth", async (req, res) => {
    const { id_cliente } = req.query;

    if (!id_cliente) {
        return res.status(400).json({ error: "id_cliente é obrigatório" });
    }

    try {
        // Verifica o status real da sessão
        const sessionStatus = await sessionManager.getSessionStatus(id_cliente);
        
        if (sessionStatus.connected && sessionManager.isSessionFullyAuthenticated(id_cliente)) {
            return res.json({
                status: "ok",
                id_cliente,
                message: "Sessão já está autenticada e conectada. Use /get-token com a session_key para obter o token JWT.",
                authenticated: true,
                session_state: sessionStatus.state,
                requires_session_key: true
            });
        }

        // Se a sessão existe mas não está conectada, destrói e recria
        if (sessionStatus.exists && !sessionStatus.connected) {
            console.log(`🔄 Sessão ${id_cliente} existe mas não está conectada. Recriando...`);
            await sessionManager.destroySession(id_cliente);
        }

        // Cria a sessão se não existir ou se foi destruída
        const { client, sessionKey } = await sessionManager.createSession(id_cliente);
        
        // Aguarda o QR Code ser gerado (máximo 30 segundos)
        const qrCode = await sessionManager.waitForQRCode(id_cliente, 30000);
        
        res.json({
            status: "ok",
            id_cliente,
            qr_code: qrCode,
            session_key: sessionKey,
            message: "QR Code gerado. Escaneie para autenticar e use a session_key para obter o token JWT.",
            authenticated: false,
            key_expires_in: "10 minutos"
        });
        
    } catch (err) {
        if (err.message === 'Sessão já está autenticada') {
            return res.json({
                status: "ok",
                id_cliente,
                message: "Sessão já está autenticada e conectada. Use /get-token com a session_key para obter o token JWT.",
                authenticated: true,
                requires_session_key: true
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
/**
 * @swagger
 * /get-token:
 *   post:
 *     tags: [auth]
 *     summary: 🔑 Obter Token JWT
 *     description: |
 *       Após escanear o QR Code, use a session_key para obter o token JWT.
 *       
 *       **Token válido por 24h**. Session_key é consumida após uso.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id_cliente, session_key]
 *             properties:
 *               id_cliente:
 *                 type: string
 *                 example: "cliente_123"
 *               session_key:
 *                 type: string
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *                 description: "Recebida em /auth"
 *     responses:
 *       200:
 *         description: ✅ Token obtido ou aguardando
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: ["ok", "pending"]
 *                 token:
 *                   type: string
 *                   description: "JWT (só se status=ok)"
 *                 message:
 *                   type: string
 *       400:
 *         description: ❌ Campos obrigatórios
 *       401:
 *         description: 🔒 Session_key inválida/expirada
 *       500:
 *         description: 💥 Erro interno
 */
router.post("/get-token", async (req, res) => {
    const { id_cliente, session_key } = req.body;

    if (!id_cliente || !session_key) {
        return res.status(400).json({ 
            error: "Campos 'id_cliente' e 'session_key' são obrigatórios" 
        });
    }

    try {
        // Verifica se a chave da sessão é válida
        if (!sessionManager.isSessionKeyValid(id_cliente, session_key)) {
            return res.status(401).json({
                error: "Chave de sessão inválida ou expirada",
                message: "A session_key fornecida não é válida ou já expirou. Faça a autenticação novamente."
            });
        }

        const sessionStatus = await sessionManager.getSessionStatus(id_cliente);
        
        // Verifica se a sessão está autenticada
        if (!sessionStatus.connected || !sessionManager.isSessionFullyAuthenticated(id_cliente)) {
            return res.json({
                status: "pending",
                id_cliente,
                message: "Sessão ainda não foi autenticada. Escaneie o QR Code primeiro.",
                session_state: sessionStatus.state
            });
        }

        // Consome a chave (one-time use) e gera o token
        if (!sessionManager.consumeSessionKey(id_cliente, session_key)) {
            return res.status(401).json({
                error: "Erro ao processar chave de sessão",
                message: "A chave não pôde ser processada. Tente novamente."
            });
        }

        const token = generateToken(id_cliente);
        
        res.json({
            status: "ok",
            id_cliente,
            token: token,
            message: "Token JWT gerado com sucesso!",
            expires_in: "24 horas"
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao gerar token", 
            details: err.message 
        });
    }
});

/**
 * @swagger
 * /status:
 *   get:
 *     tags: [messages]
 *     summary: 📊 Status da Sessão
 *     description: Verifica o status da sessão autenticada.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ✅ Status recuperado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 session:
 *                   $ref: '#/components/schemas/SessionStatus'
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro interno
 */
router.get("/status", authenticateToken, async (req, res) => {
    try {
        const sessionStatus = await sessionManager.getSessionStatus(req.id_cliente);
        
        res.json({
            status: "ok",
            id_cliente: req.id_cliente,
            session: sessionStatus
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
 * /send-message:
 *   post:
 *     tags: [messages]
 *     summary: 📤 Enviar Mensagem
 *     description: Envia mensagem de texto via WhatsApp.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, message]
 *             properties:
 *               to:
 *                 type: string
 *                 example: "5511999999999"
 *                 description: "Número com código do país"
 *               message:
 *                 type: string
 *                 example: "Olá! Mensagem de teste."
 *     responses:
 *       200:
 *         description: ✅ Mensagem enviada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 message_id:
 *                   type: string
 *                 to:
 *                   type: string
 *       400:
 *         description: ❌ Campos obrigatórios
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao enviar
 */
router.post("/send-message", authenticateToken, async (req, res) => {
    const { to, message } = req.body;

    if (!to || !message) {
        return res.status(400).json({ 
            error: "Campos 'to' e 'message' são obrigatórios" 
        });
    }

    try {
        const result = await sessionManager.sendMessage(req.id_cliente, to, message);
        
        res.json({
            status: "ok",
            id_cliente: req.id_cliente,
            message: "Mensagem enviada com sucesso",
            to: result.to,
            sent_message: message,
            message_id: result.id._serialized
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao enviar mensagem", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /my-sessions:
 *   get:
 *     tags: [auth]
 *     summary: 👤 Minha Sessão
 *     description: Retorna dados da sessão do cliente autenticado.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ✅ Dados recuperados
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 session:
 *                   $ref: '#/components/schemas/SessionStatus'
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro interno
 */
router.get("/my-sessions", authenticateToken, async (req, res) => {
    try {
        const sessionStatus = await sessionManager.getSessionStatus(req.id_cliente);

        res.json({
            status: "ok",
            id_cliente: req.id_cliente,
            session: sessionStatus
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao recuperar dados da sessão", 
            details: err.message 
        });
    }
});

/**
 * @swagger
 * /logout:
 *   post:
 *     tags: [auth]
 *     summary: 🚪 Deslogar WhatsApp
 *     description: |
 *       Desloga e desconecta a sessão do WhatsApp.
 *       
 *       **Após logout, será necessário novo QR Code.**
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ✅ Logout realizado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 message:
 *                   type: string
 *                   example: "Sessão deslogada com sucesso"
 *                 logged_out:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: 🔒 Token obrigatório
 *       404:
 *         description: 📭 Sessão não encontrada
 *       500:
 *         description: 💥 Erro no logout
 */
router.post("/logout", authenticateToken, async (req, res) => {
    try {
        const result = await sessionManager.logoutSession(req.id_cliente);

        res.json({
            status: "ok",
            id_cliente: req.id_cliente,
            message: result.message,
            logged_out: true
        });
        
    } catch (err) {
        if (err.message === 'Sessão não encontrada') {
            return res.status(404).json({
                error: "Sessão não encontrada",
                message: "Não há sessão ativa para este cliente",
                id_cliente: req.id_cliente
            });
        }
        
        res.status(500).json({ 
            error: "Erro ao realizar logout", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

module.exports = router;
