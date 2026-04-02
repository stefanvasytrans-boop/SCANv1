const { Telegraf, Input } = require('telegraf');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

// El token vendrá inyectado por las Variables de Entorno de Railway
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('👋 Hola chófer. Envíame la foto del CMR y la convertiré en PDF escaneado.'));

bot.on('photo', async (ctx) => {
    let imagePath = null;
    
    try {
        const statusMsg = await ctx.reply('📥 Descargando imagen...');

        // 1. Obtener la resolución más alta (último elemento del array)
        const photoArray = ctx.message.photo;
        const bestPhoto = photoArray[photoArray.length - 1];
        const fileLink = await ctx.telegram.getFileLink(bestPhoto.file_id);

        // 2. Guardar temporalmente en el volumen aislado
        const fileName = `${ctx.message.message_id}_${Date.now()}.jpg`;
        imagePath = path.join(__dirname, 'tmp', fileName);
        
        // Descarga nativa en Node 18/20
        const response = await fetch(fileLink.href);
        const buffer = await response.arrayBuffer();
        await fs.writeFile(imagePath, Buffer.from(buffer));

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⚙️ Procesando con OpenCV...');

        // 3. Ejecutar el pipeline de Python
        const pythonOutput = await new Promise((resolve, reject) => {
            execFile('python', ['scanner.py', imagePath], (error, stdout) => {
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

        // 4. Manejo de estados y fallback
        if (pythonOutput === 'OK_FALLBACK') {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⚠️ Bordes del papel no detectados. Aplicando filtro escáner completo y generando PDF...');
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '✅ Documento perfilado correctamente. Generando PDF...');
        }

        // 5. Lectura de la imagen sobrescrita y conversión a PDF
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

        // 6. Enviar documento final
        await ctx.replyWithDocument(
            Input.fromBuffer(Buffer.from(pdfBytes), 'CMR_Escaneado.pdf')
        );

        // Limpiar mensajes intermedios para mejor UX
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

    } catch (error) {
        console.error('Crash en pipeline:', error);
        ctx.reply('❌ Ocurrió un error al procesar el documento. Intenta que los bordes del papel se vean más oscuros o toma la foto desde más arriba.');
    } finally {
        // 7. Saneamiento obligatorio: Evitar saturar el disco de Railway
        if (imagePath) {
            try {
                await fs.unlink(imagePath);
            } catch (cleanupError) {
                console.error(`Error borrando temporal ${imagePath}:`, cleanupError);
            }
        }
    }
});

// Levantar el servidor
bot.launch(() => {
    console.log('🚀 CMR Scanner Bot inicializado y corriendo.');
});

// Manejo elegante de reinicios en Railway
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
