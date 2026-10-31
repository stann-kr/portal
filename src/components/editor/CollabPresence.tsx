"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";
import { cn } from "@/lib/utils";

/**
 * 같은 문서를 연 다른 사람(Stann·학생) 표시. 같은 사람이 여러 기기로 열면 한 번만 보인다.
 * 색은 커서와 같은 token 순서(globals.css `.collab-caret`)를 쓴다.
 */
type Collaborator = { key: string; name: string; colorIndex: number };

const DOT_CLASS = [
  "bg-event-lesson",
  "bg-event-practice",
  "bg-event-gig",
  "bg-item-digging",
  "bg-item-qna",
  "bg-item-assignment",
] as const;

function readCollaborators(awareness: Awareness): Collaborator[] {
  const self = awareness.clientID;
  const selfUser = (awareness.getLocalState() as { user?: { userId?: string } } | null)?.user;
  const seen = new Map<string, Collaborator>();
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === self) continue;
    const user = (state as { user?: { name?: unknown; colorIndex?: unknown; userId?: unknown } }).user;
    if (!user || typeof user.name !== "string") continue;
    const key = typeof user.userId === "string" ? user.userId : `client:${clientId}`;
    if (selfUser?.userId && key === selfUser.userId) continue;
    if (!seen.has(key)) {
      seen.set(key, {
        key,
        name: user.name,
        colorIndex: typeof user.colorIndex === "number" ? Math.abs(user.colorIndex) % DOT_CLASS.length : 0,
      });
    }
  }
  return Array.from(seen.values());
}

export function CollabPresence({ awareness, className }: { awareness: Awareness | null | undefined; className?: string }) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!awareness) return () => {};
      awareness.on("change", onChange);
      return () => awareness.off("change", onChange);
    },
    [awareness],
  );
  // 같은 목록이면 같은 문자열이라 다시 그리지 않는다.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (awareness ? JSON.stringify(readCollaborators(awareness)) : "[]"),
    () => "[]",
  );
  const collaborators = useMemo(() => JSON.parse(snapshot) as Collaborator[], [snapshot]);
  if (collaborators.length === 0) return null;
  const label = `함께 보는 중: ${collaborators.map((person) => person.name).join(", ")}`;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground", className)} title={label}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="inline-flex items-center -space-x-1">
        {collaborators.slice(0, 3).map((person) => (
          <span key={person.key} className={cn("size-2.5 rounded-full ring-2 ring-background", DOT_CLASS[person.colorIndex])} />
        ))}
      </span>
      <span aria-hidden="true" className="truncate">
        {collaborators.length === 1 ? collaborators[0].name : `${collaborators[0].name} 외 ${collaborators.length - 1}명`}
      </span>
    </span>
  );
}
