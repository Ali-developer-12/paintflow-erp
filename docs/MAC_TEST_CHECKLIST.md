# GSN Paints: 10-minute Mac check

Use a test database or make a backup before starting. Check the DMG whose name matches your Mac: `mac-arm64` for Apple Silicon or `mac-x64` for Intel.

## Install and start (2 minutes)

- [ ] Open the DMG and drag **GSN Paints** to **Applications**.
- [ ] If macOS blocks first launch, follow the Gatekeeper steps in [INSTALL_GUIDE_MAC.md](./INSTALL_GUIDE_MAC.md).
- [ ] Open the app. Confirm the first-run administrator screen appears.
- [ ] Create an administrator and sign in.

## Enter data and restart (2 minutes)

- [ ] Add a test customer or item.
- [ ] Quit with **GSN Paints > Quit GSN Paints** or **Command-Q**.
- [ ] Reopen the app and confirm the test data is still there.

## Back up and restore (4 minutes)

- [ ] Open **Backup** and choose **Create Backup**.
- [ ] Save the file in Documents and confirm the app says the backup was created.
- [ ] Add a second test customer or item after the backup.
- [ ] Choose **Restore Backup**, select the saved file, type `RESTORE`, and confirm.
- [ ] Sign in again. Confirm the first test record is present and the later test record is gone.

## Mac behavior and offline use (2 minutes)

- [ ] In a text field, test **Command-A**, **Command-C**, and **Command-V**.
- [ ] Disconnect from the internet and confirm local pages still open.
- [ ] Close the last window and confirm the app quits.
- [ ] Confirm your database is in `~/Library/Application Support/GSN Paints` and backups are in `~/Documents/GSN Paints Backups`.

Record the Mac model, macOS version, installer architecture, and any failed step for the project owner.
