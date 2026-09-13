import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/setup")({
  component: SetupPage,
});

function SetupPage() {
  return (
    <ModulePlaceholder
      title="Setup / Masters"
      phase="Phase 3"
      description="Employee, customer, supplier, transporter, account chart, and factory item masters will be added in Phase 3."
    />
  );
}
