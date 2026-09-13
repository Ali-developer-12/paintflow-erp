import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
});

function AccountsPage() {
  return (
    <ModulePlaceholder
      title="Accounts"
      phase="Phase 6"
      description="Accounts, account ledger, and finance workflows will be added in Phase 6."
    />
  );
}
