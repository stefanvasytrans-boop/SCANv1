# Base sólida y ligera
FROM node:20-bullseye-slim

# 1. Instalar dependencias del sistema y Python
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# 2. Configurar directorio de trabajo
WORKDIR /app

# 3. Instalar dependencias de Node.js
COPY package*.json ./
RUN npm install --omit=dev

# 4. Instalar dependencias de Python
COPY requirements.txt ./
# El flag break-system-packages es necesario en Debian moderno para instalar pip global
RUN pip3 install --no-cache-dir -r requirements.txt

# 5. Copiar todo el código (bot.js y process_image.py)
COPY . .

# 6. Comando de arranque
CMD ["npm", "start"]
