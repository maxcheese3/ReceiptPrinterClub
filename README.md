# PrintBridge 🖨️

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

### 1. Start the server

```bash
# Clone / copy this repo to your Docker host
cd printbridge

# Start the server
docker compose up -d

# Server is now running at http://localhost:3000
```

### 2. Register your printer

Open `http://localhost:3000` → **Register Printer** tab.

Fill in the name, description, and location. On submit you'll receive a
**Printer ID** and **API Key** — save the API key somewhere safe, it's shown
only once.

### 3. Set up the Windows print client

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
SERVER_URL=http://your-docker-host:3000
API_KEY=paste-your-api-key-here
```

Run the client:
```powershell
node client.js
```

The client polls every 5 seconds for new messages and prints them automatically
to the **Windows default printer**.

### 4. (Optional) Install as a Windows service

Run once as Administrator so the client starts on boot:

```powershell
node install-service.js
# To remove:
node install-service.js remove
```

### 5. Send a message

- **Web:** open `http://your-server:3000`, select the printer, type a message.
- **Email:** send to `<printer-id>@your-server` on port 2525.
- **API:** `POST /api/messages` with JSON body.

---

## Printing quality

For the best print results, install **SumatraPDF** on each Windows client machine:

https://www.sumatrapdfreader.org/download-free-pdf-viewer

Then set in `.env`:
```
SUMATRA_PATH=C:\Program Files\SumatraPDF\SumatraPDF.exe
```

Without SumatraPDF, the client falls back to PowerShell print commands which
work but may have formatting limitations.

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

| Variable              | Default     | Description                         |
|-----------------------|-------------|-------------------------------------|
| `PORT`                | `3000`      | HTTP port                           |
| `SMTP_PORT`           | `2525`      | SMTP ingestion port                 |
| `DATA_DIR`            | `/app/data` | Persistent data directory           |
| `UPLOAD_DIR`          | `DATA_DIR/uploads` | Image upload directory      |
| `RATE_LIMIT_WINDOW_MS`| `60000`     | Rate limit window (ms)              |
| `RATE_LIMIT_MAX`      | `10`        | Max requests per window             |
| `BASE_URL`            | `http://localhost:3000` | Public server URL          |

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

To let people send messages from outside your LAN:

1. Forward port `3000` (and optionally `2525`) on your router to the Docker host.
2. Set `BASE_URL` in docker-compose to your public IP or domain.
3. Consider putting Nginx or Caddy in front for HTTPS.

Example Caddy reverse proxy:
```
your-domain.com {
  reverse_proxy localhost:3000
}
```

---

## File Structure

```
printbridge/
├── docker-compose.yml
├── server/
│   ├── Dockerfile
│   ├── package.json
│   ├── public/
│   │   ├── index.html
│   │   ├── css/style.css
│   │   └── js/app.js
│   └── src/
│       ├── index.js              # Express entry point
│       ├── db/index.js           # SQLite access layer
│       ├── middleware/
│       │   ├── rateLimiter.js
│       │   └── upload.js
│       ├── routes/
│       │   ├── messages.js
│       │   └── printers.js
│       └── services/
│           └── smtp.js           # Inbound SMTP server
└── client/
    ├── package.json
    ├── .env.example
    ├── client.js                 # Main polling + print client
    └── install-service.js        # Windows service installer
```

---

## License

MIT — use freely, contribute back!
