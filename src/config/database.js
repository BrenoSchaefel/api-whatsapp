// 🗄️ CONFIGURAÇÃO DO BANCO DE DADOS
// ====================================
// Este arquivo está comentado pois o banco não está sendo usado no momento.
// Descomente quando for implementar persistência no futuro.

/*
const { Sequelize } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: "postgres",
        logging: false,
    }
);

module.exports = sequelize;
*/

// Por enquanto, exporta null para não quebrar imports existentes
module.exports = null;