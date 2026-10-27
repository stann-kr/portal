import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 캔버스 입력: 높이 36 · r 6 · 1px 선, 초점은 강조 파랑 2px 안쪽 선. 좁은 화면은 44 · r 8 · 16px(확대 방지).
          // WebKit은 날짜·시간 입력에 :focus-visible을 맞추지 않아 이 타입만 :focus에도 같은 선을 둔다.
          "flex h-11 w-full rounded-touch border border-input bg-background px-3 py-1 text-base text-foreground transition-[border-color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-1 [&:is([type=date],[type=datetime-local],[type=time]):focus]:outline-2 [&:is([type=date],[type=datetime-local],[type=time]):focus]:outline-ring [&:is([type=date],[type=datetime-local],[type=time]):focus]:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive-border md:h-9 md:rounded-md md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
