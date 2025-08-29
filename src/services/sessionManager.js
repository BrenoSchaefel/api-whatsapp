const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

class SessionManager {
    constructor() {
        this.sessions = new Map(); // guarda instâncias por cliente
        this.qrCodes = new Map(); // guarda QR codes por cliente
        this.qrPromises = new Map(); // guarda promises para aguardar QR codes
        this.sessionStates = new Map(); // guarda estado das sessões
    }

    async createSession(clientId) {
        if (this.sessions.has(clientId)) {
            return this.sessions.get(clientId);
        }

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
        return client;
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
        });

        client.on("message", (msg) => {
            console.log(`📩 [${clientId}] Mensagem de ${msg.from}: ${msg.body}`);
        });
    }
}

module.exports = new SessionManager();
