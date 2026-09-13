import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/sales")({
  component: SalesPage,
});

function SalesPage() {
  return (
    <ModulePlaceholder
      title="Sales"
      phase="Phase 5"
      description="Counter sale, issue voucher, and return flows will be added in Phase 5."
    />
  );
}
