"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClassName } from "@/components/ui/button";
import { ConfirmPanel, useConfirmAction } from "@/components/ui/confirm-action";
import {
  disconnectCalendarConnection,
  removeCalendarMapping,
  syncCalendarMappingNow,
  type CalendarConnectionSummary,
  type CalendarMappingSummary,
  type CalendarSyncFormState,
} from "@/lib/actions/calendarSync";
import { formatKst } from "@/lib/kst-format";
import { cn } from "@/lib/utils";
import { FeedbackMessages, feedbackDescribedBy } from "./FeedbackMessages";
import { MappingForm } from "./MappingForm";
import { ACTION_BUTTON_CLASS, CALENDAR_SYNC_MESSAGES, GOOGLE_CONNECT_HREF, NOTICE_CLASS, PROVIDER_LABEL } from "./calendar-sync-ui";

type Feedback = { tone: "error" | "success"; text: string } | null;

function toFeedback(result: CalendarSyncFormState): Feedback {
  if (result.error) return { tone: "error", text: result.error };
  return result.success ? { tone: "success", text: result.success } : null;
}

/** 연결 계정 한 개: 상태·오류, 학생 캘린더 매핑 목록·추가, 연결 해제. */
export function ConnectionCard({
  connection,
  students,
  googleReconnectEnabled,
}: {
  connection: CalendarConnectionSummary;
  students: { id: string; name: string }[];
  googleReconnectEnabled: boolean;
}) {
  const router = useRouter();
  const headingId = useId();
  const statusId = useId();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const disconnectConfirm = useConfirmAction();
  const removeConfirm = useConfirmAction<string>();
  const needsReauth = connection.status === "NEEDS_REAUTH";
  const providerLabel = PROVIDER_LABEL[connection.provider];
  const mappedStudentIds = new Set(connection.mappings.map((mapping) => mapping.studentId));

  function run(key: string, action: () => Promise<CalendarSyncFormState>) {
    setPendingAction(key);
    startTransition(async () => {
      try {
        const result = await action();
        setFeedback(toFeedback(result));
        if (!result.error) router.refresh();
      } catch {
        setFeedback({ tone: "error", text: CALENDAR_SYNC_MESSAGES.unexpected });
      } finally {
        setPendingAction(null);
      }
    });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4 rounded-lg border border-border p-4 md:p-5">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 id={headingId} className="min-w-0 break-all text-body font-semibold text-foreground">
            {connection.accountLabel}
          </h3>
          <span className="text-ui text-muted-foreground md:text-xs">{providerLabel}</span>
          <span className="inline-flex items-center gap-1.5 text-ui text-secondary-foreground md:text-xs">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", needsReauth ? "bg-warning" : "bg-success")} />
            {needsReauth ? "다시 연결 필요" : "연결됨"}
          </span>
        </div>
        {connection.lastError ? (
          <p className="text-ui text-destructive md:text-xs">최근 오류: {connection.lastError}</p>
        ) : null}
      </header>

      {needsReauth ? (
        <div className={cn(NOTICE_CLASS, "flex flex-col gap-2 border-warning-border bg-warning-muted text-foreground md:flex-row md:items-center md:justify-between")}>
          <p>
            {connection.provider === "GOOGLE"
              ? "Google 인증이 만료되었거나 접근이 취소되어 동기화를 멈췄습니다. 같은 계정으로 다시 연결해 주세요."
              : "iCloud 앱 전용 암호가 더 이상 맞지 않아 동기화를 멈췄습니다. 새 앱 전용 암호로 다시 연결해 주세요."}
          </p>
          {connection.provider === "GOOGLE" && googleReconnectEnabled ? (
            <a href={GOOGLE_CONNECT_HREF} className={buttonClassName({ variant: "outline", className: cn(ACTION_BUTTON_CLASS, "shrink-0") })}>
              Google 다시 연결
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <h4 className="text-ui font-semibold text-secondary-foreground">학생 캘린더</h4>
        {connection.mappings.length === 0 ? (
          <p className="text-ui text-muted-foreground">아직 동기화할 학생 캘린더를 정하지 않았습니다.</p>
        ) : (
          <ul className="flex flex-col border-t border-border" aria-label={`${connection.accountLabel} 학생 캘린더 매핑`}>
            {connection.mappings.map((mapping) => (
              <MappingRow
                key={mapping.id}
                mapping={mapping}
                syncing={isPending && pendingAction === `sync:${mapping.id}`}
                busy={isPending}
                removing={isPending && pendingAction === `remove:${mapping.id}`}
                confirm={removeConfirm}
                statusId={statusId}
                onSync={() => run(`sync:${mapping.id}`, () => syncCalendarMappingNow(mapping.id))}
                onRemove={() => run(`remove:${mapping.id}`, () => removeCalendarMapping(mapping.id))}
              />
            ))}
          </ul>
        )}
      </div>

      {needsReauth ? null : (
        <MappingForm
          connectionId={connection.id}
          students={students.filter((student) => !mappedStudentIds.has(student.id))}
          allStudentsMapped={students.length > 0 && students.every((student) => mappedStudentIds.has(student.id))}
        />
      )}

      <FeedbackMessages
        id={statusId}
        error={feedback?.tone === "error" ? feedback.text : undefined}
        success={feedback?.tone === "success" ? feedback.text : undefined}
      />

      <div className="flex flex-col gap-3 border-t border-border pt-4 md:flex-row md:flex-wrap md:items-center md:justify-end">
        <Button
          type="button"
          variant="destructive"
          className={cn(ACTION_BUTTON_CLASS, "w-full md:w-auto")}
          hidden={disconnectConfirm.isOpen}
          disabled={isPending}
          aria-expanded={disconnectConfirm.isOpen}
          onClick={(event) => disconnectConfirm.request(event.currentTarget)}
        >
          연결 해제
        </Button>
        {disconnectConfirm.isOpen ? (
          <ConfirmPanel
            confirm={disconnectConfirm}
            message={`${connection.accountLabel} 연결을 해제합니다. 포털 레슨·일정은 남고 동기화만 멈춥니다.`}
            confirmLabel="연결 해제 확인"
            pendingLabel="해제 중"
            pending={isPending && pendingAction === "disconnect"}
            onConfirm={() => run("disconnect", () => disconnectCalendarConnection(connection.id))}
            className="basis-full"
          />
        ) : null}
      </div>
    </section>
  );
}

function MappingRow({
  mapping,
  syncing,
  removing,
  busy,
  confirm,
  statusId,
  onSync,
  onRemove,
}: {
  mapping: CalendarMappingSummary;
  syncing: boolean;
  removing: boolean;
  busy: boolean;
  confirm: ReturnType<typeof useConfirmAction<string>>;
  statusId: string;
  onSync: () => void;
  onRemove: () => void;
}) {
  const confirming = confirm.value === mapping.id;
  const lastSynced = mapping.lastSyncedAt ? formatKst(mapping.lastSyncedAt, undefined, "") : "";

  return (
    <li className="flex flex-col gap-2 border-b border-muted py-3 md:flex-row md:flex-wrap md:items-center md:gap-4">
      <div className="flex min-w-0 flex-col gap-0.5 md:flex-[1_1_320px]">
        <p className="text-body text-foreground md:text-ui">
          <span className="font-medium">{mapping.studentName}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="break-all">{mapping.remoteCalendarName}</span>
        </p>
        <p className="text-ui text-muted-foreground md:text-xs">
          {lastSynced ? `마지막 동기화 ${lastSynced}` : "아직 동기화 전"}
        </p>
        {mapping.lastError ? (
          <p className="text-ui text-destructive md:text-xs">동기화 오류: {mapping.lastError}</p>
        ) : null}
      </div>
      {confirming ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className={cn(ACTION_BUTTON_CLASS, "flex-auto md:flex-none")}
            pending={syncing}
            disabled={busy}
            aria-describedby={feedbackDescribedBy(statusId)}
            aria-label={`${mapping.studentName} 지금 동기화`}
            onClick={onSync}
          >
            {syncing ? "동기화 중" : "지금 동기화"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={cn(ACTION_BUTTON_CLASS, "flex-auto md:flex-none")}
            disabled={busy}
            aria-expanded={false}
            aria-label={`${mapping.studentName} 매핑 해제`}
            onClick={(event) => confirm.request(event.currentTarget, mapping.id)}
          >
            매핑 해제
          </Button>
        </div>
      )}
      {confirming ? (
        <ConfirmPanel
          confirm={confirm}
          message={`${mapping.studentName} 학생의 동기화를 멈춥니다. 포털 레슨·일정과 원격 캘린더 일정은 남습니다.`}
          confirmLabel="매핑 해제 확인"
          pendingLabel="해제 중"
          pending={removing}
          onConfirm={onRemove}
          className="basis-full"
        />
      ) : null}
    </li>
  );
}
