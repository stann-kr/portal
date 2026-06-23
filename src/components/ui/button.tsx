/**
 * @file button.tsx
 * @description 공통 Button UI 컴포넌트.
 * variant/size 기반 스타일링. class-variance-authority 없이 직접 매핑.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: "default" | "secondary" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      asChild = false,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    const baseClass =
      "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50";

    const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
      default:
        "bg-primary text-primary-foreground hover:bg-primary/85",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
      outline: "border border-border bg-background text-foreground hover:bg-accent hover:border-border/80",
      ghost: "text-foreground hover:bg-accent",
    };

    const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
      default: "h-8 px-3.5 py-2",
      sm: "h-7 rounded-md px-2.5 text-xs",
      lg: "h-9 rounded-md px-6",
      icon: "h-8 w-8",
    };

    return (
      <Comp
        className={cn(baseClass, variants[variant], sizes[size], className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
