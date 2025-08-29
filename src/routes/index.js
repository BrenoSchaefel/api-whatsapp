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
 * /verify-token:
 *   get:
 *     tags: [auth]
 *     summary: ✅ Verificar Token
 *     description: |
 *       Verifica se o token JWT é válido e retorna informações básicas.
 *       
 *       **Útil para**: Validar autenticação no frontend.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ✅ Token válido
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 valid:
 *                   type: boolean
 *                   example: true
 *                 id_cliente:
 *                   type: string
 *                   example: "cliente_123"
 *                 issued_at:
 *                   type: string
 *                   example: "2024-01-15T10:30:00Z"
 *       401:
 *         description: 🔒 Token inválido/expirado
 *       500:
 *         description: 💥 Erro interno
 */
router.get("/verify-token", authenticateToken, async (req, res) => {
    try {
        res.json({
            status: "ok",
            valid: true,
            id_cliente: req.id_cliente,
            issued_at: req.tokenData.generated_at
        });
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao verificar token", 
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

/**
 * @swagger
 * /contacts:
 *   get:
 *     tags: [messages]
 *     summary: 📞 Listar Contatos
 *     description: Obtém a lista de contatos do WhatsApp.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ✅ Contatos recuperados
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 total:
 *                   type: integer
 *                   example: 150
 *                 contacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: "5511999999999@c.us"
 *                       name:
 *                         type: string
 *                         example: "João Silva"
 *                       number:
 *                         type: string
 *                         example: "5511999999999"
 *                       isMyContact:
 *                         type: boolean
 *                       isBlocked:
 *                         type: boolean
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao obter contatos
 */
router.get("/contacts", authenticateToken, async (req, res) => {
    try {
        const contacts = await sessionManager.getContacts(req.id_cliente);
        
        res.json({
            status: "ok",
            total: contacts.length,
            contacts: contacts
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao obter contatos", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /chats:
 *   get:
 *     tags: [messages]
 *     summary: 💬 Listar Conversas
 *     description: Obtém a lista de conversas/chats do WhatsApp.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ✅ Conversas recuperadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 total:
 *                   type: integer
 *                   example: 25
 *                 chats:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: "5511999999999@c.us"
 *                       name:
 *                         type: string
 *                         example: "João Silva"
 *                       isGroup:
 *                         type: boolean
 *                       unreadCount:
 *                         type: integer
 *                       lastMessage:
 *                         type: object
 *                         properties:
 *                           body:
 *                             type: string
 *                           timestamp:
 *                             type: integer
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao obter conversas
 */
router.get("/chats", authenticateToken, async (req, res) => {
    try {
        const chats = await sessionManager.getChats(req.id_cliente);
        
        res.json({
            status: "ok",
            total: chats.length,
            chats: chats
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao obter conversas", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /profile:
 *   get:
 *     tags: [messages]
 *     summary: 👤 Informações do Perfil
 *     description: Obtém informações do perfil do WhatsApp autenticado.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ✅ Perfil recuperado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 profile:
 *                   type: object
 *                   properties:
 *                     wid:
 *                       type: string
 *                       example: "5511999999999@c.us"
 *                     pushname:
 *                       type: string
 *                       example: "Meu Nome"
 *                     phone:
 *                       type: string
 *                       example: "2.2409.2"
 *                     platform:
 *                       type: string
 *                       example: "android"
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao obter perfil
 */
router.get("/profile", authenticateToken, async (req, res) => {
    try {
        const profile = await sessionManager.getProfileInfo(req.id_cliente);

        res.json({
            status: "ok",
            profile: profile
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao obter informações do perfil", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /chats/{chatId}/messages:
 *   get:
 *     tags: [messages]
 *     summary: 📜 Histórico de Mensagens
 *     description: Obtém o histórico de mensagens de um chat específico.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *           example: "5511999999999@c.us"
 *         description: ID do chat
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           minimum: 1
 *           maximum: 100
 *         description: Número máximo de mensagens
 *     responses:
 *       200:
 *         description: ✅ Mensagens recuperadas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 chatId:
 *                   type: string
 *                 total:
 *                   type: integer
 *                 messages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       body:
 *                         type: string
 *                       from:
 *                         type: string
 *                       timestamp:
 *                         type: integer
 *                       isFromMe:
 *                         type: boolean
 *                       hasMedia:
 *                         type: boolean
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao obter mensagens
 */
router.get("/chats/:chatId/messages", authenticateToken, async (req, res) => {
    const { chatId } = req.params;
    const { limit = 50 } = req.query;

    try {
        const messages = await sessionManager.getChatMessages(req.id_cliente, chatId, parseInt(limit));
        
        res.json({
            status: "ok",
            chatId: chatId,
            total: messages.length,
            messages: messages
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao obter mensagens", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /send-media:
 *   post:
 *     tags: [messages]
 *     summary: 🖼️ Enviar Mídia
 *     description: |
 *       Envia mídia (imagem, documento, áudio, vídeo) via WhatsApp.
 *       
 *       **Formatos suportados**: JPG, PNG, GIF, PDF, MP4, MP3, etc.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, media]
 *             properties:
 *               to:
 *                 type: string
 *                 example: "5511999999999"
 *               media:
 *                 type: object
 *                 oneOf:
 *                   - properties:
 *                       url:
 *                         type: string
 *                         example: "https://example.com/image.jpg"
 *                   - properties:
 *                       base64:
 *                         type: string
 *                         example: "data:image/jpeg;base64,/9j/4AAQ..."
 *                       mimetype:
 *                         type: string
 *                         example: "image/jpeg"
 *                       filename:
 *                         type: string
 *                         example: "foto.jpg"
 *               caption:
 *                 type: string
 *                 example: "Legenda da imagem"
 *     responses:
 *       200:
 *         description: ✅ Mídia enviada
 *       400:
 *         description: ❌ Dados inválidos
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao enviar mídia
 */
router.post("/send-media", authenticateToken, async (req, res) => {
    const { to, media, caption = '' } = req.body;

    if (!to || !media) {
        return res.status(400).json({ 
            error: "Campos 'to' e 'media' são obrigatórios" 
        });
    }

    try {
        const result = await sessionManager.sendMedia(req.id_cliente, to, media, caption);
        
        res.json({
            status: "ok",
            id_cliente: req.id_cliente,
            message: "Mídia enviada com sucesso",
            to: result.to,
            message_id: result.id._serialized,
            caption: caption
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao enviar mídia", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /check-number:
 *   post:
 *     tags: [messages]
 *     summary: ✅ Verificar Número
 *     description: Verifica se um número está registrado no WhatsApp.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [number]
 *             properties:
 *               number:
 *                 type: string
 *                 example: "5511999999999"
 *                 description: "Número com código do país"
 *     responses:
 *       200:
 *         description: ✅ Número verificado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 number:
 *                   type: string
 *                 isRegistered:
 *                   type: boolean
 *                 formattedNumber:
 *                   type: string
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao verificar número
 */
router.post("/check-number", authenticateToken, async (req, res) => {
    const { number } = req.body;

    if (!number) {
        return res.status(400).json({ 
            error: "Campo 'number' é obrigatório" 
        });
    }

    try {
        const result = await sessionManager.checkNumberStatus(req.id_cliente, number);
        
        res.json({
            status: "ok",
            ...result
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao verificar número", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /contacts/{contactId}/block:
 *   post:
 *     tags: [messages]
 *     summary: 🚫 Bloquear/Desbloquear
 *     description: Bloqueia ou desbloqueia um contato.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: contactId
 *         required: true
 *         schema:
 *           type: string
 *           example: "5511999999999"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               block:
 *                 type: boolean
 *                 example: true
 *                 description: "true para bloquear, false para desbloquear"
 *     responses:
 *       200:
 *         description: ✅ Ação realizada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 action:
 *                   type: string
 *                   enum: ["blocked", "unblocked"]
 *                 contact:
 *                   type: string
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro na operação
 */
router.post("/contacts/:contactId/block", authenticateToken, async (req, res) => {
    const { contactId } = req.params;
    const { block = true } = req.body;

    try {
        const result = await sessionManager.blockContact(req.id_cliente, contactId, block);
        
        res.json({
            status: "ok",
            ...result
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: `Erro ao ${block ? 'bloquear' : 'desbloquear'} contato`, 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /groups:
 *   post:
 *     tags: [messages]
 *     summary: 👥 Criar Grupo
 *     description: Cria um novo grupo no WhatsApp.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, participants]
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Meu Grupo Novo"
 *               participants:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["5511999999999", "5511888888888"]
 *                 description: "Lista de números dos participantes"
 *     responses:
 *       200:
 *         description: ✅ Grupo criado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 group:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     participants:
 *                       type: array
 *                     createdAt:
 *                       type: string
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao criar grupo
 */
router.post("/groups", authenticateToken, async (req, res) => {
    const { name, participants } = req.body;

    if (!name || !participants || !Array.isArray(participants)) {
        return res.status(400).json({ 
            error: "Campos 'name' e 'participants' (array) são obrigatórios" 
        });
    }

    try {
        const result = await sessionManager.createGroup(req.id_cliente, name, participants);
        
        res.json({
            status: "ok",
            group: result
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao criar grupo", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

/**
 * @swagger
 * /groups/{groupId}/participants:
 *   post:
 *     tags: [messages]
 *     summary: 👥 Gerenciar Participantes
 *     description: Adiciona ou remove participantes de um grupo.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *           example: "120363123456789012@g.us"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [participants, action]
 *             properties:
 *               participants:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["5511999999999"]
 *               action:
 *                 type: string
 *                 enum: ["add", "remove"]
 *                 example: "add"
 *     responses:
 *       200:
 *         description: ✅ Participantes gerenciados
 *       401:
 *         description: 🔒 Token obrigatório
 *       500:
 *         description: 💥 Erro ao gerenciar participantes
 */
router.post("/groups/:groupId/participants", authenticateToken, async (req, res) => {
    const { groupId } = req.params;
    const { participants, action } = req.body;

    if (!participants || !Array.isArray(participants) || !action) {
        return res.status(400).json({ 
            error: "Campos 'participants' (array) e 'action' são obrigatórios" 
        });
    }

    try {
        const result = await sessionManager.manageGroupParticipants(req.id_cliente, groupId, participants, action);

        res.json({
            status: "ok",
            ...result
        });
        
    } catch (err) {
        res.status(500).json({ 
            error: "Erro ao gerenciar participantes", 
            details: err.message,
            id_cliente: req.id_cliente
        });
    }
});

module.exports = router;
