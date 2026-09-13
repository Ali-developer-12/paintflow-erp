import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/issue-voucher")({
  component: IssueVoucherPage,
});

function IssueVoucherPage() {
  return (
    <ModulePlaceholder
      title="Issue Voucher"
      phase="Phase 5"
      description="The issue voucher workflow placeholder is now available while the sales and voucher flow is assembled."
    />
  );
}
