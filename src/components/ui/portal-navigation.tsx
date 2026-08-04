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
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 backdrop-blur-sm sm:px-5">
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
                  "relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-[background-color,color,transform] active:translate-y-px disabled:pointer-events-none disabled:opacity-50 sm:px-3",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
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
