"use client";

import { useId } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/web-app-theme";
import { setThemePreference, useThemePreference } from "./theme-preference-client";

const LABELS: Record<ThemePreference, string> = { system: "시스템", light: "라이트", dark: "다크" };

/**
 * 계정 메뉴 맨 위 '화면 모드'(개선 2차 시안 2번): [시스템 | 라이트 | 다크] 세 칸.
 * 메뉴 안이라 Radix 메뉴 radio(menuitemradio)로 두어 화살표 키로 옮겨 다닌다. 고르면 메뉴를 닫지 않고 바로 적용한다.
 */
export function ThemeModeMenuGroup({ size }: { size: "md" | "touch" }) {
  const preference = useThemePreference();
  const labelId = useId();
  return (
    <div className="px-1 pb-1 pt-1.5">
      <DropdownMenu.Label id={labelId} className="px-1.5 pb-1.5 text-xs text-muted-foreground">
        화면 모드
      </DropdownMenu.Label>
      <DropdownMenu.RadioGroup
        aria-labelledby={labelId}
        value={preference}
        onValueChange={(value) => setThemePreference(value as ThemePreference)}
        className="grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5"
      >
        {THEME_PREFERENCES.map((value) => (
          <DropdownMenu.RadioItem
            key={value}
            value={value}
            onSelect={(event) => event.preventDefault()}
            className={cn(
              "flex cursor-default select-none items-center justify-center rounded-sm text-ui text-secondary-foreground outline-none",
              "data-[highlighted]:ring-2 data-[highlighted]:ring-ring data-[state=checked]:bg-background data-[state=checked]:font-medium data-[state=checked]:text-foreground data-[state=checked]:shadow-segment",
              size === "touch" ? "h-11" : "h-11 md:h-8",
            )}
          >
            {LABELS[value]}
          </DropdownMenu.RadioItem>
        ))}
      </DropdownMenu.RadioGroup>
    </div>
  );
}
