FROM node:22-bullseye

# Install dependencies for Puppeteer/Chromium (required by whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    gconf-service \
    libgbm-dev \
    libasound2 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgcc1 \
    libgconf-2-4 \
    libgdk-pixbuf2.0-0 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    ca-certificates \
    fonts-liberation \
    libappindicator1 \
    libnss3 \
    lsb-release \
    xdg-utils \
    wget \
    chromium \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Skip downloading Chromium through Puppeteer to save space and use the system one
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Copy ONLY package.json to avoid cross-platform lockfile issues with native bindings (Tailwind Oxide)
COPY package.json ./
RUN npm install --build-from-source=sqlite3

# Copy source code
COPY . .

# Build the Vite frontend
RUN npm run build

# Expose the port
EXPOSE 3000

# Define volume for backups/data
VOLUME ["/backup"]

# Set production environment
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
