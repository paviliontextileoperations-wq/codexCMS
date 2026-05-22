export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex h-7 w-7 items-center justify-center bg-foreground">
        <div className="h-3 w-3 bg-accent" />
      </div>
      <span className="font-display text-lg leading-none">FORM</span>
    </div>
  );
}