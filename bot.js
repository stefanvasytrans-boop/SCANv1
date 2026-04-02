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

// Limpiar el dominio para que quede perfecto (ej: scanv1-production.up.railway.app)
const domain = rawDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
const port = process.env.PORT || 8080;

const app = express();
app.use(express.json());

// Inicializar el bot SIN polling (usaremos Express)
const bot = new TelegramBot(token);
const webhookUrl = `https://${domain}/bot${token}`;

// ==========================================
// 🔍 CHIVATO GLOBAL: Todo el tráfico HTTP
// ==========================================
app.use((req, res, next) => {
    console.log(`🔍 [HTTP ENTRANTE] Método: ${req.method} | Ruta: ${req.url}`);
    next();
});

// ==========================================
// 📨 RUTA WEBHOOK: Donde Telegram nos habla
// ==========================================
app.post(`/bot${token}`, (req, res) => {
    console.log("📨 ¡TELEGRAM HA ENVIADO UN EVENTO (UPDATE) AL WEBHOOK!");
    bot.processUpdate(req.body);
    res.sendStatus(200); // Hay que responder 200 rápido o Telegram nos bloquea
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
    console.log(`💬 Mensaje de texto recibido de ${msg.chat.id}: "${msg.text}"`);
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
        
        console.log(`⬇️ Descargando imagen desde: ${fileLink}`);
        
        const file = fs.createWriteStream(inputPath);
        https.get(fileLink, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✅ Imagen guardada correctamente en: ${inputPath}`);
                
                console.log("🐍 Lanzando script de Python (OpenCV)...");
                const python = spawn('python3', ['process_image.py', inputPath]);
                let outputPath = '';

                // Capturar lo que Python imprime como resultado
                python.stdout.on('data', (data) => {
                    const out = data.toString().trim();
                    if (out) outputPath += out;
                    console.log(`🐍 Python STDOUT (Mensaje): ${out}`);
                });

                // Capturar ERRORES de Python
                python.stderr.on('data', (data) => {
                    console.error(`🚨 Python STDERR (Error): ${data.toString().trim()}`);
                });

                // Cuando Python termina de ejecutarse
                python.on('close', async (code) => {
                    console.log(`🐍 Python terminó con código de salida: ${code}`);
                    
                    if (code === 0 && fs.existsSync(outputPath)) {
                        console.log("📤 Enviando foto procesada de vuelta a Telegram...");
                        await bot.sendPhoto(chatId, outputPath);
                        
                        // Limpieza
                        fs.unlinkSync(inputPath);
                        fs.unlinkSync(outputPath);
                        console.log("🧹 Archivos temporales borrados con éxito.");
                    } else {
                        console.error("❌ Fallo crítico en el script de Python o el archivo no se generó.");
                        await bot.sendMessage(chatId, "❌ Hubo un error procesando la imagen con OpenCV en el servidor.");
                    }
                    
                    // Borrar el mensaje de "⏳ Procesando..."
                    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => console.log("⚠️ No se pudo borrar el msg de espera."));
                });
            });
        }).on('error', (err) => {
            console.error("❌ Error descargando la imagen:", err.message);
            fs.unlinkSync(inputPath);
            bot.sendMessage(chatId, "❌ Error de red descargando la imagen.");
        });
    } catch (err) {
        console.error("❌ Error general en bot.on('photo'):", err);
        bot.sendMessage(chatId, "❌ Ocurrió un error inesperado en el servidor Node.js.");
    }
});

// ==========================================
// 🚀 ARRANQUE DE EXPRESS Y CONFIGURACIÓN
// ==========================================
app.listen(port, async () => {
    console.log(`🚀 Servidor Express arrancado y escuchando en el puerto: ${port}`);
    
    try {
        console.log("🧹 Limpiando webhooks anteriores atascados en Telegram...");
        await bot.deleteWebHook();
        
        console.log("🔗 Inyectando el nuevo Webhook limpio...");
        // drop_pending_updates: true borra la cola de mensajes atascados que estén bloqueando el bot
        await bot.setWebHook(webhookUrl, { drop_pending_updates: true });
        console.log(`✅ WEBHOOK ACTIVO EN: ${webhookUrl}`);
    } catch (error) {
        console.error("❌ Error crítico configurando el Webhook:", error);
    }
});
