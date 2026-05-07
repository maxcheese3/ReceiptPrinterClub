# Linux / macOS Client Setup

The PrintBridge client runs on Linux and macOS using CUPS for printing.

## Prerequisites

### 1. CUPS
CUPS must be installed and your printer registered.

```bash
# Debian / Ubuntu
sudo apt install cups

# Fedora / RHEL
sudo dnf install cups

# List available printers
lpstat -p

# Test print to verify printer name
echo "test" | lp -d your-printer-name
```

### 2. Node.js (18+)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install nodejs
```

### 3. canvas dependencies
The `canvas` npm package renders text to PNG before sending to CUPS.
It requires some system libraries:

```bash
# Debian / Ubuntu
sudo apt install build-essential libcairo2-dev libpango1.0-dev \
  libjpeg-dev libgif-dev librsvg2-dev

# Fedora / RHEL
sudo dnf install gcc-c++ cairo-devel pango-devel libjpeg-devel giflib-devel
```

### 4. Fonts
Install a monospace font for best results (Liberation Mono is preferred):

```bash
# Debian / Ubuntu
sudo apt install fonts-liberation

# Fedora / RHEL
sudo dnf install liberation-mono-fonts
```

The client automatically tries these fonts in order:
1. Liberation Mono Bold
2. DejaVu Sans Mono Bold
3. FreeMono

## Install

```bash
cd client/
npm install          # installs axios, dotenv, jimp, canvas
cp .env.example .env
nano .env
```

## Configure `.env`

```env
SERVER_URL=https://print.yourdomain.com
API_KEY=your-api-key-here
PRINTER_NAME=your-cups-printer-name   # from lpstat -p
PRINT_FONT_SIZE=9
PRINT_COLUMNS=24
PRINT_WIDTH_MM=58                     # paper width
PRINT_DPI=203                         # printer DPI
```

## Run

```bash
node client.js
```

## Run as a systemd service

Create `/etc/systemd/system/printbridge.service`:

```ini
[Unit]
Description=PrintBridge Print Client
After=network.target cups.service

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/printbridge/client
ExecStart=/usr/bin/node client.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable printbridge
sudo systemctl start printbridge
sudo journalctl -u printbridge -f   # view logs
```

## macOS

macOS uses CUPS too. Install Node via `nvm` or Homebrew, then:

```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
npm install
```

Find your printer name with `lpstat -p` or System Settings → Printers & Scanners.
