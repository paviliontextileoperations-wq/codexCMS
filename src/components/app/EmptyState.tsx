import { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="grid-lines flex flex-col items-center justify-center border-2 border-foreground/10 px-6 py-20 text-center">
      <div className="mb-4 flex gap-1">
        <div className="h-3 w-3 bg-bauhaus-red" />
        <div className="h-3 w-3 rounded-full bg-bauhaus-yellow" />
        <div className="h-3 w-3 bg-accent" />
      </div>
      <h3 className="font-display text-2xl">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}