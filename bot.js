require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const token = process.env.TELEGRAM_BOT_TOKEN;
// Limpiamos la URL por si la pegaste con https://
let rawDomain = process.env.DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;

if (!token || !rawDomain) {
    console.error("❌ ERROR FATAL: Faltan variables TELEGRAM_BOT_TOKEN o DOMAIN en Railway.");
    process.exit(1);
}

// Limpiamos el dominio de barras y protocolos extra
const domain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
// Railway asigna un puerto dinámico obligatorio
const port = process.env.PORT || 3000;

// Inicializamos Express y TelegramBot en modo Webhook
const app = express();
app.use(express.json());
const bot = new TelegramBot(token);

const webhookUrl = `https://${domain}/bot${token}`;

// Le decimos a Telegram dónde enviarnos las peticiones HTTP
bot.setWebHook(webhookUrl).then(() => {
    console.log(`✅ Webhook inyectado en Telegram: ${webhookUrl}`);
});

// Router principal: Recibe el tráfico de Telegram y se lo pasa al bot
app.post(`/bot${token}`, (req, res) => {
    res.sendStatus(200); // Contestamos rápido a Telegram para no atascar su red
    bot.processUpdate(req.body);
});

// Crear carpeta temporal segura
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// ---------------- LÓGICA DEL BOT ----------------

bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const waitMsg = await bot.sendMessage(chatId, "⏳ Procesando imagen en la nube...");

    try {
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(photoId);
        const inputPath = path.join(tempDir, `${photoId}.jpg`);
        
        // Descargamos la imagen
        const file = fs.createWriteStream(inputPath);
        https.get(fileLink, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                
                // Ejecutamos Python de fondo
                const python = spawn('python3', ['process_image.py', inputPath]);
                let outputPath = '';

                python.stdout.on('data', (data) => {
                    outputPath += data.toString().trim();
                });

                python.on('close', async (code) => {
                    if (code === 0 && fs.existsSync(outputPath)) {
                        // Enviamos la foto procesada
                        await bot.sendPhoto(chatId, outputPath);
                        // Borramos rastro
                        fs.unlinkSync(inputPath);
                        fs.unlinkSync(outputPath);
                    } else {
                        await bot.sendMessage(chatId, "❌ Falló el procesado con OpenCV.");
                    }
                    await bot.deleteMessage(chatId, waitMsg.message_id);
                });
            });
        });
    } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "❌ Ocurrió un error.");
    }
});

bot.on('message', (msg) => {
    if (!msg.photo && !msg.text?.startsWith('/')) {
        bot.sendMessage(msg.chat.id, "👋 Hola. Mándame una foto y Python la procesará.");
    }
});

// ARRANQUE DEL SERVIDOR (Vital para Railway)
app.listen(port, () => {
    console.log(`🚀 Servidor arrancado y escuchando en el puerto: ${port}`);
});
