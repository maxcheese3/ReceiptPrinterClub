# Contributing — Frontend

## Prerequisites

- [Docker](https://www.docker.com/) (with Compose v2)
- Node.js 20+ (only needed if running Vite outside Docker)

---

## Quick Start

Two modes are available depending on what you need to test against.

### Frontend against production

Runs the Vite dev server and proxies API calls to the production server defined in `.env`.

```bash
cp .env.example .env   # set VITE_API_TARGET=https://your-prod-server
make start
```

### Frontend against a local server

Runs the full stack locally. `VITE_API_TARGET` is hardcoded to the local server — `.env` is ignored for that variable.

```bash
make start-local
```

The admin password defaults to `localpassword`. Override it by setting `LOCAL_ADMIN_PASSWORD` in `.env`.

The frontend is available at **http://localhost:8008** with hot-reload enabled.
The local server API is directly accessible at **http://localhost:3000**.

---

## Common Commands

### Dev stack (frontend → production API)

| Command | What it does |
|---------|-------------|
| `make start` | Start the full dev stack |
| `make stop` | Stop and remove containers |
| `make restart` | Stop then start |
| `make build-frontend` | Rebuild the frontend container image |
| `make deploy-frontend` | Rebuild and force-recreate the frontend container |
| `make build-server` | Rebuild the server container image |
| `make deploy-server` | Rebuild and force-recreate the server container |
| `make logs` | Tail all container logs |
| `make logs-frontend` | Tail frontend container logs |
| `make logs-server` | Tail server container logs |

### Local stack (frontend → local server)

| Command | What it does |
|---------|-------------|
| `make start-local` | Start the local full stack |
| `make stop-local` | Stop and remove local containers |
| `make restart-local` | Stop then start local stack |
| `make build-local-server` | Rebuild the local server image |
| `make deploy-local-server` | Rebuild and force-recreate the local server |
| `make logs-local` | Tail all local container logs |
| `make logs-local-frontend` | Tail local frontend logs |
| `make logs-local-server` | Tail local server logs |

---

## Pointing the Dev Stack at a Different Remote Server

To change which remote server the dev stack proxies to, set `VITE_API_TARGET` in `.env`:

```env
VITE_API_TARGET=https://print.example.com
```

Then run `make deploy-frontend` to restart the frontend container with the new target.

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

---

## Versioning

When merging a branch that represents a new version:

1. Add a new entry to `CHANGELOG.md`:
   `## [X.Y.Z] - YYYY-MM-DD — \`branch-name\``
2. Update `frontend/src/version.ts` to match:
   ```ts
   export const APP_VERSION = 'X.Y.Z';
   ```
   These two must always be in sync. The version shown in the app UI is read from this file.

---

## Before Opening a PR

- [ ] `npx tsc` passes with no errors (run from `frontend/`)
- [ ] `CHANGELOG.md` updated if the change is user-facing or significant
- [ ] `frontend/src/version.ts` bumped if this is a new version
- [ ] `README.md` updated if routes, env vars, or file structure changed

---

## Secrets and Environment

Never commit `.env` files. When introducing a new environment variable, add it to `.env.example` (root or `client/`) with a placeholder value so fresh installs know it exists.

---

## Documentation

Operational guides live in `docs/`. Update the relevant guide if you change deployment steps, server setup, or infrastructure defaults. New guides go in `docs/` — not the root directory.
