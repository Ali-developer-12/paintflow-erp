# Paint Factory ERP — Backend (Express + SQLite)

Local-only API server. No cloud services.

## Run

```bash
cd server
npm install
npm run init-db     # creates data/paint-erp.db, schema, default admin
npm start           # http://localhost:3001
```

Default login: `admin` / `admin123`

## Environment

- `PORT` — default `3001`
- `DB_PATH` — default `server/data/paint-erp.db`

## Frontend

The React app reads `VITE_API_URL` (default `http://localhost:3001/api`).
