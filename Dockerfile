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

WORKDIR /app

# 2. Instalar dependencias de Node.js (con install normal)
COPY package*.json ./
RUN npm install --omit=dev

# 3. Instalar dependencias de Python (sin el flag problemático)
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# 4. Copiar código y arrancar
COPY . .
CMD ["npm", "start"]
