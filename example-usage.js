/**
 * 📖 EXEMPLO DE USO DA API WHATSAPP COM SEGURANÇA JWT
 * 
 * Este arquivo demonstra como usar a API de forma segura
 */

const BASE_URL = 'http://localhost:3000';

// ========================================
// 🔐 PASSO 1: AUTENTICAR E OBTER QR CODE
// ========================================
async function authenticateUser(clientId) {
    console.log(`🔄 Iniciando autenticação para cliente: ${clientId}`);
    
    try {
        const response = await fetch(`${BASE_URL}/auth?id_cliente=${clientId}`);
        const data = await response.json();
        
        if (data.authenticated) {
            console.log('✅ Já autenticado! Token:', data.token);
            return data.token;
        }
        
        if (data.qr_code && data.session_key) {
            console.log('📱 QR Code gerado! Escaneie com o WhatsApp:');
            console.log(data.qr_code);
            console.log(`🔑 Session Key: ${data.session_key}`);
            console.log(`⏰ Chave expira em: ${data.key_expires_in}`);
            console.log('\n⏳ Aguardando escaneamento...\n');
            
            // Aguarda autenticação usando a session key
            return await waitForAuthentication(clientId, data.session_key);
        }
        
    } catch (error) {
        console.error('❌ Erro na autenticação:', error);
        throw error;
    }
}

// ========================================
// ⏳ PASSO 2: AGUARDAR ESCANEAMENTO E OBTER TOKEN
// ========================================
async function waitForAuthentication(clientId, sessionKey, maxAttempts = 30) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`🔍 Tentando obter token... (${attempt}/${maxAttempts})`);
            
            const response = await fetch(`${BASE_URL}/get-token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    id_cliente: clientId,
                    session_key: sessionKey
                })
            });
            
            const data = await response.json();
            
            if (data.status === 'ok' && data.token) {
                console.log('🎉 Autenticação bem-sucedida!');
                console.log('🔑 Token JWT obtido:', data.token.substring(0, 50) + '...');
                console.log(`⏰ Token válido por: ${data.expires_in}`);
                return data.token;
            }
            
            if (data.status === 'pending') {
                console.log('⏳ Aguardando escaneamento do QR Code...');
                // Aguarda 3 segundos antes da próxima tentativa
                await sleep(3000);
                continue;
            }
            
            if (response.status === 401) {
                throw new Error('🔒 Session key inválida ou expirada: ' + data.message);
            }
            
        } catch (error) {
            console.error(`❌ Erro na tentativa ${attempt}:`, error.message);
            if (error.message.includes('Session key')) {
                throw error; // Erro fatal, não continuar
            }
        }
    }
    
    throw new Error('⏰ Timeout: Autenticação não foi concluída em tempo hábil');
}

// ========================================
// 📤 PASSO 3: ENVIAR MENSAGEM (PROTEGIDO)
// ========================================
async function sendMessage(token, to, message) {
    console.log(`📤 Enviando mensagem para ${to}...`);
    
    try {
        const response = await fetch(`${BASE_URL}/send-message`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: to,
                message: message
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            console.log('✅ Mensagem enviada com sucesso!');
            console.log('📋 Detalhes:', {
                to: data.to,
                message_id: data.message_id,
                cliente: data.id_cliente
            });
            return data;
        } else {
            console.error('❌ Erro ao enviar mensagem:', data);
            throw new Error(data.error);
        }
        
    } catch (error) {
        console.error('💥 Erro ao enviar mensagem:', error);
        throw error;
    }
}

// ========================================
// 📊 PASSO 4: VERIFICAR STATUS (PROTEGIDO)
// ========================================
async function checkMySession(token) {
    console.log('📊 Verificando status da minha sessão...');
    
    try {
        const response = await fetch(`${BASE_URL}/my-sessions`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            console.log('✅ Status da sessão:', {
                cliente: data.id_cliente,
                conectado: data.session.connected,
                estado: data.session.state
            });
            return data;
        } else {
            console.error('❌ Erro ao verificar sessão:', data);
            throw new Error(data.error);
        }
        
    } catch (error) {
        console.error('💥 Erro ao verificar sessão:', error);
        throw error;
    }
}

// ========================================
// 🚫 DEMONSTRAÇÃO DE SEGURANÇA
// ========================================
async function demonstrateSecurity(tokenA, tokenB) {
    console.log('\n🛡️ DEMONSTRANDO SEGURANÇA:\n');
    
    // Tenta usar token do cliente A para acessar dados do cliente B
    console.log('❌ Tentando usar token do cliente A para acessar cliente B...');
    
    try {
        // Isso deve falhar!
        const response = await fetch(`${BASE_URL}/send-message`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${tokenA}`, // Token do cliente A
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                to: '5511999999999',
                message: 'Mensagem usando token errado'
            })
        });
        
        if (response.ok) {
            console.log('🚨 FALHA DE SEGURANÇA: Token cruzado funcionou!');
        } else {
            console.log('✅ SEGURANÇA OK: Token só funciona para o próprio cliente');
        }
        
    } catch (error) {
        console.log('✅ SEGURANÇA OK: Acesso negado como esperado');
    }
}

// ========================================
// 🎯 FUNÇÃO PRINCIPAL
// ========================================
async function main() {
    console.log('🚀 EXEMPLO DE USO DA API WHATSAPP SEGURA\n');
    
    try {
        // 1. Autenticar cliente A
        const clientA = 'cliente_teste_A';
        const tokenA = await authenticateUser(clientA);
        
        // 2. Enviar mensagem com cliente A
        await sendMessage(tokenA, '5511999999999', 'Olá! Esta é uma mensagem de teste segura!');
        
        // 3. Verificar status da sessão
        await checkMySession(tokenA);
        
        console.log('\n✅ Exemplo concluído com sucesso!');
        console.log('\n📖 Para usar em produção:');
        console.log('1. Guarde o token de forma segura');
        console.log('2. Reutilize o token por até 24h');
        console.log('3. Use HTTPS em produção');
        console.log('4. Defina JWT_SECRET no .env');
        
    } catch (error) {
        console.error('\n💥 Erro no exemplo:', error.message);
    }
}

// ========================================
// 🛠️ UTILITÁRIOS
// ========================================
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// 🏃 EXECUTAR EXEMPLO
// ========================================
if (require.main === module) {
    console.log('⚠️  NOTA: Certifique-se de que o servidor está rodando em http://localhost:3000\n');
    main().catch(console.error);
}

module.exports = {
    authenticateUser,
    waitForAuthentication,
    sendMessage,
    checkMySession,
    demonstrateSecurity
};
