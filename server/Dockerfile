FROM node:20-alpine

WORKDIR /app

# Build tools needed for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Create data directories
RUN mkdir -p /app/data/uploads /app/data/db

EXPOSE 3000 2525

CMD ["node", "src/index.js"]
