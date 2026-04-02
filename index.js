const { Telegraf, Input } = require('telegraf');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

// 1. Inicializar el bot con el Token de Railway
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('👋 Hola chófer. Envíame la foto del CMR y la convertiré en PDF escaneado.'));

bot.on('photo', async (ctx) => {
    let imagePath = null;
    
    try {
        const statusMsg = await ctx.reply('📥 Descargando imagen...');

        // Obtener la resolución más alta
        const photoArray = ctx.message.photo;
        const bestPhoto = photoArray[photoArray.length - 1];
        const fileLink = await ctx.telegram.getFileLink(bestPhoto.file_id);

        // Guardar temporalmente
        const fileName = `${ctx.message.message_id}_${Date.now()}.jpg`;
        imagePath = path.join(__dirname, 'tmp', fileName);
        
        const response = await fetch(fileLink.href);
        const buffer = await response.arrayBuffer();
        await fs.writeFile(imagePath, Buffer.from(buffer));

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⚙️ Procesando con OpenCV...');

        // Ejecutar Python
        const pythonOutput = await new Promise((resolve, reject) => {
            execFile('python3', ['scanner.py', imagePath], (error, stdout) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(stdout.trim());
                }
            });
        });

        if (pythonOutput.includes('ERROR')) {
            throw new Error(`Fallo interno en Python: ${pythonOutput}`);
        }

        if (pythonOutput === 'OK_FALLBACK') {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⚠️ Bordes no detectados. Aplicando filtro B/N y generando PDF...');
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '✅ Documento perfilado. Generando PDF...');
        }

        // Crear PDF
        const processedImageBytes = await fs.readFile(imagePath);
        const pdfDoc = await PDFDocument.create();
        const image = await pdfDoc.embedJpg(processedImageBytes);
        
        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, {
            x: 0,
            y: 0,
            width: image.width,
            height: image.height,
        });

        const pdfBytes = await pdfDoc.save();

        // Enviar documento
        await ctx.replyWithDocument(
            Input.fromBuffer(Buffer.from(pdfBytes), 'CMR_Escaneado.pdf')
        );

        // Limpiar mensaje intermedio
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

    } catch (error) {
        console.error('Crash en pipeline:', error);
        ctx.reply('❌ Ocurrió un error al procesar el documento. Intenta que los bordes del papel se vean más oscuros o toma la foto con mejor luz.');
    } finally {
        // Saneamiento de disco
        if (imagePath) {
            try {
                await fs.unlink(imagePath);
            } catch (cleanupError) {
                console.error(`Error borrando temporal ${imagePath}:`, cleanupError);
            }
        }
    }
});

// =========================================================================
// CONFIGURACIÓN DE WEBHOOKS 100% DEPURADA PARA RAILWAY
// =========================================================================
const webhookDomain = process.env.WEBHOOK_DOMAIN; 
const port = process.env.PORT || 3000;

if (!webhookDomain) {
    console.error('❌ ERROR CRÍTICO: Falta la variable de entorno WEBHOOK_DOMAIN.');
    process.exit(1);
}

const startBot = async (retries = 5) => {
    try {
        // Definir secretPath correctamente basándose en el bot
        const secretPath = `/telegraf/${bot.secretPathComponent()}`;

        await bot.launch({
            dropPendingUpdates: true, 
            webhook: {
                domain: webhookDomain,
                hookPath: secretPath,
                port: port,
                host: '0.0.0.0'
            }
        });
        console.log(`🚀 Bot levantado en puerto ${port} (Host: 0.0.0.0)`);
        console.log(`🔗 Webhook conectado a: ${webhookDomain}${secretPath}`);
    } catch (err) {
        if (err.code === 409 && retries > 0) {
            console.log(`⚠️ Conflicto de despliegue detectado. Reintentando en 5 segundos... (Quedan ${retries} intentos)`);
            setTimeout(() => startBot(retries - 1), 5000);
        } else {
            console.error('❌ Error fatal al iniciar el webhook:', err);
            process.exit(1);
        }
    }
};

// Arrancar el bot
startBot();

// Manejo elegante de reinicios
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
