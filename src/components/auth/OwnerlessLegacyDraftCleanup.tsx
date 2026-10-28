"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  discardOwnerlessLegacyLocalDocumentDrafts,
  readOwnerlessLegacyLocalDocumentDrafts,
} from "@/lib/local-draft-continuity-client";
import type { OwnerlessLegacyDocumentDraftSnapshot } from "@/lib/local-document-drafts";

type CleanupPhase = "idle" | "confirm" | "success" | "error";

const REDUCED_MOTION_BUTTON_CLASS =
  "motion-reduce:transition-none motion-reduce:active:translate-y-0";

/** 현재 계정에 귀속할 수 없는 이전 버전 key는 로그인 전 명시적 2단계 확인으로만 지운다. */
export function OwnerlessLegacyDraftCleanup() {
  const [phase, setPhase] = useState<CleanupPhase>("idle");
  const [candidates, setCandidates] = useState<
    OwnerlessLegacyDocumentDraftSnapshot[]
  >([]);
  const [announcement, setAnnouncement] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (phase === "confirm") confirmRef.current?.focus();
    if (phase === "success" || phase === "error") statusRef.current?.focus();
  }, [phase]);

  const beginCleanup = () => {
    const result = readOwnerlessLegacyLocalDocumentDrafts();
    if (result.storageUnavailable || result.enumerationFailed) {
      setAnnouncement(
        "브라우저 저장소에 접근할 수 없어 이전 포탈 초안을 확인하지 못했습니다.",
      );
      setPhase("error");
      return;
    }
    if (result.snapshots.length === 0) {
      setAnnouncement("이 기기에 남아 있는 이전 포탈 초안이 없습니다.");
      setPhase("success");
      return;
    }
    setCandidates(result.snapshots);
    setAnnouncement(
      `현재 계정과 연결되지 않은 이전 포탈 초안 ${result.snapshots.length}개를 지우려면 삭제 확인을 누르세요.`,
    );
    setPhase("confirm");
  };

  const confirmCleanup = () => {
    const result = discardOwnerlessLegacyLocalDocumentDrafts(candidates);
    if (result.snapshotChanged) {
      setCandidates(result.currentSnapshots);
      if (result.currentSnapshots.length === 0) {
        setAnnouncement(
          "확인하는 동안 이전 포탈 초안 목록이 바뀌었으며, 현재 남은 초안은 없습니다.",
        );
        setPhase("success");
      } else {
        setAnnouncement(
          `확인하는 동안 이전 포탈 초안이 바뀌었습니다. 현재 ${result.currentSnapshots.length}개를 다시 확인한 뒤 삭제 확인을 누르세요.`,
        );
      }
      return;
    }
    if (
      result.storageUnavailable ||
      result.enumerationFailed ||
      result.failedKeys.length > 0
    ) {
      setAnnouncement(
        "이전 포탈 초안을 모두 지우지 못했습니다. 저장소 권한을 확인하고 다시 시도해 주세요.",
      );
      setPhase("error");
      return;
    }
    setAnnouncement(`이전 포탈 초안 ${result.removedKeys.length}개를 지웠습니다.`);
    setCandidates([]);
    setPhase("success");
  };

  const cancelCleanup = () => {
    setPhase("idle");
    setCandidates([]);
    setAnnouncement("이전 포탈 초안 삭제를 취소했습니다.");
    triggerRef.current?.focus();
  };

  return (
    <section
      className="mt-5 border-t border-border pt-4 motion-reduce:transition-none"
      aria-labelledby="ownerless-draft-cleanup-title"
    >
      <h2 id="ownerless-draft-cleanup-title" className="text-xs font-medium text-foreground">
        공유 기기 정리
      </h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        이전 버전에서 계정 정보 없이 저장된 초안은 자동으로 계정에 연결하거나 삭제하지 않습니다.
      </p>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="sm"
        className={`mt-2 h-auto whitespace-normal px-0 py-1 text-left text-destructive hover:bg-transparent max-md:min-h-11 ${REDUCED_MOTION_BUTTON_CLASS}`}
        onClick={beginCleanup}
        aria-expanded={phase === "confirm"}
        aria-controls="ownerless-draft-cleanup-confirmation"
      >
        이 기기의 이전 포탈 초안 모두 지우기
      </Button>

      {phase === "confirm" ? (
        <div
          id="ownerless-draft-cleanup-confirmation"
          className="mt-3 rounded-md border border-destructive/20 bg-destructive-muted p-3"
        >
          <p className="text-xs leading-5 text-destructive">
            현재 계정과 연결되지 않은 이전 포탈 초안 {candidates.length}개를 이 기기에서만 삭제합니다.
            삭제한 내용은 복구할 수 없습니다.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`max-md:h-11 ${REDUCED_MOTION_BUTTON_CLASS}`}
              onClick={cancelCleanup}
            >
              취소
            </Button>
            <Button
              ref={confirmRef}
              type="button"
              size="sm"
              className={`bg-destructive text-destructive-foreground hover:bg-destructive/90 max-md:h-11 ${REDUCED_MOTION_BUTTON_CLASS}`}
              onClick={confirmCleanup}
              aria-describedby="ownerless-draft-cleanup-status"
            >
              이전 초안 모두 삭제 확인
            </Button>
          </div>
        </div>
      ) : null}

      <p
        ref={statusRef}
        id="ownerless-draft-cleanup-status"
        role={phase === "error" ? "alert" : "status"}
        aria-live={phase === "error" ? "assertive" : "polite"}
        aria-atomic="true"
        tabIndex={phase === "success" || phase === "error" ? -1 : undefined}
        className={`mt-2 text-xs focus:outline-none ${phase === "error" ? "text-destructive" : "text-muted-foreground"}`}
      >
        {announcement}
      </p>
    </section>
  );
}
