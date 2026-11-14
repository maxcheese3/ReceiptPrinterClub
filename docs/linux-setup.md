# Linux / macOS Client Setup

The client sends the same ESC/POS commands on every platform. The only thing
that differs between setups is **where the printer is**, which you set in
`client/.env`. Characters per line and emoji style are set on the website's
**My Printer** page.

| Printer connection | `.env` |
|--------------------|--------|
| USB, plugged into this machine | `PRINTER_DEVICE=/dev/usb/lp0` |
| Bluetooth | `PRINTER_DEVICE=/dev/rfcomm0` |
| USB/serial on macOS | `PRINTER_DEVICE=/dev/cu.usbserial-XXXX` |
| Network / wifi, or anything already in CUPS | `PRINTER_NAME=queue-name` |
| A printer that ignores ESC/POS (e.g. Star TSP100) | `PRINTER_NAME=queue-name` + `PRINT_MODE=driver` |

## Option A — Device file (USB or Bluetooth)

Fastest and simplest: no CUPS, no drivers.

### 1. Find your device path

```bash
# Linux USB
ls /dev/usb/lp*   # e.g. /dev/usb/lp0
ls /dev/lp*       # some setups expose it here instead

# macOS
ls /dev/cu.*      # e.g. /dev/cu.usbserial-1410
```

**Bluetooth (Linux):** pair the printer, then bind it to a serial device:

```bash
bluetoothctl            # then: scan on, pair XX:XX:XX:XX:XX:XX, trust XX:XX:XX:XX:XX:XX
sudo rfcomm bind 0 XX:XX:XX:XX:XX:XX
ls /dev/rfcomm0
```

`rfcomm bind` doesn't survive a reboot; add it to a systemd unit or
`/etc/rc.local` if you need it to.

### 2. Grant permission (Linux)

```bash
sudo usermod -aG lp $USER        # USB
sudo usermod -aG dialout $USER   # Bluetooth (/dev/rfcomm*)
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
```

## Option B — CUPS queue (network, wifi, shared printers)

```bash
# Debian / Ubuntu
sudo apt install cups
# Fedora / RHEL
sudo dnf install cups

# List printers
lpstat -p
```

```env
SERVER_URL=https://print.yourdomain.com
API_KEY=your-api-key-here
PRINTER_NAME=your-cups-printer-name   # from lpstat -p
```

The client sends the same ESC/POS bytes as Option A through `lp -o raw`, so
CUPS passes them to the printer untouched. Register the printer in CUPS as a
**raw** queue (or "Generic / Raw" driver) — a queue with a real driver also
works, since `-o raw` skips the driver.

## Option C — Driver mode (printers that ignore ESC/POS)

Some printers, like the Star TSP100 series, only accept their own raster
format and silently ignore ESC/POS. For those, print through the CUPS driver:

```env
PRINTER_NAME=Star_TSP143
PRINT_MODE=driver
# PRINT_CUPS_MEDIA=X72MMY2000MM   # only if the default media name doesn't suit your driver
```

Line breaks and sizes match the ESC/POS output. Bold, underline and banners
don't show, and emoji print as text stand-ins (`<3`, `:D`).

## Install & run

Node.js 18 or newer:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install nodejs
```

```bash
cd client/
npm install
cp .env.example .env
nano .env
node client.js
```

## Check it with a test page

Log in on the website's **My Printer** page and click **Print test page**, or
run:

```bash
node client.js --test-page            # uses the width saved on My Printer
node client.js --test-page --cols 42  # try a width before saving it
```

The page prints:

- **A character ruler.** The last number on its first line is how many
  Normal-size characters fit. If it doesn't match the "Expected" number, set
  Characters per line on My Printer to that number.
- **An edge bar.** Both thick bars should print; if the right one is cut off,
  Characters per line is set too high.
- **One line per size.** Each should fit on a single line.
- **An emoji row.** If it prints pictures, set Emoji to Pictures on My
  Printer. If it prints letters or symbols, your printer doesn't support
  custom characters — set Emoji to Text.

## Troubleshooting

**Images print as garbled characters / random symbols.** Lower
`PRINT_RASTER_CHUNK_ROWS` (try 128) — some printers have a small image buffer
that overflows on a large graphics command. If text prints but nothing else
does, the printer may not support ESC/POS graphics; try `PRINT_MODE=driver`.

**Nothing prints, but the message shows as printed.** The printer is probably
ignoring ESC/POS (see Option C).

**Permission denied on the device.** Join the `lp` (USB) or `dialout`
(Bluetooth) group, then log out and back in. Test with
`sudo chmod a+rw /dev/usb/lp0` to confirm it's a permissions issue before
making the group change permanent.

<!-- LEGACY(old-client): upgrade help — remove once every printer reports a new client. -->
**Warnings about `PRINT_COLUMNS`, `PRINT_FONT_SIZE`, `PRINT_WIDTH_MM`,
`PRINT_DPI` or `PRINT_CUPS_MODE`.** Those settings were removed — delete them
from `.env`. Characters per line is on My Printer, senders choose the size, and
`PRINT_CUPS_MODE` is replaced by `PRINT_MODE`.

## Run as a service

```bash
node install-service.js
```

On Linux this writes a systemd unit file and prints the commands to install
it; on macOS it installs and starts a LaunchAgent. The service reads `.env`
from the `client/` folder each time it starts, so after editing `.env`,
restart it:

```bash
sudo systemctl restart printbridge-client          # Linux
launchctl unload ~/Library/LaunchAgents/com.printbridge.client.plist && \
  launchctl load ~/Library/LaunchAgents/com.printbridge.client.plist   # macOS
```

<!-- LEGACY(old-client): upgrade help — remove once every printer reports a new client. -->
If you installed the service with an older version, run `node install-service.js`
again: older versions copied `.env` values into the service, which would keep
overriding your `.env`.
