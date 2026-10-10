# GSN Paints installation guide for macOS

## Install

1. Open the downloaded DMG.
2. Drag `GSN Paints.app` into the Applications folder.
3. Launch the app once from Applications.

## First run

1. Create the first administrator account.
2. Log in with that account.
3. Confirm the app opens the default GSN Paints workspace.

## Data and backups

The app stores local data in:

- `~/Library/Application Support/GSN Paints`
- `~/Documents/GSN Paints Backups`

The data folder contains the SQLite database and logs. Backups are stored separately in the Documents folder and should be kept off the app bundle.

## Gatekeeper

On macOS 13/14/15, a non-notarized app may be blocked. Use these steps:

- right-click the app and select Open
- then System Settings > Privacy & Security > Open Anyway
- or run `xattr -dr com.apple.quarantine "/Applications/GSN Paints.app"`

## Cross-platform backup workflow

- Create a backup on Windows or macOS.
- Move the `.db` backup to the other machine.
- Install GSN Paints on the target machine.
- Use the Backup page to restore the file.

The restore process restarts the app and loads the restored database.

## Update

Install the new version over the older one. The app data remains in the same user-data directory unless you deliberately remove it.

## Uninstall

- Drag `GSN Paints.app` to Trash.
- User data remains in `~/Library/Application Support/GSN Paints` unless you remove it manually.
- To delete data intentionally, delete the `GSN Paints` folder from Application Support.
