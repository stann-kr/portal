import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// globals.css의 글자 단계·모서리·그림자 토큰을 같은 종류로 알려야 `text-ui`가 글자색으로,
// `rounded-touch`가 다른 값으로 오인되어 지워지지 않는다.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ui", "body", "md", "dialog", "mobile-title", "display"],
      radius: ["touch"],
      shadow: ["segment", "floating", "overlay", "sheet", "drawer"],
      tracking: ["display", "title"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
