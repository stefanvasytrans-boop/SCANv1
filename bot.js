require('dotenv').config();
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
const url = `https://${domain}/bot${token}`;

console.log("🚀 Iniciando servidor Telegram en modo Webhook...");

// ==========================================
// 🔗 INICIALIZAR EL BOT CON WEBHOOK NATIVO
// ==========================================
// Usamos webHooks nativo en lugar de Express. Es 100% compatible con Railway.
const bot = new TelegramBot(token, {
    webHook: {
        port: port,
        host: '0.0.0.0'
    }
});

// Forzamos el registro del webhook en Telegram
bot.setWebHook(url, { drop_pending_updates: true }).then(() => {
    console.log(`✅ WEBHOOK CONFIRMADO: Telegram sabe que estamos en ${url}`);
}).catch(err => {
    console.error("❌ Error configurando Webhook:", err);
});

// Chivato de conexiones
bot.on("webhook_error", (error) => {
    console.error(`🚨 Error Webhook: ${error.code}`, error);
});

// Directorio temporal
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
