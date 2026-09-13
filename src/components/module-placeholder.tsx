import { Construction } from "lucide-react";

export function ModulePlaceholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: string;
  description: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-panel">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-accent/15 text-accent-foreground">
          <Construction className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <p className="mt-4 inline-flex rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          Scheduled for {phase}
        </p>
      </div>
    </div>
  );
}
