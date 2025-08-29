const express = require("express");
const routes = require("./routes");
const swaggerUi = require("swagger-ui-express");
const swaggerDocs = require("./docs/swagger");
const sessionManager = require("./services/sessionManager");

const app = express();
app.use(express.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));
app.use("/", routes);

const PORT = process.env.PORT || 3000;

// Função para inicializar a aplicação
async function startServer() {
    console.log("🚀 Iniciando API WhatsApp...");
    
    // Inicia o servidor
    app.listen(PORT, () => {
        console.log(`✅ Servidor rodando na porta ${PORT}`);
        console.log(`📖 Documentação API disponível em: http://localhost:${PORT}/api-docs`);
    });

    // Restaura sessões do WhatsApp em background
    console.log("🔄 Iniciando restauração de sessões do WhatsApp...");
    try {
        await sessionManager.restoreAllSessions();
        console.log("✅ Restauração de sessões concluída");
    } catch (error) {
        console.error("❌ Erro durante restauração de sessões:", error);
    }

    // Inicia limpeza automática de chaves expiradas (a cada 5 minutos)
    setInterval(() => {
        sessionManager.cleanupExpiredKeys();
    }, 5 * 60 * 1000);
    
    console.log("🎉 API WhatsApp totalmente carregada e pronta para uso!");
}

// Inicializar servidor
startServer().catch((err) => {
    console.error("💥 Erro fatal ao iniciar servidor:", err);
    process.exit(1);
});
