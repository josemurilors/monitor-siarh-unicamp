FROM mcr.microsoft.com/playwright:v1.60.0-focal

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "monitor-concursos.js"]
