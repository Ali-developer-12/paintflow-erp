import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/counter-sale")({
  component: CounterSalePage,
});

function CounterSalePage() {
  return (
    <ModulePlaceholder
      title="Counter Sale"
      phase="Phase 5"
      description="The counter-sale workflow placeholder is now available while the full sales flow is assembled."
    />
  );
}
