# Usamos una base oficial, ligera y predecible
FROM node:20-bookworm-slim

# Evitar prompts interactivos durante apt-get
ENV DEBIAN_FRONTEND=noninteractive

# 1. Instalar Python 3 y dependencias de sistema mínimas requeridas
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Definir el directorio de trabajo
WORKDIR /app

# 2. Configurar Entorno Virtual de Python (Vital para Debian Bookworm / Railway)
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
# Inyectar el entorno virtual en el PATH para que "python" y "pip" lo usen por defecto
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# 3. Instalar dependencias de Python
COPY requirements.txt .
# opencv-python-headless no requiere libglib2.0-0 ni dependencias X11
RUN pip install --no-cache-dir -r requirements.txt

# 4. Instalar dependencias de Node.js
COPY package*.json ./
RUN npm ci --only=production

# 5. Copiar el código fuente
COPY . .

# 6. Crear directorio temporal para procesar imágenes de forma segura
RUN mkdir -p /app/tmp && chmod 777 /app/tmp

# Arrancar el proceso de Node
CMD ["node", "index.js"]
