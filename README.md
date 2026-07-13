# ReceiptPrinterClub 🖨️

A self-hosted, multitenant print-to-printer server. Anyone on your network can
send text messages and images to registered Windows printers via:

- **Web form** — a polished browser UI
- **Email** — send to `<printer-id>@print.local` over SMTP
- **REST API** — integrate with SMS gateways, bots, or any HTTP client

Messages are queued on the server and automatically printed by a lightweight
Windows client that runs in the background.

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
    │ Windows Client A   │  │ Windows Client B   │
    │ (Office Printer)   │  │ (Warehouse Printer)│
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

Fill in the name, description, and location. On submit you'll receive a
**Printer ID** and **API Key** — save the API key somewhere safe, it's shown
only once.

### 4. Set up the Windows print client

You will need [Node.js](https://nodejs.org/en/download) installed on the Windows machine.

Copy the `client/` folder to your Windows machine (the one with the printer).

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
```

Allow script execution and run the client:
```powershell
Set-ExecutionPolicy Unrestricted -Scope CurrentUser
node client.js
```

The client polls every 5 seconds for new messages and prints them automatically
to the Windows default printer.

### 5. (Optional) Install as a Windows service

Run once as Administrator so the client starts on boot:

```powershell
node install-service.js
# To remove:
node install-service.js remove
```

### 6. Send a message

- **Web:** open the web UI, select a printer, type a message
- **Email:** send to `<printer-id>@your-server` on port 2525
- **API:** `POST /api/messages` with JSON body

---

## Web UI Routes

| Route | Description |
|-------|-------------|
| `/send-message` | Send a message to any printer |
| `/register` | Register a new printer |
| `/docs` | REST API documentation |
| `/myprinter/login` | Printer owner login (API key) |
| `/myprinter` | Printer settings dashboard |
| `/myprinter/message-history` | Per-printer message history |
| `/myprinter/subscriptions` | RSS/Atom feed subscriptions |
| `/admin/login` | Super admin login |
| `/admin` | Super admin dashboard (all printers + messages) |
| `/about` | Project credits and links |

---

## Email Integration

The server listens for inbound SMTP on port **2525**.

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

{ "name": "Office Printer", "description": "HP LaserJet", "location": "Room 101" }
```

### Send a text message
```
POST /api/messages
Content-Type: application/json
X-API-Key: (optional, tags message source as 'api')

{
  "printer_id": "uuid-here",
  "sender_name": "Twilio SMS",
  "body": "Hello from SMS!"
}
```

### Send a message with image (multipart)
```
POST /api/messages
Content-Type: multipart/form-data
X-API-Key: your-key

printer_id=uuid&body=Check+this+out&image=@photo.jpg
```

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

| Scope            | Limit                  |
|------------------|------------------------|
| All API routes   | 10 requests / 60 sec   |
| Message posting  | 3 messages / 60 sec    |

Limits are per IP. Adjust via environment variables:
```
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=10
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
| `RATE_LIMIT_MAX`      | `10`                    | Max requests per window                            |
| `ADMIN_PASSWORD`      | `changeme`              | Password for `/admin/login`                        |
| `ADMIN_TOKEN_SECRET`  | *(random)*              | Optional: stable secret so tokens survive restarts |
| `TRUST_PROXY`         | —                       | Set to `1` when behind a reverse proxy             |

Generate a stable `ADMIN_TOKEN_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Client (`.env`)

| Variable          | Default                     | Description                       |
|-------------------|-----------------------------|-----------------------------------|
| `SERVER_URL`      | `http://localhost:3000`     | PrintBridge server URL            |
| `API_KEY`         | —                           | **Required.** Your printer's key  |
| `POLL_INTERVAL_MS`| `5000`                      | Poll interval in ms               |
| `SUMATRA_PATH`    | —                           | Path to SumatraPDF.exe            |
| `TEMP_DIR`        | System temp                 | Temp dir for downloaded files     |
| `LOG_LEVEL`       | `info`                      | `debug` / `info` / `warn` / `error` |

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
└── client/                          # Windows print client
    ├── client.js                    # Main polling + print client
    ├── install-service.js           # Windows service installer
    ├── print-text.ps1
    ├── print-image.ps1
    ├── .env.example
    └── package.json
```

---

## License

MIT — use freely, contribute back!
