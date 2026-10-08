# PaintFlow ERP

PaintFlow ERP is a local-first ERP for a paint manufacturing and trading business. It combines a React + TanStack frontend with an Express + SQLite backend and is intended to run on a single Windows workstation without cloud services.

## What this project includes

- Product and formula management
- Supplier and customer management
- Purchase, production, sales, returns, and stock workflows
- Accounting and trial-balance reporting
- Backup and restore support
- Local-only configuration with SQLite data stored outside the project by default

## Tech stack

- Frontend: React 19 + TanStack Start + Vite + TypeScript
- Backend: Node.js + Express 4 + better-sqlite3
- Database: SQLite
- Local configuration: `.env` files and `DATA_DIR`

## Requirements

- Node.js 18+
- npm 9+
- Windows 10/11 preferred for local desktop use

## Quick start

```bash
# install dependencies
npm install
cd server && npm install
cd ..

# copy environment templates and edit them if needed
cp .env.example .env
cp server/.env.example server/.env

# initialize a fresh local database
cd server
PAINT_ERP_ADMIN_USERNAME=admin PAINT_ERP_ADMIN_PASSWORD='ChangeMeStrong123!' npm run init-db

# start the API
npm start

# in another terminal, start the frontend
npm run dev
```

## Environment files

The repository includes template files for local setup:

- `.env.example`
- `server/.env.example`

Use them as your starting point. Do not commit a real `.env` file with credentials or production secrets.

## Default local data path

The application stores SQLite data under `DATA_DIR`, which defaults outside the source tree to:

```text
%LOCALAPPDATA%\PaintFlow ERP\
```

On Linux and macOS, the default is `$XDG_DATA_HOME/PaintFlow ERP`, or `~/.local/share/PaintFlow ERP` if `XDG_DATA_HOME` is unset. Set `DATA_DIR` to choose another writable location.

## Production start

Build the static frontend, then start Express. The UI, API, and SPA route fallback share one loopback origin:

```bash
npm run build
node server/src/index.js
```

The server defaults to `http://127.0.0.1:3001`. Set `PORT` to use a different port. Startup fails with a clear error if the port is already occupied.

## Backup and restore

Use the built-in backup endpoints or command line helpers to export a verified SQLite snapshot.

```bash
cd server
npm run backup
```

Do not restore into the live business database without a verified safety copy.

## Tests

```bash
cd server
npm test
```

## Production build

```bash
npm run build
```

## Notes

- This project is designed for local, offline operation.
- Do not check in real business data.
- Keep generated artifacts and database files out of version control.
