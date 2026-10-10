# Native runtime and test modes

The default workflow uses the system Node.js runtime and its `better-sqlite3` native binary:

```powershell
cd server
npm ci
npm test
npm start
```

Electron 22.3.27 uses a different native-module ABI. Electron-specific server tests are opt-in and use a separate pinned native module in `electron-runtime`; they do not replace the default Node binary:

```powershell
cd server
npm run test:electron
```

That script installs the Electron ABI 110 prebuild in the separate runtime folder and runs the suite with spawned server processes under Electron's Node runtime. The root server package remains on its Node 22-compatible `better-sqlite3` dependency. Run `npm run native:electron` to prepare the separate Electron runtime before packaging.
