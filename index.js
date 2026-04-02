const { Telegraf, Input } = require('telegraf');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

// 1. Inicializar el bot
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('👋 Hola chófer. Envíame la foto del CMR y la convertiré en PDF escaneado.'));

bot.on('photo', async (ctx) => {
    let imagePath = null;
    
    try {
        const statusMsg = await ctx.reply('📥 Descargando imagen...');

        const photoArray = ctx.message.photo;
        const bestPhoto = photoArray[photoArray.length - 1];
        const fileLink = await ctx.telegram.getFileLink(bestPhoto.file_id);

        const fileName = `${ctx.message.message_id}_${Date.now()}.jpg`;
        imagePath = path.join(__dirname, 'tmp', fileName);
        
        const response = await fetch(fileLink.href);
        const buffer = await response.arrayBuffer();
        await fs.writeFile(imagePath, Buffer.from(buffer));

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⚙️ Procesando con OpenCV...');

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
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⚠️ Bordes del papel no detectados. Aplicando filtro B/N completo y generando PDF...');
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '✅ Documento perfilado correctamente. Generando PDF...');
        }

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

        await ctx.replyWithDocument(
            Input.fromBuffer(Buffer.from(pdfBytes), 'CMR_Escaneado.pdf')
        );

        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

    } catch (error) {
        console.error('Crash en pipeline:', error);
        ctx.reply('❌ Ocurrió un error al procesar el documento. Intenta que los bordes del papel se vean más oscuros o toma la foto con mejor luz.');
    } finally {
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
// CONFIGURACIÓN DE WEBHOOKS (Blindada para la nube de Railway)
// =========================================================================
const webhookDomain = process.env.WEBHOOK_DOMAIN; // Debe ser https://...
const port = process.env.PORT || 3000;

if (!webhookDomain) {
    console.error('❌ ERROR CRÍTICO: Falta la variable de entorno WEBHOOK_DOMAIN.');
    process.exit(1);
}

// Arranque con protección de host y limpieza de cola
bot.launch({
    dropPendingUpdates: true, // Elimina mensajes atascados para empezar limpios
    webhook: {
        domain: webhookDomain,
        port: port,
        host: '0.0.0.0' // CRÍTICO: Obligatorio para que Railway detecte el puerto
    }
}).then(() => {
    console.log(`🚀 Bot levantado en puerto ${port} (Host: 0.0.0.0)`);
    console.log(`🔗 Webhook conectado a: ${webhookDomain}`);
}).catch((err) => {
    console.error('❌ Error fatal al iniciar el webhook:', err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
