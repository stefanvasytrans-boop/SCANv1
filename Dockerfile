FROM node:20-bullseye-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .
CMD ["npm", "start"]
