import type { ElementType } from "react";
import { cn } from "@/lib/utils";

export type PortalNavigationItem<T extends string> = {
  id: T;
  label: string;
  Icon: ElementType;
};

export function PortalNavigation<T extends string>({
  items,
  activeItem,
  onChange,
  disabled = false,
  endSlot,
  ariaLabel,
}: {
  items: readonly PortalNavigationItem<T>[];
  activeItem: T;
  onChange: (item: T) => void;
  disabled?: boolean;
  endSlot?: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-border bg-background/95 px-3 backdrop-blur-sm sm:px-5">
      <div className="mx-auto flex min-h-14 max-w-[1400px] items-center gap-1 overflow-x-auto">
        <nav aria-label={ariaLabel} className="flex items-center gap-1">
          {items.map(({ id, label, Icon }) => {
            const isActive = activeItem === id;

            return (
              <button
                key={id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                disabled={disabled}
                onClick={() => onChange(id)}
                className={cn(
                  "relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 sm:px-3 sm:text-sm",
                  items.length > 3 ? "px-2 text-xs" : "px-2.5 text-sm",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className={cn("size-3.5", items.length > 3 && "hidden sm:block")} aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </nav>
        {endSlot ? <div className="ml-auto shrink-0 pl-2">{endSlot}</div> : null}
      </div>
    </header>
  );
}
