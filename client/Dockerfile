# PrintBridge Client — container image
#
# Pure JavaScript — no native dependencies. Includes cups-client (`lp`) so a
# CUPS queue works as well as a raw device.
#
#   docker build -t printbridge-client .

FROM node:20-alpine

# cups-client provides `lp`/`lpstat`, used when PRINTER_NAME is set instead of
# PRINTER_DEVICE. It's a couple hundred KB, so it's always included.
RUN apk add --no-cache cups-client tzdata

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --omit=optional \
  && npm cache clean --force

COPY . .

# Archive + temp dirs. Mount a volume over /app/archive to persist printed
# message history across container restarts/rebuilds.
RUN mkdir -p /app/archive /tmp/printbridge && chown -R 1000:1000 /tmp/printbridge

ENV TEMP_DIR=/tmp/printbridge
ENV ARCHIVE_DIR=/app/archive
ENV NODE_ENV=production

# Non-root by default, reusing the `node` user/group (uid/gid 1000) that the
# base image already provides — adding a new one at 1000 fails since it's
# taken. Raw device access (/dev/usb/lp0 etc.) is owned by a specific group
# on the host — see docs/docker-setup.md for how to join it with
# `--group-add` at `docker run` time, or run as root if you'd rather not deal
# with group IDs (fine for a single-purpose printer box).
RUN chown -R node:node /app
USER node

CMD ["node", "client.js"]
