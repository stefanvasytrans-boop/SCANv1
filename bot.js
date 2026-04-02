require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Variables de entorno inyectadas por Railway
const token = process.env.TELEGRAM_BOT_TOKEN;
// En Railway, la variable RAILWAY_PUBLIC_DOMAIN se inyecta automáticamente si tienes dominio público
const domain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.DOMAIN; 

if (!token || !domain) {
    console.error("❌ ERROR: Faltan variables TELEGRAM_BOT_TOKEN o RAILWAY_PUBLIC_DOMAIN");
    process.exit(1);
}

// 1. Inicializar Bot en modo WEBHOOK (sin polling)
const bot = new TelegramBot(token);
const app = express();
app.use(express.json());

// 2. Configurar la ruta secreta (Nadie más puede llamar a este endpoint salvo Telegram)
const webhookRuta = `/bot${token}`;
const webhookUrl = `https://${domain}${webhookRuta}`;

bot.setWebHook(webhookUrl).then(() => {
    console.log(`✅ Webhook inyectado con éxito en: ${webhookUrl}`);
});

// 3. El Router recibe el PUSH de Telegram
app.post(webhookRuta, (req, res) => {
    // Respondemos 200 OK inmediatamente a Telegram para que cierre la conexión y no haga reintentos
    res.sendStatus(200); 
    // Pasamos el paquete al bot
    bot.processUpdate(req.body);
});

// Crear carpeta temporal
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// Función auxiliar de descarga
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(dest); });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
}

// 4. Lógica de Recepción de Fotos
bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const waitMsg = await bot.sendMessage(chatId, "⏳ Se procesează imaginea...");

    try {
        // Extraer la foto con mejor resolución (última del array)
        const photoId = msg.photo[msg.photo.length - 1].file_id;
        const fileLink = await bot.getFileLink(photoId);
        
        // Descargar la imagen
        const inputPath = path.join(tempDir, `${Date.now()}_input.jpg`);
        await downloadFile(fileLink, inputPath);

        // Disparar Python asíncronamente
        const pythonProcess = spawn('python3', ['process_image.py', inputPath]);

        let outputData = '';
        let errorData = '';

        pythonProcess.stdout.on('data', (data) => { outputData += data.toString(); });
        pythonProcess.stderr.on('data', (data) => { errorData += data.toString(); });

        pythonProcess.on('close', async (code) => {
            if (code !== 0) {
                console.error("Error Python:", errorData);
                await bot.editMessageText("❌ Eroare la procesarea imaginii.", { chat_id: chatId, message_id: waitMsg.message_id });
                return;
            }

            // Python devuelve el path del archivo procesado en stdout
            const outputPath = outputData.trim();

            if (fs.existsSync(outputPath)) {
                // Enviar la foto resultante
                await bot.sendPhoto(chatId, outputPath);
                await bot.deleteMessage(chatId, waitMsg.message_id);

                // Limpieza de disco (Vital en Railway)
                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
            }
        });

    } catch (error) {
        console.error(error);
        await bot.editMessageText("❌ Eroare internă.", { chat_id: chatId, message_id: waitMsg.message_id });
    }
});

// 5. Encender el servidor en modo Railway IPv6 Dual Binding
const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '::', () => {
    console.log(`🌍 Edge Router escuchando tráfico de Telegram en puerto ${PORT}`);
});
