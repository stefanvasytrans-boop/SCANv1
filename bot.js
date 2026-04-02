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

// Inicializamos el bot de Telegram
const bot = new TelegramBot(token);
const webhookUrl = `https://${domain}/bot${token}`;

// ==========================================
// 🛡️ HEALTHCHECK / ANTI-SUEÑO PARA RAILWAY
// ==========================================
app.get('/', (req, res) => {
    console.log("🟢 Railway Healthcheck: Ping recibido. Todo OK.");
    res.status(200).send("Bot funcionando y vivo.");
});

// ==========================================
// 🔍 CHIVATO GLOBAL: Todo el tráfico HTTP
// ==========================================
app.use((req, res, next) => {
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
    // Respondemos a Telegram rápido para que no nos bloquee
    res.sendStatus(200); 
    // Procesamos el mensaje
    bot.processUpdate(req.body);
});

// Crear directorio temporal si no existe
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
    console.log("📁 Directorio temporal 'temp' creado.");
}

// ==========================================
// 💬 LÓGICA DEL BOT: Textos
// ==========================================
bot.on('text', (msg) => {
    console.log(`💬 Texto recibido: "${msg.text}"`);
    bot.sendMessage(msg.chat.id, "✅ ¡Conexión perfecta! El bot te escucha. Ahora mándame una foto.");
});

// ==========================================
// 📸 LÓGICA DEL BOT: Fotos + Python
// ==========================================
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    console.log(`📸 Foto recibida del chat: ${chatId}`);
    
    let waitMsg;
    try {
        waitMsg = await bot.sendMessage(chatId, "⏳ Recibida. Descargando y procesando...");
        
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(photoId);
        const inputPath = path.join(tempDir, `${photoId}.jpg`);
        
        console.log(`⬇️ Descargando imagen...`);
        
        const file = fs.createWriteStream(inputPath);
        https.get(fileLink, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✅ Imagen guardada correctamente.`);
                
                console.log("🐍 Lanzando script de Python (OpenCV)...");
                const python = spawn('python3', ['process_image.py', inputPath]);
                let outputPath = '';

                python.stdout.on('data', (data) => {
                    const out = data.toString().trim();
                    if (out) outputPath += out;
                    console.log(`🐍 Python STDOUT: ${out}`);
                });

                python.stderr.on('data', (data) => {
                    console.error(`🚨 Python STDERR: ${data.toString().trim()}`);
                });

                python.on('close', async (code) => {
                    console.log(`🐍 Python terminó con código: ${code}`);
                    
                    if (code === 0 && fs.existsSync(outputPath)) {
                        console.log("📤 Enviando foto procesada...");
                        await bot.sendPhoto(chatId, outputPath);
                        
                        fs.unlinkSync(inputPath);
                        fs.unlinkSync(outputPath);
                        console.log("🧹 Archivos temporales borrados.");
                    } else {
                        console.error("❌ Fallo en el script de Python.");
                        await bot.sendMessage(chatId, "❌ Hubo un error procesando la imagen con OpenCV.");
                    }
                    
                    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
                });
            });
        }).on('error', (err) => {
            console.error("❌ Error descargando la imagen:", err.message);
            fs.unlinkSync(inputPath);
            bot.sendMessage(chatId, "❌ Error de red descargando la imagen.");
        });
    } catch (err) {
        console.error("❌ Error en bot.on('photo'):", err);
        bot.sendMessage(chatId, "❌ Ocurrió un error inesperado.");
    }
});

// ==========================================
// 🚀 ARRANQUE DE EXPRESS
// ==========================================
app.listen(port, '0.0.0.0', async () => {
    console.log(`🚀 Servidor escuchando en puerto: ${port}`);
    
    try {
        // En lugar de borrar y poner el webhook a lo bruto, usamos una forma más suave
        // Solo lo configuramos si no está ya configurado
        console.log(`🔗 Verificando Webhook en: ${webhookUrl}`);
        await bot.setWebHook(webhookUrl);
        console.log("✅ WEBHOOK CONFIRMADO.");
    } catch (error) {
        console.error("❌ Error configurando Webhook:", error);
    }
});
