FROM node:alpine3.20

WORKDIR /app

# Copy files
COPY package.json ./
RUN npm install
COPY . .

# Ensure tmp directory exists
RUN mkdir -p .tmp

EXPOSE 3000

CMD ["node", "server.js"]