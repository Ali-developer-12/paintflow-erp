import { createFileRoute } from "@tanstack/react-router";
import { ModulePlaceholder } from "@/components/module-placeholder";

export const Route = createFileRoute("/app/items")({
  component: ItemsPage,
});

function ItemsPage() {
  return (
    <ModulePlaceholder
      title="Items Master"
      phase="Phase 2"
      description="The items and formula / BOM experience will be built next."
    />
  );
}
