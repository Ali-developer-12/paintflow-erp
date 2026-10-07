import defaultDb from "./db.js";

export function recordAuditLog(
  database,
  {
    userId = null,
    username = null,
    action,
    entity,
    entityId = null,
    details = null,
    ipAddress = null,
  },
) {
  const d = database || defaultDb;
  try {
    const detailsStr =
      typeof details === "object" && details !== null
        ? JSON.stringify(details)
        : details
          ? String(details)
          : null;
    d.prepare(
      `INSERT INTO audit_log (user_id, username, action, entity, entity_id, details, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(
      userId,
      username,
      action,
      entity,
      entityId !== null ? String(entityId) : null,
      detailsStr,
      ipAddress,
    );
  } catch (err) {
    console.error("Failed to write audit log:", err.message);
  }
}

export default { recordAuditLog };
