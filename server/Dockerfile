FROM node:20-alpine

WORKDIR /app

# Build tools needed for better-sqlite3 native module
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Create data directories and run as an unprivileged user.
# The named volume is initialised with these ownerships, so the app can write
# to /app/data without running as root.
RUN addgroup -S printbridge \
 && adduser -S -G printbridge printbridge \
 && mkdir -p /app/data/uploads /app/data/db \
 && chown -R printbridge:printbridge /app

USER printbridge

EXPOSE 3000 2525

CMD ["node", "src/index.js"]
