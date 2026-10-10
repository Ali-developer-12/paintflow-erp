export const serverRuntimePath = process.env.GSN_SERVER_NODE || process.execPath;

export function serverRuntimeEnv(env) {
  const runtime = env.GSN_SERVER_NODE || process.env.GSN_SERVER_NODE;
  return {
    ...env,
    ...(runtime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...(runtime
      ? { NODE_OPTIONS: [env.NODE_OPTIONS, "--experimental-fetch"].filter(Boolean).join(" ") }
      : {}),
    ...(runtime && (env.GSN_ELECTRON_SQLITE_MODULE || process.env.GSN_ELECTRON_SQLITE_MODULE)
      ? {
          GSN_SQLITE_MODULE:
            env.GSN_ELECTRON_SQLITE_MODULE || process.env.GSN_ELECTRON_SQLITE_MODULE,
        }
      : {}),
  };
}
