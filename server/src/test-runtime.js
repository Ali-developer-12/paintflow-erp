export function serverRuntimePath() {
  return process.env.GSN_SERVER_NODE || process.execPath;
}

export function serverRuntimeEnv(values = process.env) {
  const runtime = values.GSN_SERVER_NODE || process.env.GSN_SERVER_NODE;
  return {
    ...process.env,
    ...values,
    ...(runtime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...(runtime
      ? { NODE_OPTIONS: [values.NODE_OPTIONS, "--experimental-fetch"].filter(Boolean).join(" ") }
      : {}),
    ...(runtime && (values.GSN_ELECTRON_SQLITE_MODULE || process.env.GSN_ELECTRON_SQLITE_MODULE)
      ? {
          GSN_SQLITE_MODULE:
            values.GSN_ELECTRON_SQLITE_MODULE || process.env.GSN_ELECTRON_SQLITE_MODULE,
        }
      : {}),
  };
}
