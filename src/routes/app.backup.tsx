import { createFileRoute } from "@tanstack/react-router";
import { DatabaseBackup } from "lucide-react";
import { API_URL, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";

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
  return (
    <div className="flex-1 p-6">
      <div className="rounded-md border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2">
            <DatabaseBackup className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Backup</h1>
            <p className="text-sm text-muted-foreground">Download the current database</p>
          </div>
        </div>

        <div className="mt-6 max-w-md space-y-4 rounded-md border border-border bg-muted/20 p-4">
          <p className="text-sm text-muted-foreground">This creates a local database backup file from the active SQLite database.</p>
          <Button onClick={() => void exportDatabase()}><DatabaseBackup className="h-4 w-4" /> Export backup</Button>
        </div>
      </div>
    </div>
  );
}
