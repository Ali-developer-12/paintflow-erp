# Paint Factory ERP — Backend (Express + SQLite)

Local-only API server. No cloud services.

## Run

```bash
cd server
npm install
PAINT_ERP_ADMIN_USERNAME=admin PAINT_ERP_ADMIN_PASSWORD='your-strong-password' npm run init-db
npm start           # http://localhost:3001
```

## Environment

- `PORT` — default `3001`
- `DB_PATH` — default `server/data/paint-erp.db`
- `PAINT_ERP_ADMIN_USERNAME` — username for the bootstrap administrator
- `PAINT_ERP_ADMIN_PASSWORD` — strong initial password used only on first run

The API does not ship with a hard-coded default admin credential.

## Frontend

The React app reads `VITE_API_URL` (default `http://localhost:3001/api`).
