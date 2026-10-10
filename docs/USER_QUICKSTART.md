# GSN Paints User Quickstart

## First run

1. Start GSN Paints and open its local address in a browser (by default, `http://127.0.0.1:3001`).
2. On a new database, choose **Create administrator account**.
3. Enter an administrator username, full name, and password of at least 8 characters. There is no default password.
4. The new administrator is signed in automatically. Use **Sign out** to leave the workstation.

## Daily workflow

1. In **Setup / Masters**, add the suppliers and customers you work with.
2. In **Items Master**, create the materials and finished goods. Add or update their particular details and cost prices.
3. In **Formula / BOM**, define the materials used to make each finished product.
4. Use **Purchase** to record received materials.
5. Use **Production** to record batches made from the configured formula.
6. Use **Counter Sale** for counter transactions or **Issue Voucher** for other sales/issues. Use **Return** to record a return.
7. In **Accounts**, record customer receipts and supplier payments. The same area contains other accounting entries and reports.
8. Check **Stock** and **Reports** to review balances and activity.

### Sale and return cost

Each **Counter Sale** and customer **Return** line has an editable **Cost** field, prefilled from the item's current cost. You may set it to any value including zero; the entered value is saved with that line and does not change the item's master cost. A zero cost displays a non-blocking warning because profit for that transaction may be overstated.

## Backup and restore

- In **Backup**, administrators can choose **Create Backup** or **Restore Backup**. In Electron, choose a save location in the native Save dialog; in supported browsers, choose a folder. You can also replace an existing verified GSN Paints backup after confirming the replacement warning.
- Before restoring, review the company, date, record counts, and schema version. Type `RESTORE` only after checking the selected file. The current database is replaced; the application restarts and signs everyone out.
- After a restore, sign in with the usernames and passwords stored in the selected backup. A password changed after that backup was created will not work until you change it again in the restored database. The current database is kept in `DATA_DIR\pre-restore` (the five most recent safety copies are retained).
- Keep another copy of important backups on storage protected from workstation failure. Do not edit database or backup files while the application is running. Browsers without File System Access support download new backups normally and use a file picker for restore; replacing an existing backup is not offered there.

## Frequently asked questions

**I do not see the setup screen.** An administrator account already exists in this database. Ask the administrator to create or enable your account.

**Why can I not post a receipt or payment?** Those actions require the **admin** or **accountant** role.

**Why is there an amber cost warning?** That line's cost is zero. You can proceed, or enter the cost you want to use for this transaction.

**Where is my data stored?** By default, on Windows it is under `%LOCALAPPDATA%\GSN Paints`. See [Administrator Notes](./ADMIN_NOTES.md) for platform paths and configuration.
