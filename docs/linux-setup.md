# Linux / macOS Client Setup

The PrintBridge client talks to your thermal printer in one of two ways.
**Use the raw USB/ESC-POS device path if you can — it's simpler, needs no
system libraries, and is what most receipt printers actually expect.**

| Path | When to use it | Setup |
|------|-----------------|-------|
| **Raw device (recommended)** | Printer is connected by USB (or shows up as a serial device on macOS) | Set `PRINTER_DEVICE`, done |
| **CUPS** | Printer is only reachable through a CUPS queue (e.g. shared/networked) | Set `PRINTER_NAME`, CUPS installed |

Both paths render text and images with the exact same ESC/POS logic — CUPS
mode just delivers those bytes through `lp -o raw` instead of writing directly
to a device file. You get identical output either way.

## Option A — Raw USB device (recommended)

### 1. Find your device path

```bash
# Linux
ls /dev/usb/lp*   # e.g. /dev/usb/lp0
ls /dev/lp*       # some setups expose it here instead

# macOS
ls /dev/cu.usb*   # e.g. /dev/cu.usbserial-1410
```

### 2. Grant permission (Linux)

```bash
sudo usermod -aG lp $USER
# log out and back in for this to take effect
```

On macOS, if you get a permission error:
```bash
sudo chmod a+rw /dev/cu.usbserial-XXXX
```

### 3. Configure `.env`

```env
SERVER_URL=https://print.yourdomain.com
API_KEY=your-api-key-here
PRINTER_DEVICE=/dev/usb/lp0
PRINT_FONT_SIZE=9
PRINT_COLUMNS=24
PRINT_WIDTH_MM=58
PRINT_DPI=203
```

That's it — no CUPS, no `canvas`, no native build tools required.

## Option B — CUPS

Use this if the printer isn't directly attached (e.g. it's shared over the
network, or another app already manages it through CUPS).

### 1. Install CUPS and register the printer

```bash
# Debian / Ubuntu
sudo apt install cups

# Fedora / RHEL
sudo dnf install cups

# List available printers
lpstat -p
```

### 2. Configure `.env`

```env
SERVER_URL=https://print.yourdomain.com
API_KEY=your-api-key-here
PRINTER_NAME=your-cups-printer-name   # from lpstat -p
PRINT_FONT_SIZE=9
PRINT_COLUMNS=24
PRINT_WIDTH_MM=58
PRINT_DPI=203
```

By default (`PRINT_CUPS_MODE=raw`, the default — no need to set it) the client
builds the same ESC/POS bytes as Option A and sends them with `lp -o raw`,
which tells CUPS to skip its filter chain and stream the bytes straight to the
printer. This matches how almost every thermal receipt printer is actually
registered in CUPS (as a raw/generic queue), and avoids a common failure mode:
**sending a rendered PNG to a queue with no image filter doesn't error — CUPS
just streams the literal PNG bytes to the printer, which prints every byte as
its ASCII character, producing a receipt full of garbled symbols.** This is
the #1 cause of "images print as random characters" reports, and it's
inconsistent across machines because it depends on how each printer's queue
happens to be configured rather than anything about the image itself.

### Optional: legacy PNG rendering

If your CUPS queue genuinely has an image-capable driver (uncommon for
receipt printers) and you'd rather have real anti-aliased fonts, you can opt
back into the old rendering path:

```env
PRINT_CUPS_MODE=image
```

This requires the optional `canvas` package and its native build dependencies:

```bash
# Debian / Ubuntu
sudo apt install build-essential libcairo2-dev libpango1.0-dev \
  libjpeg-dev libgif-dev librsvg2-dev

# Fedora / RHEL
sudo dnf install gcc-c++ cairo-devel pango-devel libjpeg-devel giflib-devel

cd client/
npm install canvas
```

Install a monospace font for best results:
```bash
# Debian / Ubuntu
sudo apt install fonts-liberation
# Fedora / RHEL
sudo dnf install liberation-mono-fonts
```

## Node.js (18+)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install nodejs
```

## Install & run

```bash
cd client/
npm install
cp .env.example .env
nano .env
node client.js
```

## Troubleshooting

**Images print as garbled characters / random symbols.** This was the default
behavior in older versions of the client when using CUPS mode, caused by
sending a PNG to a raw queue. Update the client and make sure
`PRINT_CUPS_MODE` is unset or set to `raw` (the default) — do not set it to
`image` unless you know your queue has a real image driver. If you're on the
raw device path (`PRINTER_DEVICE` set) and still see this on very tall
images, lower `PRINT_RASTER_CHUNK_ROWS` (try 128) — some printers have a
small internal image buffer that overflows on a single large graphics command.

**Permission denied on the device.** `sudo usermod -aG lp $USER`, then log out
and back in. Test with `sudo chmod a+rw /dev/usb/lp0` to confirm it's a
permissions issue before making the group change permanent.

## Run as a systemd service

Create `/etc/systemd/system/printbridge.service`:

```ini
[Unit]
Description=PrintBridge Print Client
After=network.target

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

```bash
sudo systemctl daemon-reload
sudo systemctl enable printbridge
sudo systemctl start printbridge
sudo journalctl -u printbridge -f   # view logs
```

## macOS

Everything above applies the same way. Find your device with `ls /dev/cu.usb*`
for Option A, or `lpstat -p` for Option B. Install Node via `nvm` or Homebrew.
