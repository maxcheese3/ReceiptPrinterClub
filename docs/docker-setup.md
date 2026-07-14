# Running the Client in Docker

The client can run as a container instead of a bare `node client.js` process.
This is most useful on a small always-on Linux box (Raspberry Pi, home
server) sitting next to the printer.

## Quick start

```bash
cd client/
cp .env.example .env
nano .env                     # fill in SERVER_URL, API_KEY, PRINTER_DEVICE, etc.

docker build -t printbridge-client .
docker run -d --name printbridge \
  --env-file .env \
  --device /dev/usb/lp0:/dev/usb/lp0 \
  --group-add "$(getent group lp | cut -d: -f3)" \
  -v printbridge-archive:/app/archive \
  --restart unless-stopped \
  printbridge-client
```

Or with Compose — copy `docker-compose.example.yml` to `docker-compose.yml`,
edit it for your setup, then:

```bash
docker compose up -d --build
```

## Two ways to reach the printer from a container

**A. Raw USB device (recommended)** — pass the device file into the container
with `--device`, and make sure the container's user can write to it. Device
permissions are enforced by the host's group ownership, which doesn't
automatically map into the container, so you also need `--group-add` with the
GID of the group that owns the device (`getent group lp` on most distros —
confirm with `ls -l /dev/usb/lp0`).

**B. CUPS over the network** — if the printer is managed by CUPS on another
machine, you don't need any device passthrough at all. Set `PRINTER_NAME` and
`CUPS_SERVER=that-machine.local` in `.env`; the `lp` command built into the
image talks to the remote CUPS server over the network.

## Running with `canvas` (legacy image-rendering mode)

Not needed for the default setup. Only build with canvas if you've
deliberately set `PRINT_CUPS_MODE=image`:

```bash
docker build -t printbridge-client --build-arg WITH_CANVAS=true .
```

## Running the raw JS instead of Docker

Docker is optional — everything works the same running directly with Node:

```bash
cd client/
npm install
cp .env.example .env
node client.js
```

See `docs/linux-setup.md` for OS-specific device/CUPS setup either way.

---

## Windows + Docker: do you need WSL2?

Short answer: **you don't have to set up WSL2 yourself for Docker Desktop to
work — but if you want the container to talk to a USB-connected thermal
printer directly, you'll run into the same USB-passthrough problem WSL2 has**,
and there's a much simpler option below.

**Docker Desktop itself.** Docker Desktop for Windows runs containers inside a
lightweight Linux VM. Since 2022 its default backend is WSL2, but Docker
Desktop manages that VM for you — you install Docker Desktop, and it works.
You don't need to separately install or configure a WSL2 distro just to run
`docker run`.

**USB device passthrough is the actual complication.** A container on Windows
never sees Windows' USB stack directly — it only sees devices inside the Linux
VM. Windows doesn't pass arbitrary USB devices into that VM automatically. To
get `/dev/usb/lp0` (or similar) to show up so `--device` has something to
attach to, you'd need to:

1. Install [`usbipd-win`](https://github.com/dorssel/usbipd-win) on Windows.
2. `usbipd list` to find your printer, `usbipd bind` and `usbipd attach` to
   share it into a WSL2 distro.
3. From inside that WSL2 distro, confirm the device node appears
   (`ls /dev/usb/lp0` or similar).
4. Point `docker run --device` at that path — this only works if Docker
   Desktop's WSL2 integration is enabled for that distro.

This is real friction that most people don't want for a receipt printer.

**The simpler recommendation for Windows:** don't run the client in Docker on
Windows at all. Run it natively — `npm install && node client.js`, or install
it as a Windows service with `node install-service.js` — which uses the
existing Windows print-spooler path (`print-text.ps1` / `print-image.ps1`) and
talks to your printer exactly like any other Windows application. No VM, no
USB passthrough, no WSL2 involved.

If you specifically want the Docker workflow, the cleanest way to get it on
Windows is Scenario B above: run CUPS (or just the client directly) on a
Linux box actually connected to the printer, and, if you want a second
Windows machine involved at all, have anything on Windows talk to that Linux
box over the network rather than trying to reach the USB device through
Docker Desktop's VM.

| Setup | WSL2 needed? |
|---|---|
| Native Windows client (`node client.js` or Windows service) | No |
| Docker Desktop, printer reached via network CUPS server | No (Docker Desktop's own VM, invisible to you) |
| Docker Desktop, printer connected by USB to the Windows machine | Yes, via `usbipd-win`, and it's fiddly |
| Docker running on Linux/macOS/Raspberry Pi, printer plugged into that machine | N/A — not Windows |
