require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const token = process.env.TELEGRAM_BOT_TOKEN;
let rawDomain = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;

if (!token || !rawDomain) {
    console.error("❌ ERROR FATAL: Faltan variables TELEGRAM_BOT_TOKEN o DOMAIN.");
    process.exit(1);
}

const domain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
const port = process.env.PORT || 8080;

const app = express();
app.use(express.json());

const bot = new TelegramBot(token);
const webhookUrl = `https://${domain}/bot${token}`;

// ==========================================
// 🛡️ HEALTHCHECK / ANTI-SUEÑO PARA RAILWAY
// ==========================================
// Railway pinguea la raíz (/) para ver si el contenedor está vivo.
// Si no respondemos a esto, mata el contenedor a los 30 segundos.
app.get('/', (req, res) => {
    console.log("🟢 Railway Healthcheck: Ping recibido. Todo OK.");
    res.status(200).send("Bot funcionando y vivo.");
});

// ==========================================
// 🔍 CHIVATO GLOBAL: Todo el tráfico HTTP
// ==========================================
app.use((req, res, next) => {
    // Ignoramos el log de la raíz para no saturar la consola
    if (req.url !== '/') {
        console.log(`🔍 [HTTP ENTRANTE] Método: ${req.method} | Ruta: ${req.url}`);
    }
    next();
});

// ==========================================
// 📨 RUTA WEBHOOK: Donde Telegram nos habla
// ==========================================
app.post(`/bot${token}`, (req, res) => {
    console.log("📨 ¡TELEGRAM HA ENVIADO UN EVENTO (UPDATE) AL WEBHOOK!");
    bot.processUpdate(req.body);
    res.sendStatus(200); 
});

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// ==========================================
// 💬 LÓGICA DEL BOT
// ==========================================
bot.on('text', (msg) => {
    console.log(`💬 Texto recibido: "${msg.text}"`);
    bot.sendMessage(msg.chat.id, "✅ ¡Conexión perfecta! Ahora mándame una foto.");
});

bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    console.log(`📸 Foto recibida. Procesando...`);
    
    let waitMsg;
    try {
        waitMsg = await bot.sendMessage(chatId, "⏳ Procesando...");
        
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(photoId);
        const inputPath = path.join(tempDir, `${photoId}.jpg`);
        
        const file = fs.createWriteStream(inputPath);
        https.get(fileLink, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                
                const python = spawn('python3', ['process_image.py', inputPath]);
                let outputPath = '';

                python.stdout.on('data', (data) => {
                    const out = data.toString().trim();
                    if (out) outputPath += out;
                });

                python.stderr.on('data', (data) => {
                    console.error(`🚨 Python Error: ${data.toString().trim()}`);
                });

                python.on('close', async (code) => {
                    if (code === 0 && fs.existsSync(outputPath)) {
                        await bot.sendPhoto(chatId, outputPath);
                        fs.unlinkSync(inputPath);
                        fs.unlinkSync(outputPath);
                    } else {
                        await bot.sendMessage(chatId, "❌ Hubo un error procesando la imagen.");
                    }
                    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
                });
            });
        }).on('error', () => {
            fs.unlinkSync(inputPath);
            bot.sendMessage(chatId, "❌ Error de red descargando la imagen.");
        });
    } catch (err) {
        bot.sendMessage(chatId, "❌ Ocurrió un error inesperado.");
    }
});

// ==========================================
// 🚀 ARRANQUE DE EXPRESS
// ==========================================
app.listen(port, '0.0.0.0', async () => {
    console.log(`🚀 Servidor escuchando en puerto: ${port}`);
    
    try {
        await bot.deleteWebHook();
        await bot.setWebHook(webhookUrl, { drop_pending_updates: true });
        console.log(`✅ WEBHOOK ACTIVO EN: ${webhookUrl}`);
    } catch (error) {
        console.error("❌ Error configurando Webhook:", error);
    }
});
