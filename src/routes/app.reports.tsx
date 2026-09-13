import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  return (
    <ModulePlaceholder
      title="Reports"
      phase="Phase 7"
      description="Operational reports and management reporting views will be added in Phase 7."
    />
  );
}
