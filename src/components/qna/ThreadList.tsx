"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type { QnaStatus } from "@/db/schema";
import {
  QNA_FILTER_TABS,
  QNA_STATUS_CONFIG,
  type QnaFilterTab,
} from "@/lib/qna-status";

type Thread = {
  id: string;
  title: string;
  status: QnaStatus;
  createdAt: Date | null | undefined;
  studentName: string | null | undefined;
  studentEmail: string | null | undefined;
};

interface ThreadListProps {
  threads: Thread[];
  isAdmin: boolean;
}

export function ThreadList({ threads, isAdmin }: ThreadListProps) {
  const [filter, setFilter] = useState<QnaFilterTab>("ALL");

  const counts = useMemo(
    () => ({
      ALL: threads.length,
      OPEN: threads.filter((thread) => thread.status === "OPEN").length,
      ANSWERED: threads.filter((thread) => thread.status === "ANSWERED").length,
      CLOSED: threads.filter((thread) => thread.status === "CLOSED").length,
    }),
    [threads],
  );

  const filteredThreads = useMemo(() => {
    if (filter === "ALL") {
      return threads;
    }

    return threads.filter((thread) => thread.status === filter);
  }, [filter, threads]);

  if (threads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
        <MessageCircle className="w-10 h-10 opacity-20" />
        <p className="text-sm">
          {isAdmin ? "아직 질문이 없습니다." : "아직 등록한 질문이 없습니다."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">
        {QNA_FILTER_TABS.map(({ id, label }) => {
          const isActive = filter === id;

          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={isActive}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {label} {counts[id]}
            </button>
          );
        })}
      </div>

      {filteredThreads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2 rounded-xl border border-dashed border-border bg-muted/20">
          <MessageCircle className="w-8 h-8 opacity-20" />
          <p className="text-sm">해당 상태의 스레드가 없습니다.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredThreads.map((thread) => {
            const { label, color, iconClassName, Icon } = QNA_STATUS_CONFIG[thread.status];
            const date = thread.createdAt
              ? new Date(thread.createdAt).toLocaleDateString("ko-KR", {
                  month: "short",
                  day: "numeric",
                })
              : "작성일 미정";
            const student =
              thread.studentName ?? thread.studentEmail?.split("@")[0] ?? "이름 미등록";

            return (
              <Link
                key={thread.id}
                href={`/dashboard/qna/${thread.id}`}
                className="flex items-center gap-4 p-4 rounded-xl border border-border bg-card hover:bg-accent/5 transition-colors group"
              >
                <Icon className={`w-4 h-4 flex-shrink-0 ${iconClassName}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{thread.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {isAdmin && (
                      <span className="text-xs text-muted-foreground">{student} /</span>
                    )}
                    <span className="text-xs text-muted-foreground">{date}</span>
                  </div>
                </div>
                <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-semibold ${color}`}>
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
