import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/stock")({
  component: StockPage,
});

function StockPage() {
  return (
    <ModulePlaceholder
      title="Stock"
      phase="Phase 6"
      description="Stock and material movement ledger workflows will be added in Phase 6."
    />
  );
}
