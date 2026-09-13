import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/backup")({
  component: BackupPage,
});

function BackupPage() {
  return (
    <ModulePlaceholder
      title="Backup"
      phase="Phase 7"
      description="Backup and data retention utilities will be added in Phase 7."
    />
  );
}
