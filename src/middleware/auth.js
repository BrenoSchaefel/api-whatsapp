const jwt = require('jsonwebtoken');

// Chave secreta para assinar os JWTs (em produção, use uma variável de ambiente)
const JWT_SECRET = process.env.JWT_SECRET || 'whatsapp_api_secret_key_2024';

/**
 * Middleware de autenticação JWT
 * Valida o token e extrai o id_cliente para uso nas rotas
 */
const authenticateToken = (req, res, next) => {
    // Verifica se o header Authorization existe
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer TOKEN"

    if (!token) {
        return res.status(401).json({ 
            error: 'Token de acesso obrigatório',
            message: 'Faça a autenticação primeiro na rota /auth para obter seu token'
        });
    }

    // Verifica e decodifica o token
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ 
                error: 'Token inválido ou expirado',
                message: 'Faça a autenticação novamente na rota /auth'
            });
        }

        // Adiciona o id_cliente ao request para uso nas rotas
        req.id_cliente = decoded.id_cliente;
        req.tokenData = decoded;
        next();
    });
};

/**
 * Gera um token JWT para um cliente específico
 */
const generateToken = (id_cliente) => {
    const payload = {
        id_cliente: id_cliente,
        generated_at: new Date().toISOString()
    };

    // Token expira em 24 horas
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
};

/**
 * Middleware opcional que permite tanto query parameter quanto JWT
 * Usado para rotas de status que podem ser acessadas de ambas as formas
 */
const optionalAuth = (req, res, next) => {
    // Se há JWT, usa ele
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (!err) {
                req.id_cliente = decoded.id_cliente;
                req.tokenData = decoded;
                req.authenticated = true;
            }
        });
    }

    // Se não há JWT ou é inválido, pega do query parameter
    if (!req.id_cliente && req.query.id_cliente) {
        req.id_cliente = req.query.id_cliente;
        req.authenticated = false;
    }

    if (!req.id_cliente) {
        return res.status(400).json({ 
            error: 'id_cliente é obrigatório',
            message: 'Forneça o id_cliente via query parameter ou token JWT'
        });
    }

    next();
};

module.exports = {
    authenticateToken,
    generateToken,
    optionalAuth,
    JWT_SECRET
};
