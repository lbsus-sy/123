FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY server.js .
COPY store.js .
COPY config-generator.js .
COPY public public/
COPY data/ data/

# Ensure data directory exists
RUN mkdir -p /app/data

# Railway provides PORT env automatically
EXPOSE 3000

# Health check for Railway
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3000}/ || exit 1

CMD ["node", "server.js"]