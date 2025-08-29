const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class SessionManager {
    constructor() {
        this.sessions = new Map(); // guarda instâncias por cliente
        this.qrCodes = new Map(); // guarda QR codes por cliente
        this.qrPromises = new Map(); // guarda promises para aguardar QR codes
        this.sessionStates = new Map(); // guarda estado das sessões
        this.authenticatedSessions = new Map(); // guarda quais sessões estão totalmente autenticadas
        this.sessionKeys = new Map(); // guarda chaves únicas para cada sessão
        this.sessionKeyExpiry = new Map(); // guarda quando cada chave expira
    }

    async createSession(clientId) {
        if (this.sessions.has(clientId)) {
            return this.sessions.get(clientId);
        }

        // Gera uma chave única para esta sessão (válida por 10 minutos)
        const sessionKey = this.generateSessionKey(clientId);

        // Cria uma promise para aguardar o QR Code
        let qrResolve, qrReject;
        const qrPromise = new Promise((resolve, reject) => {
            qrResolve = resolve;
            qrReject = reject;
        });

        this.qrPromises.set(clientId, { resolve: qrResolve, reject: qrReject });
        this.sessionStates.set(clientId, 'INITIALIZING');

        const client = new Client({
            authStrategy: new LocalAuth({ clientId }),
            puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
        });

        // Usa o método centralizado para configurar eventos
        this.setupClientEvents(client, clientId);

        client.initialize();

        this.sessions.set(clientId, client);
        
        // Retorna o cliente e a chave da sessão
        return { client, sessionKey };
    }

    getSession(clientId) {
        return this.sessions.get(clientId);
    }

    getQRCode(clientId) {
        return this.qrCodes.get(clientId);
    }

    async waitForQRCode(clientId, timeout = 30000) {
        // Verifica se já existe QR Code
        const existingQR = this.qrCodes.get(clientId);
        if (existingQR) {
            return existingQR;
        }

        // Verifica se a sessão já está realmente conectada
        const isConnected = await this.isSessionConnected(clientId);
        if (isConnected) {
            throw new Error('Sessão já está autenticada');
        }

        // Aguarda o QR Code ser gerado
        const qrPromiseData = this.qrPromises.get(clientId);
        if (!qrPromiseData) {
            throw new Error('Sessão não encontrada ou não está aguardando QR Code');
        }

        // Implementa timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout aguardando QR Code')), timeout);
        });

        try {
            return await Promise.race([
                new Promise((resolve, reject) => {
                    const originalResolve = qrPromiseData.resolve;
                    const originalReject = qrPromiseData.reject;
                    
                    qrPromiseData.resolve = (qrCode) => {
                        originalResolve(qrCode);
                        resolve(qrCode);
                    };
                    
                    qrPromiseData.reject = (error) => {
                        originalReject(error);
                        reject(error);
                    };
                }),
                timeoutPromise
            ]);
        } catch (error) {
            this.qrPromises.delete(clientId);
            throw error;
        }
    }

    async isSessionConnected(clientId) {
        const session = this.sessions.get(clientId);
        if (!session) {
            return false;
        }

        // Verifica primeiro nosso controle de estado interno
        const internalState = this.sessionStates.get(clientId);
        if (internalState === 'CONNECTED') {
            return true;
        }

        // Se o estado interno não for CONNECTED, não está conectado
        if (['INITIALIZING', 'LOADING', 'QR_CODE', 'AUTHENTICATED', 'DISCONNECTED', 'AUTH_FAILURE'].includes(internalState)) {
            return false;
        }

        // Fallback: tenta verificar o estado real apenas se parecer estar pronto
        try {
            if (session.pupPage && !session.pupPage.isClosed()) {
                const state = await session.getState();
                const isConnected = state === 'CONNECTED';
                
                // Atualiza nosso estado interno
                this.sessionStates.set(clientId, isConnected ? 'CONNECTED' : 'DISCONNECTED');
                return isConnected;
            }
            return false;
        } catch (error) {
            console.error(`❌ Erro ao verificar estado da sessão ${clientId}:`, error);
            this.sessionStates.set(clientId, 'ERROR');
            return false;
        }
    }

    async getSessionStatus(clientId) {
        const session = this.sessions.get(clientId);
        if (!session) {
            return {
                exists: false,
                connected: false,
                state: 'NOT_FOUND'
            };
        }

        // Usa nosso controle de estado interno primeiro
        const internalState = this.sessionStates.get(clientId) || 'UNKNOWN';
        const connected = internalState === 'CONNECTED';

        try {
            // Se estiver conectado, tenta obter informações adicionais
            let sessionInfo = null;
            if (connected && session.info) {
                sessionInfo = session.info;
            }

            return {
                exists: true,
                connected: connected,
                state: internalState,
                info: sessionInfo
            };
        } catch (error) {
            console.error(`❌ Erro ao obter status da sessão ${clientId}:`, error);
            return {
                exists: true,
                connected: false,
                state: 'ERROR',
                error: error.message
            };
        }
    }

    async destroySession(clientId) {
        const session = this.sessions.get(clientId);
        if (session) {
            try {
                await session.destroy();
                console.log(`🗑️ Sessão ${clientId} destruída`);
            } catch (error) {
                console.error(`❌ Erro ao destruir sessão ${clientId}:`, error);
            }
        }
        
        // Remove de todas as estruturas de dados
        this.sessions.delete(clientId);
        this.qrCodes.delete(clientId);
        this.qrPromises.delete(clientId);
        this.sessionStates.delete(clientId);
        
        console.log(`🧹 Dados da sessão ${clientId} removidos da memória`);
    }

    async discoverExistingSessions() {
        const wwebSessionPath = path.join(process.cwd(), ".wwebjs_auth");
        
        if (!fs.existsSync(wwebSessionPath)) {
            console.log("📂 Nenhuma pasta de sessões encontrada");
            return [];
        }

        try {
            const sessionDirs = fs.readdirSync(wwebSessionPath)
                .filter(dir => dir.startsWith("session-"))
                .map(dir => dir.replace("session-", ""));

            console.log(`🔍 Encontradas ${sessionDirs.length} sessões existentes: ${sessionDirs.join(", ")}`);
            return sessionDirs;
        } catch (error) {
            console.error("❌ Erro ao descobrir sessões existentes:", error);
            return [];
        }
    }

    async restoreAllSessions() {
        console.log("🔄 Iniciando restauração de sessões...");
        
        const existingSessions = await this.discoverExistingSessions();
        
        if (existingSessions.length === 0) {
            console.log("ℹ️ Nenhuma sessão para restaurar");
            return;
        }

        const restorePromises = existingSessions.map(async (clientId) => {
            try {
                console.log(`🔧 Restaurando sessão para cliente: ${clientId}`);
                await this.restoreSession(clientId);
            } catch (error) {
                console.error(`❌ Erro ao restaurar sessão ${clientId}:`, error);
            }
        });

        await Promise.allSettled(restorePromises);
        console.log("✅ Processo de restauração concluído");
    }

    async restoreSession(clientId) {
        if (this.sessions.has(clientId)) {
            console.log(`⚠️ Sessão ${clientId} já existe em memória`);
            return this.sessions.get(clientId);
        }

        this.sessionStates.set(clientId, 'RESTORING');

        const client = new Client({
            authStrategy: new LocalAuth({ clientId }),
            puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
        });

        // Adiciona todos os event listeners
        this.setupClientEvents(client, clientId);

        try {
            await client.initialize();
            this.sessions.set(clientId, client);
            console.log(`✅ Sessão ${clientId} restaurada com sucesso`);
            return client;
        } catch (error) {
            console.error(`❌ Erro ao restaurar sessão ${clientId}:`, error);
            this.sessionStates.set(clientId, 'RESTORE_ERROR');
            throw error;
        }
    }

    setupClientEvents(client, clientId) {
        client.on("loading_screen", (percent, message) => {
            console.log(`⏳ [${clientId}] Carregando: ${percent}% - ${message}`);
            this.sessionStates.set(clientId, 'LOADING');
        });

        client.on("qr", async (qr) => {
            console.log(`📲 QR Code gerado para cliente ${clientId}`);
            this.sessionStates.set(clientId, 'QR_CODE');
            try {
                const qrCodeBase64 = await QRCode.toDataURL(qr);
                this.qrCodes.set(clientId, qrCodeBase64);
                console.log(`✅ QR Code em base64 salvo para cliente ${clientId}`);
                
                // Resolve a promise com o QR Code
                const qrPromiseData = this.qrPromises.get(clientId);
                if (qrPromiseData) {
                    qrPromiseData.resolve(qrCodeBase64);
                }
            } catch (error) {
                console.error(`❌ Erro ao gerar QR Code base64 para cliente ${clientId}:`, error);
                const qrPromiseData = this.qrPromises.get(clientId);
                if (qrPromiseData) {
                    qrPromiseData.reject(error);
                }
            }
        });

        client.on("authenticated", () => {
            console.log(`🔐 Cliente ${clientId} autenticado`);
            this.sessionStates.set(clientId, 'AUTHENTICATED');
        });

        client.on("ready", () => {
            console.log(`✅ Sessão pronta para cliente ${clientId}`);
            this.sessionStates.set(clientId, 'CONNECTED');
            // Remove o QR Code e promise quando a sessão estiver pronta
            this.qrCodes.delete(clientId);
            this.qrPromises.delete(clientId);
            
            // Marca que esta sessão está totalmente autenticada e conectada
            this.setSessionAuthenticated(clientId, true);
        });

        client.on("auth_failure", () => {
            console.log(`❌ Falha na autenticação para cliente ${clientId}`);
            this.sessionStates.set(clientId, 'AUTH_FAILURE');
            this.qrCodes.delete(clientId);
            this.qrPromises.delete(clientId);
        });

        client.on("disconnected", (reason) => {
            console.log(`🔌 Cliente ${clientId} desconectado: ${reason}`);
            this.sessionStates.set(clientId, 'DISCONNECTED');
            // Remove QR codes e promises quando desconectado
            this.qrCodes.delete(clientId);
            this.qrPromises.delete(clientId);
            // Remove a marca de autenticação
            this.setSessionAuthenticated(clientId, false);
        });

        client.on("message", (msg) => {
            console.log(`📩 [${clientId}] Mensagem de ${msg.from}: ${msg.body}`);
        });
    }

    /**
     * Marca uma sessão como autenticada ou não
     */
    setSessionAuthenticated(clientId, authenticated) {
        this.authenticatedSessions.set(clientId, authenticated);
        console.log(`🔐 Sessão ${clientId} marcada como ${authenticated ? 'autenticada' : 'não autenticada'}`);
    }

    /**
     * Verifica se uma sessão está totalmente autenticada e pronta para uso
     */
    isSessionFullyAuthenticated(clientId) {
        return this.authenticatedSessions.get(clientId) === true;
    }

    /**
     * Envia uma mensagem usando a sessão do cliente
     */
    async sendMessage(clientId, to, message) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            // Formata o número de telefone corretamente
            const formattedNumber = to.includes('@') ? to : `${to}@c.us`;
            const result = await session.sendMessage(formattedNumber, message);
            return result;
        } catch (error) {
            console.error(`❌ Erro ao enviar mensagem via ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Gera uma chave única para a sessão
     */
    generateSessionKey(clientId) {
        const sessionKey = crypto.randomUUID();
        const expiryTime = Date.now() + (10 * 60 * 1000); // 10 minutos
        
        this.sessionKeys.set(clientId, sessionKey);
        this.sessionKeyExpiry.set(clientId, expiryTime);
        
        console.log(`🔑 Chave de sessão gerada para ${clientId}: ${sessionKey.substring(0, 8)}...`);
        return sessionKey;
    }

    /**
     * Verifica se a chave da sessão é válida
     */
    isSessionKeyValid(clientId, providedKey) {
        const storedKey = this.sessionKeys.get(clientId);
        const expiry = this.sessionKeyExpiry.get(clientId);
        
        if (!storedKey || !expiry) {
            return false;
        }
        
        if (Date.now() > expiry) {
            // Chave expirada, remove
            this.sessionKeys.delete(clientId);
            this.sessionKeyExpiry.delete(clientId);
            console.log(`⏰ Chave de sessão expirada para ${clientId}`);
            return false;
        }
        
        return storedKey === providedKey;
    }

    /**
     * Consome uma chave de sessão (remove após uso para obter token)
     */
    consumeSessionKey(clientId, providedKey) {
        if (!this.isSessionKeyValid(clientId, providedKey)) {
            return false;
        }
        
        // Remove a chave após o uso (one-time use)
        this.sessionKeys.delete(clientId);
        this.sessionKeyExpiry.delete(clientId);
        
        console.log(`🗑️ Chave de sessão consumida para ${clientId}`);
        return true;
    }

    /**
     * Limpa chaves expiradas periodicamente
     */
    cleanupExpiredKeys() {
        const now = Date.now();
        
        for (const [clientId, expiry] of this.sessionKeyExpiry.entries()) {
            if (now > expiry) {
                this.sessionKeys.delete(clientId);
                this.sessionKeyExpiry.delete(clientId);
                console.log(`🧹 Chave expirada removida para ${clientId}`);
            }
        }
    }

    /**
     * Desloga/desconecta uma sessão específica
     */
    async logoutSession(clientId) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        try {
            // Tenta fazer logout graceful se possível
            if (await this.isSessionConnected(clientId)) {
                await session.logout();
                console.log(`🚪 Logout realizado para ${clientId}`);
            }
        } catch (error) {
            console.log(`⚠️ Erro no logout graceful para ${clientId}, forçando desconexão:`, error.message);
        }

        // Força destruição da sessão
        await this.destroySession(clientId);
        
        return {
            success: true,
            message: `Sessão ${clientId} deslogada com sucesso`
        };
    }

    /**
     * Obtém a lista de contatos do WhatsApp
     */
    async getContacts(clientId) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            const contacts = await session.getContacts();
            return contacts.map(contact => ({
                id: contact.id._serialized,
                name: contact.name || contact.pushname || 'Sem nome',
                number: contact.number,
                isMyContact: contact.isMyContact,
                isBlocked: contact.isBlocked
            }));
        } catch (error) {
            console.error(`❌ Erro ao obter contatos para ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Obtém a lista de chats do WhatsApp
     */
    async getChats(clientId) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            const chats = await session.getChats();
            return chats.map(chat => ({
                id: chat.id._serialized,
                name: chat.name,
                isGroup: chat.isGroup,
                isReadOnly: chat.isReadOnly,
                unreadCount: chat.unreadCount,
                timestamp: chat.timestamp,
                lastMessage: chat.lastMessage ? {
                    body: chat.lastMessage.body,
                    timestamp: chat.lastMessage.timestamp,
                    from: chat.lastMessage.from
                } : null
            }));
        } catch (error) {
            console.error(`❌ Erro ao obter chats para ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Obtém informações do perfil do WhatsApp
     */
    async getProfileInfo(clientId) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            const info = session.info;
            if (!info) {
                throw new Error('Informações do perfil não disponíveis');
            }

            return {
                wid: info.wid._serialized,
                me: info.me._serialized,
                pushname: info.pushname,
                phone: info.phone ? info.phone.wa_version : null,
                platform: info.phone ? info.phone.device_manufacturer : null
            };
        } catch (error) {
            console.error(`❌ Erro ao obter info do perfil para ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Obtém histórico de mensagens de um chat
     */
    async getChatMessages(clientId, chatId, limit = 50) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            const chat = await session.getChatById(chatId);
            const messages = await chat.fetchMessages({ limit });
            
            return messages.map(msg => ({
                id: msg.id._serialized,
                body: msg.body,
                from: msg.from,
                to: msg.to,
                timestamp: msg.timestamp,
                type: msg.type,
                isFromMe: msg.fromMe,
                hasMedia: msg.hasMedia,
                ack: msg.ack // Status de entrega
            }));
        } catch (error) {
            console.error(`❌ Erro ao obter mensagens do chat ${chatId} para ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Envia mídia (imagem, documento, etc)
     */
    async sendMedia(clientId, to, mediaData, caption = '') {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            const { MessageMedia } = require('whatsapp-web.js');
            const formattedNumber = to.includes('@') ? to : `${to}@c.us`;
            
            let media;
            if (mediaData.url) {
                // Mídia via URL
                media = await MessageMedia.fromUrl(mediaData.url);
            } else if (mediaData.base64) {
                // Mídia via base64
                media = new MessageMedia(mediaData.mimetype, mediaData.base64, mediaData.filename);
            } else {
                throw new Error('Formato de mídia inválido. Use url ou base64');
            }

            const result = await session.sendMessage(formattedNumber, media, { caption });
            return result;
        } catch (error) {
            console.error(`❌ Erro ao enviar mídia via ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Verifica se um número está registrado no WhatsApp
     */
    async checkNumberStatus(clientId, number) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            const formattedNumber = number.includes('@') ? number : `${number}@c.us`;
            const isRegistered = await session.isRegisteredUser(formattedNumber);
            
            return {
                number: number,
                isRegistered: isRegistered,
                formattedNumber: formattedNumber
            };
        } catch (error) {
            console.error(`❌ Erro ao verificar número ${number} para ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Bloqueia ou desbloqueia um contato
     */
    async blockContact(clientId, contactId, block = true) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            const formattedNumber = contactId.includes('@') ? contactId : `${contactId}@c.us`;
            
            if (block) {
                await session.blockContact(formattedNumber);
            } else {
                await session.unblockContact(formattedNumber);
            }

            return {
                success: true,
                action: block ? 'blocked' : 'unblocked',
                contact: formattedNumber
            };
        } catch (error) {
            console.error(`❌ Erro ao ${block ? 'bloquear' : 'desbloquear'} contato ${contactId} para ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Cria um grupo
     */
    async createGroup(clientId, groupName, participants) {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            // Formatar participantes
            const formattedParticipants = participants.map(p => 
                p.includes('@') ? p : `${p}@c.us`
            );

            const group = await session.createGroup(groupName, formattedParticipants);
            
            return {
                id: group.gid._serialized,
                name: groupName,
                participants: formattedParticipants,
                createdAt: new Date().toISOString()
            };
        } catch (error) {
            console.error(`❌ Erro ao criar grupo para ${clientId}:`, error);
            throw error;
        }
    }

    /**
     * Adiciona ou remove participantes de um grupo
     */
    async manageGroupParticipants(clientId, groupId, participants, action = 'add') {
        const session = this.sessions.get(clientId);
        if (!session) {
            throw new Error('Sessão não encontrada');
        }

        if (!this.isSessionFullyAuthenticated(clientId)) {
            throw new Error('Sessão não está autenticada');
        }

        if (!await this.isSessionConnected(clientId)) {
            throw new Error('Sessão não está conectada');
        }

        try {
            const chat = await session.getChatById(groupId);
            
            // Formatar participantes
            const formattedParticipants = participants.map(p => 
                p.includes('@') ? p : `${p}@c.us`
            );

            let result;
            if (action === 'add') {
                result = await chat.addParticipants(formattedParticipants);
            } else if (action === 'remove') {
                result = await chat.removeParticipants(formattedParticipants);
            } else {
                throw new Error('Ação inválida. Use "add" ou "remove"');
            }

            return {
                success: true,
                action: action,
                groupId: groupId,
                participants: formattedParticipants,
                result: result
            };
        } catch (error) {
            console.error(`❌ Erro ao ${action} participantes no grupo ${groupId} para ${clientId}:`, error);
            throw error;
        }
    }
}

module.exports = new SessionManager();
