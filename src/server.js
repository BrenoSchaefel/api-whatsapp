const express = require("express");
const sequelize = require("./config/database");
const routes = require("./routes");
const swaggerUi = require("swagger-ui-express");
const swaggerDocs = require("./docs/swagger");
const sessionManager = require("./services/sessionManager");

const app = express();
app.use(express.json());

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerDocs));
app.use("/", routes);

const PORT = process.env.PORT || 3000;

sequelize.authenticate()
    .then(async () => {
        console.log("Conexão com banco de dados bem-sucedida.");
        
        // Inicia o servidor
        app.listen(PORT, () => {
            console.log(`Servidor rodando na porta ${PORT}`);
            console.log(`📖 Documentação API disponível em: http://localhost:${PORT}/api-docs`);
        });

        // Restaura sessões do WhatsApp em background
        console.log("🔄 Iniciando restauração de sessões do WhatsApp...");
        try {
            await sessionManager.restoreAllSessions();
        } catch (error) {
            console.error("❌ Erro durante restauração de sessões:", error);
        }
    })
    .catch((err) => console.error("Erro ao conectar no banco:", err));
