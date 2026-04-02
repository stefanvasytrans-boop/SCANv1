const { Telegraf, Input } = require('telegraf');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const http = require('http'); // Módulo nativo de Node.js para el Webhook

// 1. Inicializar el bot con el Token de Railway
const bot = new Telegraf(process.env.BOT_TOKEN);

// Manejador del comando /start
bot.start((ctx) => ctx.reply('👋 Hola chófer. Envíame la foto del CMR y la convertiré en PDF escaneado.'));

// 2. Lógica principal: Procesamiento de la foto
bot.on('photo', async (ctx) => {
    let imagePath = null;
    
    try {
        const statusMsg = await ctx.reply('📥 Descargando imagen...');

        // Obtener la resolución más alta
        const photoArray = ctx.message.photo;
        const bestPhoto = photoArray[photoArray.length - 1];
        const fileLink = await ctx.telegram.getFileLink(bestPhoto.file_id);

        // Crear directorio temporal si no existe y guardar la imagen
        const tmpDir = path.join(__dirname, 'tmp');
        await fs.mkdir(tmpDir, { recursive: true });
        
        const fileName = `${ctx.message.message_id}_${Date.now()}.jpg`;
        imagePath = path.join(tmpDir, fileName);
        
        // Descargar imagen
        const response = await fetch(fileLink.href);
        const buffer = await response.arrayBuffer();
        await fs.writeFile(imagePath, Buffer.from(buffer));

        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⚙️ Procesando con OpenCV...');

        // Ejecutar el script de Python (OpenCV)
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

        // Manejar el resultado de Python
        if (pythonOutput === 'OK_FALLBACK') {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '⚠️ Bordes no detectados. Aplicando filtro B/N completo y generando PDF...');
        } else {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, '✅ Documento perfilado correctamente. Generando PDF...');
        }

        // Leer la imagen procesada y crear el PDF
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

        // Enviar el PDF terminado al usuario
        await ctx.replyWithDocument(
            Input.fromBuffer(Buffer.from(pdfBytes), 'CMR_Escaneado.pdf')
        );

        // Limpiar el mensaje de estado intermedio
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);

    } catch (error) {
        console.error('❌ Crash en pipeline:', error);
        ctx.reply('❌ Ocurrió un error al procesar el documento. Intenta que los bordes del papel se vean más oscuros o toma la foto con mejor luz.');
    } finally {
        // Limpieza obligatoria del disco duro
        if (imagePath) {
            try {
                await fs.unlink(imagePath);
            } catch (cleanupError) {
                console.error(`⚠️ Error borrando temporal ${imagePath}:`, cleanupError);
            }
        }
    }
});

// =========================================================================
// 3. CONFIGURACIÓN DE INFRAESTRUCTURA: WEBHOOKS VÍA SERVIDOR HTTP NATIVO
// =========================================================================

const webhookDomain = process.env.WEBHOOK_DOMAIN; 
const internalPort = process.env.PORT || 3000;

// Validar que el dominio exista
if (!webhookDomain) {
    console.error('❌ ERROR CRÍTICO: Falta la variable de entorno WEBHOOK_DOMAIN en Railway.');
    process.exit(1);
}

// Generar la ruta secreta dinámica de Telegram
const secretPath = `/telegraf/${bot.secretPathComponent()}`;
const fullWebhookUrl = `${webhookDomain}${secretPath}`;

const startServer = async () => {
    try {
        console.log(`📡 Registrando Webhook en la API de Telegram: ${fullWebhookUrl}`);
        
        // Registrar el Webhook explícitamente en los servidores de Telegram
        await bot.telegram.setWebhook(fullWebhookUrl, {
            drop_pending_updates: true // Limpiar mensajes atascados anteriores
        });

        // Crear el servidor HTTP nativo
        const server = http.createServer((req, res) => {
            if (req.method === 'POST' && req.url === secretPath) {
                // Si la petición viene de Telegram a la ruta secreta, la procesa Telegraf
                bot.webhookCallback(secretPath)(req, res);
            } else {
                // Ruta pública (Healthcheck): Para comprobar que Railway enruta bien
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/plain');
                res.end('Bot CMR Scanner operando correctamente. Webhook activo.');
            }
        });

        // Levantar el servidor
        server.listen(internalPort, '0.0.0.0', () => {
            console.log(`🚀 Servidor HTTP levantado en el puerto interno: ${internalPort}`);
            console.log(`✅ BOT LISTO. Puedes enviarle una foto por Telegram.`);
        });

        // Manejo de apagado seguro (Graceful shutdown) sin invocar métodos erróneos de Telegraf
        process.once('SIGINT', () => {
            console.log('🛑 Recibida señal SIGINT. Apagando servidor HTTP...');
            server.close(() => {
                console.log('✅ Servidor cerrado correctamente.');
                process.exit(0);
            });
        });

        process.once('SIGTERM', () => {
            console.log('🛑 Recibida señal SIGTERM. Apagando servidor HTTP...');
            server.close(() => {
                console.log('✅ Servidor cerrado correctamente.');
                process.exit(0);
            });
        });

    } catch (err) {
        console.error('❌ Error crítico al arrancar la infraestructura:', err);
        
        // Sistema Anti-Crash para los Rolling Deploys de Railway
        if (err.response && err.response.error_code === 409) {
            console.log(`⚠️ Conflicto 409 detectado. El contenedor viejo sigue vivo. Reintentando en 5s...`);
            setTimeout(startServer, 5000);
        } else {
            process.exit(1);
        }
    }
};

// Ejecutar el arranque
startServer();
