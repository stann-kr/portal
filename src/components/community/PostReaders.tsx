/**
 * @file src/components/community/PostReaders.tsx
 * @description 관리자 전용 게시물 읽음 표시(캔버스 PostReaders 보드). 머리 줄의 "읽음 5/7" 버튼과
 * 그 아래 펼치는 칸(읽은 학생·처음 읽은 시각, 아직 안 읽은 학생). 학생 화면에는 그리지 않는다.
 */
import { ChevronDown } from "lucide-react";
import type { PostReadSummary } from "@/lib/actions/postReads";
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

export function PostReadersPanel({ summary }: { summary: PostReadSummary }) {
  return (
    <section
      id={POST_READERS_PANEL_ID}
      aria-label="읽은 학생"
      className="flex flex-col gap-3 rounded-lg border border-border bg-background p-3.5 md:p-4"
    >
      {summary.readers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h2 className="text-ui font-semibold text-secondary-foreground">
            읽은 학생 <span className="font-mono font-normal text-muted-foreground">{summary.readers.length}</span>
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6">
            {summary.readers.map((reader) => (
              <li key={reader.id} className="flex h-8 items-center justify-between gap-3 border-b border-muted text-ui">
                <span className="min-w-0 truncate">{reader.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {formatKstMonthDayTime(reader.firstReadAt)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-ui text-secondary-foreground">아직 읽은 학생이 없습니다.</p>
      )}
      {summary.unread.length > 0 ? (
        <p className="text-ui text-secondary-foreground">
          <span className="font-semibold">
            아직 안 읽음 <span className="font-mono font-normal text-muted-foreground">{summary.unread.length}</span>
          </span>
          {"\u00a0\u00a0"}
          {summary.unread.map((student) => student.name).join(", ")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">학생이 처음 연 시각입니다. 글쓴이와 관리자는 세지 않습니다.</p>
    </section>
  );
}
