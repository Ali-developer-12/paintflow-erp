# Install GSN Paints on a Mac

## Choose the right download

1. Open the Apple menu and choose **About This Mac**.
2. If it says **Chip: Apple M...**, download the file with `mac-arm64` in its name.
3. If it says **Processor: Intel**, download the file with `mac-x64` in its name.
4. You can use either the `.dmg` installer or the `.zip` file.

## Install the app

1. Open the `.dmg` file, or unzip the `.zip` file.
2. Drag **GSN Paints** into **Applications**.
3. Open **Applications** and start **GSN Paints**.

The app is not notarized. On macOS 15 or newer, if the first launch is blocked, open **System Settings > Privacy & Security**, then choose **Open Anyway** for GSN Paints. On older macOS versions, right-click the app, choose **Open**, then choose **Open** again.

If macOS still blocks the app, open Terminal and run:

```sh
xattr -dr com.apple.quarantine "/Applications/GSN Paints.app"
```

## First run

Create the administrator account when the app asks. Keep its password safe; the administrator can create and manage other users.

## Where your information is kept

- App data and the database: `~/Library/Application Support/GSN Paints`
- Backups: `~/Documents/GSN Paints Backups`

The app and its database are separate. Removing the app does not remove your data.

## Move to another Mac or from Windows

1. On the old computer, sign in as an administrator and choose **Backup**.
2. Choose **Create Backup** and save the `.db` backup file.
3. Install GSN Paints on the new computer.
4. On the new computer, sign in as an administrator, choose **Backup**, then **Restore Backup**.
5. Select the `.db` file and confirm the restore. The app restarts; sign in with an account from that backup.

## Update or uninstall

- To update, install the new GSN Paints app over the old one. Your data stays in its data folder.
- To uninstall, move **GSN Paints.app** from Applications to Trash. Your data stays in `~/Library/Application Support/GSN Paints`.
