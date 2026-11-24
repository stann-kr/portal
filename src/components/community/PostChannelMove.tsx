"use client";

/**
 * @file src/components/community/PostChannelMove.tsx
 * @description 자유 게시판 글을 다른 채널로 옮기는 작은 칸(감사 보완 #3). 작성자 본인이나 Stann에게만 보인다.
 * 한 칸짜리 짧은 form이라 local draft를 두지 않는다. 같은 판의 같은 이동은 같은 요청 id로 보내 재전송해도 한 번만 반영된다.
 */
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { movePostToChannel } from "@/lib/actions/posts";
import { createCreationOperationId } from "@/lib/creation-operation";

export type PostChannelOption = { slug: string; name: string };

export function PostChannelMove({
  postId,
  version,
  currentSlug,
  channels,
  onClose,
}: {
  postId: string;
  version: number;
  currentSlug: string;
  channels: readonly PostChannelOption[];
  onClose: () => void;
}) {
  const fieldId = useId();
  const router = useRouter();
  const others = channels.filter((channel) => channel.slug !== currentSlug);
  const [target, setTarget] = useState(others[0]?.slug ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const operation = useRef<{ key: string; id: string } | null>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => selectRef.current?.focus(), []);

  const submit = () => {
    if (isPending || !target) return;
    const key = JSON.stringify([postId, version, target]);
    if (operation.current?.key !== key) operation.current = { key, id: createCreationOperationId() };
    const operationId = operation.current.id;
    setError(null);
    startTransition(async () => {
      try {
        const result = await movePostToChannel(postId, target, operationId, version);
        if (!result.success) {
          setError(result.conflictKind === "VERSION_CONFLICT"
            ? "방금 다른 화면에서 이 게시물이 바뀌었습니다. 새로고침한 뒤 다시 옮겨 주세요."
            : result.error ?? "채널을 옮기지 못했습니다.");
          return;
        }
        onClose();
        router.refresh();
      } catch {
        setError("채널을 옮기지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <form
      aria-label="채널 옮기기"
      className="flex max-w-md flex-col gap-2 rounded-lg border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || isPending) return;
        event.preventDefault();
        onClose();
      }}
    >
      {others.length === 0 ? (
        <p className="text-ui text-secondary-foreground">옮길 다른 채널이 없습니다.</p>
      ) : (
        <>
          <label htmlFor={fieldId} className="text-ui font-medium text-foreground">옮길 채널</label>
          <select
            ref={selectRef}
            id={fieldId}
            value={target}
            disabled={isPending}
            onChange={(event) => {
              setTarget(event.target.value);
              setError(null);
            }}
            className="h-11 rounded-touch border border-input bg-background px-3 text-base text-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring md:h-9 md:rounded-md md:text-sm"
          >
            {others.map((channel) => (
              <option key={channel.slug} value={channel.slug}># {channel.name}</option>
            ))}
          </select>
        </>
      )}
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isPending} className="max-md:h-11">취소</Button>
        {others.length > 0 ? (
          <Button type="submit" size="sm" pending={isPending} disabled={!target} className="max-md:h-11">옮기기</Button>
        ) : null}
      </div>
    </form>
  );
}
