# Backup and Restore Manual Test

Use a non-production database and a current Chrome or Edge browser. Do not use a real customer database for this checklist.

1. Sign in as an administrator, open **Backup**, choose **Create Backup** → **Choose a folder**, and verify that a new `GSN-Paints-Backup_YYYY-MM-DD_HH-mm-ss.db` file is created.
2. Select **Create Backup** → **Choose an existing backup file**, choose a valid GSN Paints backup, and confirm that its name, size, last-modified time, and replacement warning are shown. Cancel once and verify the file remains unchanged.
3. Confirm replacement of that file and verify the new file opens as a SQLite database and has the expected current file size.
4. Make a small, reversible change in the test database, then open **Backup** → **Restore Backup** and select the earlier backup. Review its company name, date, counts, and schema version.
5. Confirm that the red warning explains that current data will be replaced, a safety copy is kept, and the restored usernames/passwords will be required. Type `RESTORE` and start the restore.
6. Wait for the server restart, sign in with the username and password from the selected backup, verify the original data is back, and verify a safety copy of the replaced database exists in `DATA_DIR\pre-restore`.
