/**
 * @file src/components/community/PostReaders.tsx
 * @description 관리자 전용 게시물 읽음 표시(캔버스 PostReaders 보드). 머리 줄의 "읽음 5/7" 버튼과
 * 그 아래 펼치는 칸(읽은 학생·처음 읽은 시각, 아직 안 읽은 학생·알림 꺼짐, 공지면 다시 알리기). 학생 화면에는 그리지 않는다.
 * 캔버스 PushNotices ②.
 */
"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { remindPostUnread, type PostReadSummary } from "@/lib/actions/postReads";
import { RemindUnreadButton } from "./RemindUnreadButton";
import { formatKstMonthDayTime } from "@/lib/kst-format";
import { cn } from "@/lib/utils";

export const POST_READERS_PANEL_ID = "post-readers";

export function PostReadersToggle({
  summary,
  open,
  onToggle,
}: {
  summary: PostReadSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const total = summary.readers.length + summary.unread.length;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={POST_READERS_PANEL_ID}
      aria-label={`읽은 학생 ${summary.readers.length}명, 전체 ${total}명`}
      className={cn(
        "-mx-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-ui text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        open && "bg-muted",
      )}
    >
      읽음 <span className="font-mono">{summary.readers.length}/{total}</span>
      <ChevronDown className={cn("size-3", open && "rotate-180")} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

type ReaderRow = { id: string; name: string; at: Date };
type UnreadRow = { id: string; name: string; pushOff?: boolean };

/** 안 읽은 학생 이름 줄. 알림을 받을 수 없는 학생 뒤에 "알림 꺼짐"을 붙인다. */
function UnreadNames({ unread }: { unread: UnreadRow[] }) {
  return (
    <>
      {unread.map((student, index) => (
        <span key={student.id}>
          {index > 0 ? ", " : null}
          {student.name}
          {student.pushOff ? (
            <span className="ml-1 inline-flex h-5 items-center rounded-sm bg-muted px-1.5 align-[1px] text-[11px] text-secondary-foreground">
              알림 꺼짐
            </span>
          ) : null}
        </span>
      ))}
    </>
  );
}

/**
 * 읽은 학생·안 읽은 학생 칸. 게시물 상세와 글 없는 알림(공지 탭) 모두 쓴다.
 * actions는 칸 아래 줄(다시 알리기·지우기), footnote는 마지막 안내 문장이다.
 */
export function ReadersPanel({
  id,
  readers,
  unread,
  actions,
  footnote,
  className,
}: {
  id?: string;
  readers: ReaderRow[];
  unread: UnreadRow[];
  actions?: ReactNode;
  footnote: string;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-label="읽은 학생"
      className={cn("flex flex-col gap-3 rounded-lg border border-border bg-background p-3.5 md:p-4", className)}
    >
      {readers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h2 className="text-ui font-semibold text-secondary-foreground">
            읽은 학생 <span className="font-mono font-normal text-muted-foreground">{readers.length}</span>
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6">
            {readers.map((reader) => (
              <li key={reader.id} className="flex h-8 items-center justify-between gap-3 border-b border-muted text-ui">
                <span className="min-w-0 truncate">{reader.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatKstMonthDayTime(reader.at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ui text-secondary-foreground">아직 읽은 학생이 없습니다.</p>
      )}
      {unread.length > 0 ? (
        <p className="text-ui leading-[22px] text-secondary-foreground">
          <span className="font-semibold">
            아직 안 읽음 <span className="font-mono font-normal text-muted-foreground">{unread.length}</span>
          </span>
          {"\u00a0\u00a0"}
          <UnreadNames unread={unread} />
        </p>
      ) : null}
      {actions}
      <p className="text-xs text-muted-foreground">{footnote}</p>
    </section>
  );
}

export function PostReadersPanel({ summary, postId }: { summary: PostReadSummary; postId: string }) {
  return (
    <ReadersPanel
      id={POST_READERS_PANEL_ID}
      readers={summary.readers.map((reader) => ({ id: reader.id, name: reader.name, at: reader.firstReadAt }))}
      unread={summary.unread}
      actions={summary.canRemind && summary.unread.length > 0 ? (
        <RemindUnreadButton
          unreadCount={summary.unread.length}
          lastRemindedAt={summary.lastRemindedAt}
          remind={() => remindPostUnread(postId)}
        />
      ) : null}
      footnote={summary.unread.some((student) => student.pushOff)
        ? "학생이 처음 연 시각입니다. 글쓴이와 관리자는 세지 않습니다. 알림 꺼짐은 알림 받을 기기가 없거나 공지 알림을 끈 학생입니다."
        : "학생이 처음 연 시각입니다. 글쓴이와 관리자는 세지 않습니다."}
    />
  );
}
