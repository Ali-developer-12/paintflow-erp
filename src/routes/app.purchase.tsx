import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/purchase")({
  component: PurchasePage,
});

function PurchasePage() {
  return (
    <ModulePlaceholder
      title="Purchase"
      phase="Phase 4"
      description="Purchase voucher entry and purchasing workflows will be built in Phase 4."
    />
  );
}
