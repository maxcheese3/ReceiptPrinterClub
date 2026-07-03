# Contributing — Frontend

## Prerequisites

- [Docker](https://www.docker.com/) (with Compose v2)
- Node.js 20+ (only needed if running Vite outside Docker)

---

## Quick Start

```bash
cp .env.example .env   # then fill in values
make start             # spin up server + frontend dev containers
```

The frontend is available at **http://localhost:8008** with hot-reload enabled.

### Common commands

| Command | What it does |
|---------|-------------|
| `make start` | Start the full dev stack |
| `make stop` | Stop and remove containers |
| `make restart` | Stop then start |
| `make deploy` | Rebuild and force-recreate the frontend container |
| `make logs-frontend` | Tail frontend container logs |

---

## Pointing at a Remote Server

To develop the frontend against a remote API instead of the local server container, set `VITE_API_TARGET` in `.env`:

```env
VITE_API_TARGET=https://print.example.com
```

Then run `make deploy` to restart the frontend container with the new target.

---

## Frontend Source Structure

```
frontend/src/
├── pages/       # Route-level page components
├── components/  # Shared/reusable UI components
├── hooks/       # Custom React hooks
├── contexts/    # React context providers
└── types/       # TypeScript interfaces
```

---

## Branch Naming

| Prefix | Use for |
|--------|---------|
| `feat/` | New user-facing features |
| `refactor/` | Code restructuring without behavior change |
| `fix/` | Bug fixes |
| `chore/` | Tooling, config, and meta changes |
