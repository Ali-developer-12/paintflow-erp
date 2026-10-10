import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqliteModule = process.env.GSN_SQLITE_MODULE || "better-sqlite3";

export default require(sqliteModule);
