import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  DatabaseBackup,
  RefreshCcw,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ShieldCheck,
  X,
  FileCheck,
} from "lucide-react";
import { API_URL, apiPost, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type BackupRow = {
  id: number;
  file_name: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
  created_by_username: string | null;
};

type BackupList = { directory: string; backups: BackupRow[] };

function formatBytes(value: number) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const Route = createFileRoute("/app/backup")({
  component: BackupPage,
});

async function exportDatabase() {
  const token = getToken();
  const response = await fetch(`${API_URL}/backup/export`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
    },
  });

  if (!response.ok) {
    throw new Error("Backup export failed");
  }

  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `paint-erp-backup-${new Date().toISOString().slice(0, 10)}.db`;
  link.click();
  URL.revokeObjectURL(href);
}

function BackupPage() {
  const [listing, setListing] = useState<BackupList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // Restore Dialog State
  const [selectedBackup, setSelectedBackup] = useState<BackupRow | null>(null);
  const [verifyResult, setVerifyResult] = useState<{
    valid?: boolean;
    integrity?: string;
    size?: number;
    error?: string;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [restoreResult, setRestoreResult] = useState<{
    ok: boolean;
    mode: string;
    restored_to: string;
    source_backup: string;
    tables: number;
    note: string;
  } | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/backup/list`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (!res.ok) throw new Error("Unable to load the backup history");
      setListing((await res.json()) as BackupList);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the backup history");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runBackup() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await exportDatabase();
      setStatus("Verified WAL-safe backup created successfully and downloaded.");
      toast.success("Backup created successfully");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup export failed");
      toast.error(err instanceof Error ? err.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  async function verifyBackup(backup: BackupRow) {
    setSelectedBackup(backup);
    setVerifyResult(null);
    setRestoreResult(null);
    setVerifying(true);
    try {
      const res = await apiPost<{
        valid: boolean;
        result?: string;
        size: number;
        error?: string;
      }>("/backup/verify", { backup_id: backup.id });

      setVerifyResult({
        valid: res.valid,
        integrity: res.result || (res.valid ? "ok" : "failed"),
        size: res.size,
        error: res.error,
      });
      if (res.valid) {
        toast.success("Backup verification passed: SQLite integrity is OK");
      } else {
        toast.error(`Verification issue: ${res.error || "Integrity failed"}`);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Verification request failed");
      setVerifyResult({ valid: false, error: err instanceof Error ? err.message : "Failed" });
    } finally {
      setVerifying(false);
    }
  }

  async function performRestore() {
    if (!selectedBackup) return;
    setRestoring(true);
    try {
      const res = await apiPost<{
        ok: boolean;
        mode: string;
        restored_to: string;
        source_backup: string;
        tables: number;
        note: string;
      }>("/backup/restore", { backup_id: selectedBackup.id });

      setRestoreResult(res);
      toast.success("Verified restore copy created successfully");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="flex-1 p-6 space-y-6">
      <div className="rounded-lg border border-border bg-card p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <DatabaseBackup className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Database Backup & Recovery</h1>
              <p className="text-sm text-muted-foreground">
                Verified WAL-safe SQLite snapshots, backup verification & safe recovery
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void runBackup()} disabled={busy}>
              <DatabaseBackup className="h-4 w-4 mr-1.5" /> {busy ? "Backing up..." : "Create Backup Now"}
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCcw className="h-4 w-4 mr-1.5" /> Refresh
            </Button>
          </div>
        </div>

        {status && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{status}</span>
          </div>
        )}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="rounded-md border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Operational Safety Guarantee:</p>
          <p>
            • Backups utilize SQLite&rsquo;s native online backup API (`db.backup()`) to cleanly flush WAL journals and prevent partial database captures.
          </p>
          <p>
            • Backups are automatically verified with PRAGMA integrity_check before being logged to disk.
          </p>
          <p>
            • HTTP Restore runs in safe copy-verification mode so your current live database is never silently overwritten without an operator safety backup.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-base font-semibold">Backup History & Recovery Points</h2>
            {listing?.directory && (
              <span className="text-xs text-muted-foreground font-mono">Location: {listing.directory}</span>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left border-b border-border">
                <tr>
                  <th className="px-3 py-2.5">Snapshot File</th>
                  <th className="px-3 py-2.5">Size</th>
                  <th className="px-3 py-2.5">Created At</th>
                  <th className="px-3 py-2.5">Operator</th>
                  <th className="px-3 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Loading backup archive...
                    </td>
                  </tr>
                ) : !listing || listing.backups.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No backups have been recorded yet. Click &ldquo;Create Backup Now&rdquo; to take your first snapshot.
                    </td>
                  </tr>
                ) : (
                  listing.backups.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2.5 font-mono text-xs font-medium">{row.file_name}</td>
                      <td className="px-3 py-2.5 tabular-nums text-xs">{formatBytes(row.size_bytes)}</td>
                      <td className="px-3 py-2.5 text-xs">{row.created_at}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {row.created_by_username ?? "System"}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="inline-flex gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs px-2.5"
                            onClick={() => void verifyBackup(row)}
                          >
                            <ShieldCheck className="h-3.5 w-3.5 mr-1 text-primary" /> Verify & Restore
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ---------------- RESTORE & VERIFY MODAL ---------------- */}
      {selectedBackup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="bg-card w-full max-w-xl rounded-xl border border-border shadow-2xl p-6 space-y-5">
            <div className="flex justify-between items-start border-b border-border pb-3">
              <div className="flex items-center gap-2.5">
                <div className="rounded-md bg-primary/10 p-2 text-primary">
                  <RotateCcw className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base">Database Recovery Verification</h3>
                  <p className="text-xs text-muted-foreground">Snapshot: {selectedBackup.file_name}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedBackup(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="rounded-md bg-muted/40 p-3 space-y-1">
                <p><strong>File Size:</strong> {formatBytes(selectedBackup.size_bytes)}</p>
                <p><strong>Created:</strong> {selectedBackup.created_at}</p>
                <p className="truncate"><strong>Path:</strong> {selectedBackup.file_path}</p>
              </div>

              {verifying ? (
                <div className="py-4 text-center text-muted-foreground">
                  <RefreshCcw className="h-5 w-5 animate-spin mx-auto mb-2 text-primary" />
                  Verifying SQLite file integrity and table structures...
                </div>
              ) : verifyResult ? (
                <div
                  className={`rounded-md p-3 border ${
                    verifyResult.valid
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800"
                      : "border-destructive/40 bg-destructive/10 text-destructive"
                  }`}
                >
                  <p className="font-semibold flex items-center gap-1.5">
                    {verifyResult.valid ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    Integrity Status: {verifyResult.valid ? "PASSED (Integrity OK)" : "FAILED"}
                  </p>
                  {verifyResult.error && <p className="mt-1">{verifyResult.error}</p>}
                </div>
              ) : null}

              {restoreResult && (
                <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-800 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <FileCheck className="h-4 w-4 text-emerald-600" />
                    Safe Restore Copy Verified!
                  </p>
                  <p><strong>Restored To:</strong> {restoreResult.restored_to}</p>
                  <p><strong>Tables Restored:</strong> {restoreResult.tables} business tables</p>
                  <p className="text-[11px] text-emerald-700">{restoreResult.note}</p>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setSelectedBackup(null)}>
                Close
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void verifyBackup(selectedBackup)}
                  disabled={verifying}
                >
                  <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Re-Verify
                </Button>
                <Button
                  size="sm"
                  onClick={() => void performRestore()}
                  disabled={verifying || restoring || !verifyResult?.valid}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  {restoring ? "Restoring..." : "Verify & Restore Snapshot"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
