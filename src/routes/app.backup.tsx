import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AlertTriangle, DatabaseBackup, FolderOpen, RotateCcw, X } from "lucide-react";
import { API_URL, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

type BackupSummary = {
  company_name: string;
  backup_date: string;
  schema_version: number;
  counts: {
    users: number;
    customers: number;
    suppliers: number;
    items: number;
    vouchers: number;
  };
};

type FileWritable = {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

type FileHandle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileWritable>;
};

type DirectoryHandle = {
  getFileHandle(name: string, options: { create: true }): Promise<FileHandle>;
};

type PickerWindow = Window & {
  showDirectoryPicker?: () => Promise<DirectoryHandle>;
  showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileHandle[]>;
};

const sqliteHeader = new TextEncoder().encode("SQLite format 3\0");

async function readResponseError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

function authHeaders(extra: Record<string, string> = {}) {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

async function inspectFile(file: File, purpose?: "replace") {
  const response = await fetch(`${API_URL}/backup/inspect`, {
    method: "POST",
    headers: authHeaders({
      "Content-Type": "application/octet-stream",
      ...(purpose ? { "X-Backup-Purpose": purpose } : {}),
    }),
    body: file,
  });
  if (!response.ok) throw new Error(await readResponseError(response));
  return (await response.json()) as { summary: BackupSummary; ticket?: string };
}

async function confirmBackup(fileName: string, sizeBytes: number) {
  const response = await fetch(`${API_URL}/backup/confirm`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ file_name: fileName, size_bytes: sizeBytes }),
  });
  if (!response.ok) throw new Error(await readResponseError(response));
}

function snapshotFileName(response: Response) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  return (
    match?.[1] || `GSN-Paints-Backup_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.db`
  );
}

async function writeSnapshot(handle: FileHandle) {
  const response = await fetch(`${API_URL}/backup/snapshot`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readResponseError(response));
  if (!response.body) throw new Error("Backup download did not include a file stream");

  const expectedSize = Number(response.headers.get("Content-Length") || 0);
  const writer = await handle.createWritable();
  const reader = response.body.getReader();
  let writtenSize = 0;
  let header = new Uint8Array();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (header.length < sqliteHeader.length) {
        const needed = sqliteHeader.length - header.length;
        const addition = value.slice(0, needed);
        const combined = new Uint8Array(header.length + addition.length);
        combined.set(header);
        combined.set(addition, header.length);
        header = combined;
      }
      writtenSize += value.byteLength;
      await writer.write(value);
    }
    if (!expectedSize || writtenSize !== expectedSize) {
      throw new Error("Backup size did not match the server response");
    }
    if (
      header.length !== sqliteHeader.length ||
      !sqliteHeader.every((byte, i) => header[i] === byte)
    ) {
      throw new Error("Backup file did not have a valid SQLite header");
    }
    await writer.close();
  } catch (error) {
    await writer.abort();
    throw error;
  }

  const writtenFile = await handle.getFile();
  if (writtenFile.size !== expectedSize) {
    throw new Error("Saved backup size did not match the server response");
  }
  const savedHeader = new Uint8Array(await writtenFile.slice(0, sqliteHeader.length).arrayBuffer());
  if (!sqliteHeader.every((byte, i) => savedHeader[i] === byte)) {
    throw new Error("Saved backup file did not have a valid SQLite header");
  }
  return { fileName: handle.name, sizeBytes: writtenFile.size };
}

async function downloadSnapshot() {
  const response = await fetch(`${API_URL}/backup/snapshot`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readResponseError(response));
  const fileName = snapshotFileName(response);
  const sizeBytes = Number(response.headers.get("Content-Length") || 0);
  const blob = await response.blob();
  if (blob.size !== sizeBytes) throw new Error("Backup size did not match the server response");
  const header = new Uint8Array(await blob.slice(0, sqliteHeader.length).arrayBuffer());
  if (!sqliteHeader.every((byte, i) => byte === header[i])) {
    throw new Error("Backup download did not have a valid SQLite header");
  }
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
  await confirmBackup(fileName, blob.size);
}

function BackupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [replaceHandle, setReplaceHandle] = useState<FileHandle | null>(null);
  const [replaceDetails, setReplaceDetails] = useState<File | null>(null);
  const [restoreSummary, setRestoreSummary] = useState<BackupSummary | null>(null);
  const [restoreTicket, setRestoreTicket] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreText, setRestoreText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fallbackInput = useRef<HTMLInputElement>(null);
  const pickerWindow = (typeof window === "undefined" ? {} : window) as PickerWindow;

  useEffect(() => {
    if (user && user.role !== "admin") {
      void navigate({ to: "/app" });
      return;
    }
    if (!user) return;
    let active = true;
    void fetch(`${API_URL}/backup/status`, { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readResponseError(response));
        return (await response.json()) as { last_backup_at: string | null };
      })
      .then(({ last_backup_at: date }) => {
        if (active) setLastBackup(date);
      })
      .catch((cause: unknown) => {
        if (active)
          setError(cause instanceof Error ? cause.message : "Unable to load backup status");
      });
    return () => {
      active = false;
    };
  }, [navigate, user]);

  function clearNotices() {
    setError("");
    setMessage("");
  }

  async function saveToFolder() {
    if (!pickerWindow.showDirectoryPicker) {
      setCreateOpen(false);
      await downloadSnapshot();
      setLastBackup(new Date().toISOString());
      setMessage("Backup download started.");
      return;
    }
    const directoryPromise = pickerWindow.showDirectoryPicker();
    setCreateOpen(false);
    setBusy(true);
    clearNotices();
    try {
      const directory = await directoryPromise;
      const name = `GSN-Paints-Backup_${new Date().toISOString().replace("T", "_").slice(0, 19).replace(/:/g, "-")}.db`;
      const handle = await directory.getFileHandle(name, { create: true });
      const saved = await writeSnapshot(handle);
      await confirmBackup(saved.fileName, saved.sizeBytes);
      setMessage("Backup created successfully.");
      setLastBackup(new Date().toISOString());
      const response = await fetch(`${API_URL}/backup/status`, { headers: authHeaders() });
      if (response.ok)
        setLastBackup(
          ((await response.json()) as { last_backup_at: string | null }).last_backup_at,
        );
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "Backup could not be created");
      }
    } finally {
      setBusy(false);
    }
  }

  async function chooseFileToReplace() {
    if (!pickerWindow.showOpenFilePicker) return;
    setCreateOpen(false);
    clearNotices();
    try {
      const [handle] = await pickerWindow.showOpenFilePicker({ multiple: false });
      if (!handle) return;
      const existing = await handle.getFile();
      await inspectFile(existing, "replace");
      setReplaceHandle(handle);
      setReplaceDetails(existing);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        const detail = cause instanceof Error ? cause.message : "Unable to validate this file";
        setError(
          detail.includes("GSN Paints backup")
            ? "This file is not a GSN Paints backup — nothing was changed."
            : detail,
        );
      }
    }
  }

  async function replaceExistingBackup() {
    if (!replaceHandle) return;
    setBusy(true);
    clearNotices();
    try {
      const saved = await writeSnapshot(replaceHandle);
      await confirmBackup(saved.fileName, saved.sizeBytes);
      setReplaceHandle(null);
      setReplaceDetails(null);
      setMessage("Backup replaced successfully.");
      setLastBackup(new Date().toISOString());
      const response = await fetch(`${API_URL}/backup/status`, { headers: authHeaders() });
      if (response.ok)
        setLastBackup(
          ((await response.json()) as { last_backup_at: string | null }).last_backup_at,
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Backup could not be replaced");
    } finally {
      setBusy(false);
    }
  }

  async function chooseRestoreFile() {
    clearNotices();
    if (!pickerWindow.showOpenFilePicker) {
      fallbackInput.current?.click();
      return;
    }
    try {
      const [handle] = await pickerWindow.showOpenFilePicker({ multiple: false });
      if (handle) await inspectRestoreFile(await handle.getFile());
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : "Unable to inspect backup");
      }
    }
  }

  async function inspectRestoreFile(file: File) {
    setBusy(true);
    clearNotices();
    try {
      const result = await inspectFile(file);
      if (!result.ticket) throw new Error("The server did not issue a restore ticket");
      setRestoreFile(file);
      setRestoreSummary(result.summary);
      setRestoreTicket(result.ticket);
      setRestoreText("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to inspect backup");
    } finally {
      setBusy(false);
    }
  }

  async function applyRestore() {
    if (!restoreTicket || restoreText !== "RESTORE") return;
    setBusy(true);
    clearNotices();
    try {
      const previousHealthResponse = await fetch(`${API_URL}/health`);
      if (!previousHealthResponse.ok) throw new Error("The server is not ready to restore");
      const previousHealth = (await previousHealthResponse.json()) as { instance_id: string };
      const response = await fetch(`${API_URL}/backup/restore-apply`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ ticket: restoreTicket, confirm: "RESTORE" }),
      });
      if (!response.ok) throw new Error(await readResponseError(response));
      setRestoreSummary(null);
      setRestoreTicket("");
      setMessage("Restoring… the app is restarting");
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        try {
          const healthResponse = await fetch(`${API_URL}/health`, { cache: "no-store" });
          if (!healthResponse.ok) continue;
          const currentHealth = (await healthResponse.json()) as { instance_id: string };
          if (
            currentHealth.instance_id &&
            currentHealth.instance_id !== previousHealth.instance_id
          ) {
            window.location.assign("/");
            return;
          }
        } catch {
          continue;
        }
      }
      throw new Error("The server did not finish restarting within 90 seconds");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Restore could not be applied");
    } finally {
      setBusy(false);
    }
  }

  function onFallbackFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void inspectRestoreFile(file);
  }

  return user?.role !== "admin" ? (
    <div role="alert" className="p-6 text-sm text-destructive">
      Only administrators can access backup and restore.
    </div>
  ) : (
    <div className="flex-1 space-y-6 p-6">
      <div className="mx-auto max-w-3xl space-y-6 rounded-xl border border-border bg-card p-8">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <DatabaseBackup className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Backup &amp; Restore</h1>
          <p className="text-sm text-muted-foreground">
            Create a verified backup or restore this database from a backup file.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Button className="h-20 text-base" disabled={busy} onClick={() => setCreateOpen(true)}>
            <DatabaseBackup className="mr-2 h-5 w-5" />
            Create Backup
          </Button>
          <Button
            className="h-20 text-base"
            variant="outline"
            disabled={busy}
            onClick={() => void chooseRestoreFile()}
          >
            <RotateCcw className="mr-2 h-5 w-5" />
            Restore Backup
          </Button>
        </div>

        <p className="text-center text-sm text-muted-foreground" data-testid="last-backup">
          Last backup: {lastBackup ? new Date(lastBackup).toLocaleString() : "never"}
        </p>
        {!pickerWindow.showDirectoryPicker && (
          <p className="text-center text-xs text-muted-foreground">
            File System Access is unavailable in this browser. Backups download normally; restore
            uses a file picker.
          </p>
        )}
        {message && (
          <p role="status" className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-800">
            {message}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>

      <input
        ref={fallbackInput}
        type="file"
        accept=".db,.sqlite,.sqlite3"
        className="hidden"
        onChange={onFallbackFileChange}
      />

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
            className="w-full max-w-md space-y-5 rounded-xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <h2 id="create-title" className="text-lg font-semibold">
                Create Backup
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={() => setCreateOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            {pickerWindow.showDirectoryPicker ? (
              <div className="grid gap-3">
                <Button onClick={() => void saveToFolder()}>
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Choose a folder
                </Button>
                {pickerWindow.showOpenFilePicker && (
                  <Button variant="outline" onClick={() => void chooseFileToReplace()}>
                    Choose an existing backup file
                  </Button>
                )}
              </div>
            ) : (
              <Button onClick={() => void saveToFolder()}>
                <DatabaseBackup className="mr-2 h-4 w-4" />
                Download backup
              </Button>
            )}
          </section>
        </div>
      )}

      {replaceHandle && replaceDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="replace-title"
            className="w-full max-w-lg space-y-5 rounded-xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <h2 id="replace-title" className="text-lg font-semibold">
                Replace backup file?
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={() => {
                  setReplaceHandle(null);
                  setReplaceDetails(null);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="space-y-2 text-sm">
              <p>
                <strong>Name:</strong> {replaceDetails.name}
              </p>
              <p>
                <strong>Size:</strong> {replaceDetails.size.toLocaleString()} bytes
              </p>
              <p>
                <strong>Last modified:</strong>{" "}
                {new Date(replaceDetails.lastModified).toLocaleString()}
              </p>
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 font-medium text-destructive">
                This file will be replaced. Its old content will be lost.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setReplaceHandle(null);
                  setReplaceDetails(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => void replaceExistingBackup()}
              >
                Replace file
              </Button>
            </div>
          </section>
        </div>
      )}

      {restoreSummary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            className="my-auto w-full max-w-xl space-y-5 rounded-xl border border-border bg-card p-6 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <h2 id="restore-title" className="text-lg font-semibold">
                Restore Backup
              </h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={() => {
                  setRestoreSummary(null);
                  setRestoreTicket("");
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p>
                <strong>Company:</strong> {restoreSummary.company_name}
              </p>
              <p>
                <strong>Backup date:</strong>{" "}
                {new Date(restoreSummary.backup_date).toLocaleString()}
              </p>
              <p>
                <strong>Users:</strong> {restoreSummary.counts.users}
              </p>
              <p>
                <strong>Customers:</strong> {restoreSummary.counts.customers}
              </p>
              <p>
                <strong>Suppliers:</strong> {restoreSummary.counts.suppliers}
              </p>
              <p>
                <strong>Items:</strong> {restoreSummary.counts.items}
              </p>
              <p>
                <strong>Vouchers:</strong> {restoreSummary.counts.vouchers}
              </p>
              <p>
                <strong>Schema version:</strong> {restoreSummary.schema_version}
              </p>
            </div>
            <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm font-medium text-destructive">
              Current data will be replaced by this backup. A safety copy of the current data is
              kept. You will be logged out and must log in with the usernames/passwords stored in
              the backup.
            </p>
            <label className="block space-y-1 text-sm font-medium" htmlFor="restore-confirm">
              Type RESTORE to continue
              <input
                id="restore-confirm"
                value={restoreText}
                onChange={(event) => setRestoreText(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono"
                autoComplete="off"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setRestoreSummary(null);
                  setRestoreTicket("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy || restoreText !== "RESTORE"}
                onClick={() => void applyRestore()}
              >
                {busy ? "Restoring…" : "Restore Backup"}
              </Button>
            </div>
            {restoreFile && (
              <p className="truncate text-xs text-muted-foreground">Selected: {restoreFile.name}</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/app/backup")({
  component: BackupPage,
});
