# PaintFlow ERP Administrator Notes

## Roles and permissions

| Area | Roles allowed |
|---|---|
| Receipts, payments, expenses, income, journals, and stock adjustments | admin, accountant |
| Create or edit items, particulars, and formulas | admin, accountant |
| Delete items or particulars | admin |
| Create purchases, productions, sales, issue vouchers, and returns | admin, accountant, user |
| Reads and reports | admin, accountant, user |
| User administration, Setup / Masters, year posting, backup, restore, backup verification, and back-posting | admin |

The application recognizes the roles **admin**, **accountant**, and **user**. The server checks permissions even where the interface hides or disables an action.

**Counter Sale** and customer **Return** lines include an editable cost snapshot, initially copied from the item's current cost. Operators may change the transaction cost, including to zero; this does not modify the item master. A zero cost is permitted and may overstate the transaction's reported profit.

## Data and configuration

The default data directory is outside the source tree:

- Windows: `%LOCALAPPDATA%\PaintFlow ERP`
- Linux/macOS: `$XDG_DATA_HOME/PaintFlow ERP` when `XDG_DATA_HOME` is set; otherwise `~/.local/share/PaintFlow ERP`

The directory contains the SQLite database, backups, and logs. `DATA_DIR` overrides the default; `DB_PATH`, `BACKUP_DIR`, and `LOGS_DIR` can override the individual paths. Keep all writable data on a local, backed-up disk and do not place it in the source or delivery archive.

The HTTP server defaults to `127.0.0.1:3001`, so it is intended for local use on the workstation. Configure `HOST` and `PORT` only when the deployment requires a different binding; exposing the service beyond loopback requires a deliberate network-security review.

For a production run from a source checkout, install the root and `server` dependencies, run `npm run build`, then start `node server/src/index.js`. Open the configured local address in the browser. The first administrator is created through the **Create administrator account** screen; no shipped/default password is required.

## Backups

Use the **Backup** module to create and verify backups. Backups are stored in the `backups` subdirectory of the data directory by default. Keep a second copy outside the workstation and periodically confirm that a backup can be selected for restore. Restore replaces database contents; verify the selected file and confirm that other users are out of the application before proceeding.

## If the application will not start

1. Check the terminal output for the reported startup error. If the port is occupied, stop the other local service or configure an available `PORT`.
2. Confirm that the service account can read and write the configured data, backup, and log directories.
3. Check that the database and its containing directory are not locked by another running PaintFlow process. Do not delete or replace the database as a troubleshooting shortcut.
4. Preserve the database and logs, then restore from a known-good backup only after confirming which data will be replaced.
5. If the problem persists, record the error message and relevant log entries for support; do not send database files or credentials.
