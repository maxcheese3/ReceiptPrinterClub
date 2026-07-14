# PrintBridge Client — container image
#
# Default build: raw ESC/POS support (no native deps) + cups-client (`lp`)
# so CUPS mode also works out of the box. Canvas (legacy PRINT_CUPS_MODE=image
# text rendering) is opt-in via a build arg since it needs a slower native
# build and isn't needed by the default, recommended print path.
#
#   docker build -t printbridge-client .
#   docker build -t printbridge-client --build-arg WITH_CANVAS=true .

FROM node:20-alpine

# cups-client provides `lp`/`lpstat`, used by CUPS mode (PRINTER_NAME set).
# Raw ESC/POS mode (PRINTER_DEVICE set, the default recommendation) doesn't
# need it, but it's a couple hundred KB so it's always included for convenience.
RUN apk add --no-cache cups-client

ARG WITH_CANVAS=false
RUN if [ "$WITH_CANVAS" = "true" ]; then \
      apk add --no-cache build-base cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev python3; \
    fi

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --omit=optional \
  && if [ "$WITH_CANVAS" = "true" ]; then npm install canvas; fi \
  && npm cache clean --force

COPY . .

# Archive + temp dirs. Mount a volume over /app/archive to persist printed
# message history across container restarts/rebuilds.
RUN mkdir -p /app/archive /tmp/printbridge

ENV TEMP_DIR=/tmp/printbridge
ENV ARCHIVE_DIR=/app/archive
ENV NODE_ENV=production

# Non-root by default. Raw device access (/dev/usb/lp0 etc.) is owned by a
# specific group on the host — see docs/docker-setup.md for how to join it
# with `--group-add` at `docker run` time, or run as root if you'd rather
# not deal with group IDs (fine for a single-purpose printer box).
RUN addgroup -g 1000 printbridge && adduser -D -u 1000 -G printbridge printbridge
USER printbridge

CMD ["node", "client.js"]
