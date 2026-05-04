# Going Public — Hosting PrintBridge on the Internet

Two options. Pick based on your situation.

---

## Option A: Cloudflare Tunnel ✅ Recommended
**No router config, no static IP, no port forwarding. Free.**

### Steps
1. Sign up at https://cloudflare.com — add your domain, or use a free `*.trycloudflare.com` address for testing.
2. Go to https://one.dash.cloudflare.com → **Zero Trust → Networks → Tunnels → Create tunnel**
3. Name it `printbridge`, copy the **tunnel token**
4. Create a `.env` file in your `printbridge/` folder:
   ```
   CLOUDFLARE_TUNNEL_TOKEN=paste-token-here
   ```
5. In `docker-compose.yml`: **comment out** the `caddy` block, **uncomment** the `cloudflared` block
6. In the Cloudflare dashboard set the tunnel public hostname:
   - Hostname: `print.yourdomain.com`
   - Service: `http://server:3000`
7. `docker compose up -d`

Done — live at `https://print.yourdomain.com` with automatic HTTPS.

---

## Option B: Caddy + Port Forwarding
**Use if you have a static IP or your ISP allows port forwarding.**

### Steps
1. Find your public IP: https://whatismyip.com
2. Create a DNS **A record**: `print.yourdomain.com → your.public.ip`
3. In your router, forward **ports 80 and 443** to your Docker host's local IP
   (find it with `ipconfig | findstr IPv4` in PowerShell)
4. Create `.env`:
   ```
   DOMAIN=print.yourdomain.com
   ```
5. `docker compose up -d`

Caddy fetches a free Let's Encrypt cert automatically on first start.

---

## After going public — update the print client

Edit `client/.env`:
```
SERVER_URL=https://print.yourdomain.com
API_KEY=your-api-key
```

Restart `node client.js`.
