import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/returns")({
  component: ReturnsPage,
});

function ReturnsPage() {
  return (
    <ModulePlaceholder
      title="Return"
      phase="Phase 5"
      description="The return workflow placeholder is now available while the sales and voucher flow is assembled."
    />
  );
}
