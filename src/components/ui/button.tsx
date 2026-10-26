/**
 * @file button.tsx
 * @description 공통 Button UI 컴포넌트(캔버스 Tokens 보드의 저장·취소·더 보기·영구 삭제).
 * variant/size 기반 스타일링. class-variance-authority 없이 직접 매핑.
 */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: "default" | "secondary" | "outline" | "ghost" | "destructive" | "destructive-solid";
  size?: "default" | "sm" | "lg" | "icon" | "touch";
}

/** 링크처럼 버튼 모양만 필요한 곳(`<Link>`)도 같은 값을 쓰도록 class 이름을 따로 연다. */
export function buttonClassName({
  variant = "default",
  size = "default",
  className,
}: Pick<ButtonProps, "variant" | "size" | "className"> = {}) {
  const baseClass =
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-studio motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    // 저장: 먹색 면
    default: "bg-primary text-primary-foreground hover:bg-primary/88",
    // 채움 면 위의 보조 행동
    secondary: "bg-muted font-normal text-foreground hover:bg-selected",
    // 취소: 흰 면 + 1px 선
    outline: "border border-border bg-background font-normal text-foreground hover:bg-muted",
    // 더 보기: 글자 2, 면 없음
    ghost: "font-normal text-secondary-foreground hover:bg-muted hover:text-foreground",
    // 영구 삭제: 위험 선 + 위험 글자
    destructive: "border border-destructive-border bg-background font-normal text-destructive hover:bg-destructive-muted",
    // 삭제 확인: 위험 면
    "destructive-solid": "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  };

  const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
    default: "h-8 px-3.5 text-ui",
    sm: "h-7 px-2.5 text-xs",
    lg: "h-10 px-4 text-sm",
    icon: "size-8 text-ui",
    // 모바일 주 버튼: 높이 48 · r 8
    touch: "h-12 rounded-touch px-4 text-md",
  };

  return cn(baseClass, variants[variant], sizes[size], variant === "ghost" && size === "default" && "px-2.5", className);
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
    return <Comp className={buttonClassName({ variant, size, className })} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button };
