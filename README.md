# ReceiptPrinterClub 🖨️

A self-hosted, multitenant print-to-printer server. Anyone on your network can
send text messages and images to registered thermal receipt printers via:

- **Web form** — a polished browser UI
- **Email** — send to `<printer-id>@print.local` over SMTP
- **REST API** — integrate with SMS gateways, bots, or any HTTP client

Messages are queued on the server and automatically printed by a lightweight
client that runs in the background on Windows, macOS, or Linux (or in Docker).
Every platform sends the same ESC/POS commands, so a message prints the same
way everywhere.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Docker (Linux)                       │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │  PrintBridge Server (Node.js / Express)       │    │
│  │                                               │    │
│  │  :3000  Web UI + REST API                     │    │
│  │  :2525  SMTP ingestion                        │    │
│  │                                               │    │
│  │  SQLite database  ·  /data/uploads            │    │
│  └──────────────────────────────────────────────┘    │
└─────────────┬────────────────────────┬───────────────┘
              │ HTTP poll               │ HTTP poll
    ┌─────────▼──────────┐  ┌─────────▼──────────┐
    │ Print Client A     │  │ Print Client B     │
    │ (Windows, USB)     │  │ (Linux, Docker)    │
    └────────────────────┘  └────────────────────┘
```

---

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
ADMIN_PASSWORD=your-secure-password
DOMAIN=print.yourdomain.com   # if using Caddy with a real domain
```

### 2. Start the server

```bash
docker compose up -d
```

By default the compose file includes a **Cloudflare Tunnel** for public access
(no port forwarding needed). To use Caddy with a real domain instead, uncomment
the `caddy` service and comment out `cloudflared` in `docker-compose.yml`.

For local network use only, expose port 3000 directly:
```yaml
ports:
  - "3000:3000"
  - "2525:2525"
```

### 3. Register your printer

Open the web UI → **Register** tab (or `POST /api/printers`).

Fill in the name, description, location, and characters per line (32 for
most 58mm printers, 48 for most 80mm — a test page confirms it later). On
submit you'll receive a **Printer ID** and **API Key** — save the API key
somewhere safe, it's shown only once.

### 4. Set up the print client

These steps are for Windows. For macOS, Linux, Raspberry Pi, or Docker, see
[docs/linux-setup.md](docs/linux-setup.md) and [docs/docker-setup.md](docs/docker-setup.md).

You will need [Node.js](https://nodejs.org/en/download) installed on the machine with the printer.

Copy the `client/` folder to that machine.

```powershell
cd client
npm install

# Create your config
copy .env.example .env
notepad .env
```

Edit `.env`:
```
SERVER_URL=http://your-server:3000
API_KEY=paste-your-api-key-here
PRINTER_NAME=My Thermal Printer   # optional — defaults to the Windows default printer
```

Allow script execution and run the client:
```powershell
Set-ExecutionPolicy Unrestricted -Scope CurrentUser
node client.js
```

The client polls every 5 seconds for new messages and prints them automatically.

Then log in at **My Printer** and click **Print test page**. It shows how
many characters fit per line and whether your printer can print emoji as
pictures — both are set on that page, not in `.env`.

### 5. (Optional) Install as a service

Run once so the client starts on boot (as Administrator on Windows):

```powershell
node install-service.js
# To remove:
node install-service.js remove
```

The service reads `client/.env` each time it starts — after editing `.env`,
restart the service.

### 6. Send a message

- **Web:** open the web UI, select a printer, type a message
- **Email:** send to `<printer-id>@your-server` on port 2525
- **API:** `POST /api/messages` with JSON body

---

## Printing

Every printer is set up the same way: **where it is** goes in the client's
`.env` (`PRINTER_DEVICE` or `PRINTER_NAME`), and **how wide it is** is set on
the My Printer page. Everything else is decided per message.

**Sizes.** Senders pick one of the printer's five built-in sizes. The API
takes a point size (`font_size`) and rounds it to the nearest one.

| Size | `font_size` | Characters per line on a 32 / 42 / 48 printer |
|------|-------------|-----------------------------------------------|
| Small | 7 | 42 / 56 / 64 |
| Normal *(default)* | 9 | 32 / 42 / 48 |
| Medium | 12 | 21 / 28 / 32 |
| Large | 17 | 16 / 21 / 24 |
| X-Large | 25 | 10 / 14 / 16 |

A printer's width is set as its Normal-size characters per line, because
that's what the test page measures — paper size isn't enough: most 58mm
printers fit 32, and 80mm printers fit 48 or, with a narrower print area, 42.

**Formatting** (Text tab, or any API/email message):

```
# Heading          a double-line box, one size larger than the message
## Banner          white text on a black bar
### Title          ─────── Title ─────── divider
#### Subtitle      bold, underlined and centred
---                a divider across the paper
**bold**  __underline__
```

The ASCII Art tab prints exactly as typed — no wrapping, no formatting.

**Alignment.** Senders can align the message Left, Center or Right (`align` in
the API). On the ASCII Art tab the whole picture moves as one block so it stays
intact. Headings, banners, dividers and the From/Time block aren't affected.

**Emoji** print as small black-and-white pictures (from
[Noto Emoji](https://fonts.google.com/noto/specimen/Noto+Emoji), SIL Open Font
License) using the printer's custom-character feature, up to 47 different
emoji per message. Printers without that feature can switch to text stand-ins
(`<3`, `:D`) on the My Printer page.
A message of just 1 to 3 emoji prints at X-Large, whatever size was picked.

**Printers that ignore ESC/POS** (e.g. Star TSP100) can set `PRINT_MODE=driver`
in the client's `.env` to print through the OS driver instead.

---

## Web UI Routes

| Route | Description |
|-------|-------------|
| `/send-message` | Send a message to any printer. `?to=<id>[,<id>]` preselects printers; `?reply=<id>` also fills FROM with the name you last used with that printer |
| `/register` | Register a new printer |
| `/docs` | REST API documentation |
| `/myprinter/login` | Printer owner login (API key) |
| `/myprinter` | Printer settings: characters per line, emoji style, test page |
| `/myprinter/message-history` | Per-printer message history: All, Received, Sent and Threads tabs, refreshing every 15s |
| `/myprinter/subscriptions` | RSS/Atom feed subscriptions |
| `/admin/login` | Super admin login |
| `/admin` | Super admin dashboard (all printers + messages) |
| `/about` | Project credits and links |

**On a phone:** open the site in Safari, then Share → Add to Home Screen. It installs as "RPC" with a black icon and opens full screen. On Android, use Chrome's Install app.

---

## Email Integration

The server listens for inbound SMTP on port **2525**.

> **Security:** the SMTP listener is intentionally unauthenticated and does not
> use TLS. Keep port 2525 on your trusted network / behind a firewall and do not
> expose it to the public internet. Use the HTTP API (behind HTTPS) for public
> integrations.

**Addressing:**
- `<printer-id>@anything` — matches by exact UUID
- `<printer-slug>@anything` — matches by name slug (e.g. `office-main` for "Office Main")

**Configure your mail server** (Postfix, Exchange, etc.) to relay inbound mail
to `your-server:2525`.

**Test with curl:**
```bash
curl smtp://your-server:2525 \
  --mail-from sender@example.com \
  --mail-rcpt "abc-uuid@print.local" \
  --upload-file message.eml
```

---

## REST API

### List printers
```
GET /api/printers
```

### Register printer
```
POST /api/printers
Content-Type: application/json

{ "name": "Office Printer", "description": "58mm thermal", "location": "Room 101", "print_width_dots": 384 }
```

### Send a text message
```
POST /api/messages
Content-Type: application/json
X-API-Key: (optional, tags message source as 'api')

{
  "printer_id": "uuid-here",
  "sender_name": "Twilio SMS",
  "body": "Hello from SMS!",
  "font_size": 12,
  "align": "center"
}
```

### Send a message with image (multipart)
```
POST /api/messages
Content-Type: multipart/form-data
X-API-Key: your-key

printer_id=uuid&body=Check+this+out&image=@photo.jpg
```

### Image by URL / OAuth2

`POST /api/messages` also accepts `image_url` (plus optional `image_headers` for
a bearer token), or `oauth_token_url` with `oauth_client_id` /
`oauth_client_secret` to fetch an authenticated image. By default the server
only fetches public HTTP(S) destinations; localhost, private, link-local, and
cloud-metadata addresses are rejected to prevent SSRF. If you intentionally
integrate with an internal service, set `ALLOW_PRIVATE_NETWORK_FETCH=1` on the
server.

### Twilio SMS webhook example
Point your Twilio SMS webhook to a small adapter that forwards to PrintBridge:

```javascript
app.post("/sms", (req, res) => {
  const { From, Body } = req.body;
  await fetch("http://printbridge:3000/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": "your-key" },
    body: JSON.stringify({
      printer_id: "your-printer-uuid",
      sender_name: From,
      body: Body,
    }),
  });
  res.send("<Response/>"); // TwiML empty response
});
```

---

## Rate Limits

| Scope                | Limit                                                   |
|----------------------|---------------------------------------------------------|
| All API routes       | 300 requests / 60 sec per IP (valid API keys exempt)    |
| Message posting      | 10 / 60 sec per IP; 120 / 60 sec with a valid API key; then a 10-minute cool-off |
| Admin login          | 10 failed attempts / 15 min per IP                      |
| Printer registration | 5 registrations / hour per IP                           |

Limits are per IP. Adjust via environment variables:
```
RATE_LIMIT_WINDOW_MS=60000
API_RATE_LIMIT_MAX=300
AUTOMATION_MESSAGE_RATE_MAX=120
ADMIN_LOGIN_RATE_LIMIT_MAX=10
REGISTRATION_RATE_LIMIT_MAX=5
```

---

## Environment Variables

### Server (`docker-compose.yml` → `environment`)

| Variable              | Default                 | Description                                        |
|-----------------------|-------------------------|----------------------------------------------------|
| `PORT`                | `3000`                  | HTTP port                                          |
| `SMTP_PORT`           | `2525`                  | SMTP ingestion port                                |
| `DATA_DIR`            | `/app/data`             | Persistent data directory                          |
| `UPLOAD_DIR`          | `DATA_DIR/uploads`      | Image upload directory                             |
| `RATE_LIMIT_WINDOW_MS`| `60000`                 | Rate limit window (ms)                             |
| `API_RATE_LIMIT_MAX`  | `300`                   | Max API requests per window per IP                 |
| `AUTOMATION_MESSAGE_RATE_MAX` | `120`          | Messages per window per IP with a valid API key    |
| `ADMIN_LOGIN_RATE_LIMIT_MAX` | `10`             | Failed admin logins per 15 min per IP              |
| `REGISTRATION_RATE_LIMIT_MAX` | `5`              | Printer registrations per hour per IP              |
| `ADMIN_PASSWORD`      | `changeme`              | Password for `/admin/login`                        |
| `ADMIN_TOKEN_SECRET`  | *(random)*              | Optional: stable secret so tokens survive restarts |
| `ALLOW_PRIVATE_NETWORK_FETCH` | —              | Set to `1` to allow URL fetches to private networks (disables the SSRF guard) |
| `TRUST_PROXY`         | —                       | Set to `1` when behind a reverse proxy             |

Generate a stable `ADMIN_TOKEN_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Client (`.env`)

Characters per line and emoji style are **not** client settings — they're on
the My Printer page and reach the client with every poll.

| Variable          | Default                     | Description                       |
|-------------------|-----------------------------|-----------------------------------|
| `SERVER_URL`      | `http://localhost:3000`     | PrintBridge server URL            |
| `API_KEY`         | —                           | **Required.** Your printer's key  |
| `POLL_INTERVAL_MS`| `5000`                      | Poll interval in ms               |
| `PRINTER_DEVICE`  | —                           | Device file to write to: `/dev/usb/lp0`, `/dev/rfcomm0` (Bluetooth), `/dev/cu.usbserial-*` (macOS) |
| `PRINTER_NAME`    | *(system default printer)*  | Print queue name: CUPS on macOS/Linux, Windows printer name |
| `PRINT_MODE`      | `escpos`                    | `driver` for printers that ignore ESC/POS (e.g. Star TSP100) |
| `PRINT_CUPS_MEDIA`| *(Star receipt size)*       | Driver mode on macOS/Linux: CUPS media name |
| `PRINT_BRIGHTNESS`| `40`                        | Image brightness lift before dithering, 0-255 |
| `PRINT_RASTER_CHUNK_ROWS` | `256`               | Max image rows per printer command; lower if tall images print garbled |
| `ARCHIVE_ENABLED` | `true`                      | Keep a local copy of every message |
| `ARCHIVE_DIR`     | `client/archive`            | Where the archive goes            |
| `TEMP_DIR`        | System temp                 | Temp dir for print jobs           |
| `LOG_LEVEL`       | `info`                      | `debug` / `info` / `warn` / `error` |
| `TZ`              | *(container default)*       | IANA timezone for printed/archived timestamps (e.g. `America/Chicago`). **Required in Docker** — otherwise receipts print UTC. |

`PRINT_COLUMNS`, `PRINT_FONT_SIZE`, `PRINT_WIDTH_MM`, `PRINT_DPI` and
`PRINT_CUPS_MODE` are no longer used; the client logs a warning if they're set.

---

## Exposing to the Internet

### Option A — Cloudflare Tunnel (recommended, no port forwarding)

1. Create a tunnel at [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → Networks → Tunnels
2. Set the public hostname to point at `http://server:3000`
3. Paste the tunnel token into `.env`:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token
   ```
4. The `cloudflared` service in `docker-compose.yml` handles the rest

### Option B — Caddy with a real domain

1. Point a DNS A record at your server's public IP
2. Forward ports 80 and 443 on your router to the Docker host
3. Set `DOMAIN=print.yourdomain.com` in `.env`
4. Uncomment the `caddy` service in `docker-compose.yml`

Caddy obtains a free TLS cert from Let's Encrypt automatically.

---

## File Structure

```
receiptprinterclub/
├── .env.example
├── docker-compose.yml
├── Caddyfile
├── frontend/                        # React + TypeScript SPA (Vite)
│   ├── public/                      # Copied as-is into the build: home-screen icons, manifest.webmanifest
│   ├── icons/app-icon.svg           # Icon source; scripts/build-icons.sh renders it into public/
│   ├── src/
│   │   ├── App.tsx                  # Route definitions
│   │   ├── pages/
│   │   │   ├── SendMessageV2.tsx
│   │   │   ├── RegisterPrinter.tsx
│   │   │   ├── ApiDocs.tsx
│   │   │   ├── SuperAdminLogin.tsx  # /admin/login
│   │   │   ├── SuperAdmin.tsx       # /admin dashboard
│   │   │   ├── PrinterLoginPage.tsx # /myprinter/login
│   │   │   ├── PrinterSettings.tsx  # /myprinter
│   │   │   ├── PrinterMessageHistory.tsx
│   │   │   └── PrinterSubscriptions.tsx
│   │   ├── components/
│   │   ├── lib/
│   │   │   └── printerGeometry.ts   # Sizes + characters per line (mirrors client/layout.js)
│   │   ├── hooks/
│   │   │   ├── useAdminAuth.ts
│   │   │   └── useApiKeyAuth.ts
│   │   └── contexts/
│   │       └── PrinterAuthContext.tsx
│   └── package.json
├── server/                          # Express API + SMTP server
│   ├── Dockerfile
│   ├── src/
│   │   ├── index.js                 # Express entry point
│   │   ├── db/index.js              # SQLite access layer
│   │   ├── lib/printerWidth.js      # Printer width + emoji mode validation
│   │   ├── lib/urlSafety.js         # SSRF guard for server-side fetches
│   │   ├── middleware/
│   │   │   ├── rateLimiter.js
│   │   │   └── upload.js
│   │   ├── routes/
│   │   │   ├── admin.js             # Super admin API
│   │   │   ├── printerAdmin.js      # Per-printer admin API
│   │   │   ├── messages.js
│   │   │   ├── printers.js
│   │   │   └── subscriptions.js
│   │   └── services/
│   │       ├── smtp.js              # Inbound SMTP server
│   │       └── feedPoller.js        # RSS/Atom feed polling
│   └── public/                      # Built frontend (output of `npm run build`)
└── client/                          # Print client (Windows, macOS, Linux, Docker)
    ├── client.js                    # Polling, archive, --test-page
    ├── layout.js                    # Message → wrapped lines: sizes, formatting, emoji
    ├── escpos.js                    # Lines + images → one ESC/POS job
    ├── output.js                    # Device / CUPS / Windows spooler; driver fallback
    ├── emoji-glyphs.json            # Pre-rendered emoji bitmaps (Noto Emoji, OFL)
    ├── scripts/build-emoji-glyphs.js # Regenerates emoji-glyphs.json (dev only)
    ├── print-raw.ps1                # Windows: raw ESC/POS to the spooler
    ├── print-text.ps1               # Windows driver mode: text via GDI
    ├── print-image.ps1              # Windows driver mode: images via GDI
    ├── install-service.js           # Windows / macOS / Linux service installer
    ├── Dockerfile
    ├── .env.example
    └── package.json
```

---

## License

MIT — use freely, contribute back!
