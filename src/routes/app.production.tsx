import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/production")({
  component: ProductionPage,
});

function ProductionPage() {
  return (
    <ModulePlaceholder
      title="Production"
      phase="Phase 4"
      description="Production planning, batch tracking, and output workflows will be added in Phase 4."
    />
  );
}
