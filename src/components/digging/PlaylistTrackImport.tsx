/**
 * @file src/components/digging/PlaylistTrackImport.tsx
 * @description 플레이리스트 줄 아래 "트랙 가져오기" 칸(2026-11-21 사용자 결정, 캔버스 Decisions1121 ③).
 * - SoundCloud: 공식 위젯으로 앞 20곡의 제목·아티스트·링크를 읽고, 나머지는 붙여 넣어 더한다.
 * - Beatport: 자동으로 읽을 수 없어 붙여넣기('아티스트 - 제목' 줄)만 받는다.
 * - 보드에 이미 있는 곡(링크, 링크가 없으면 트랙명·아티스트)은 고를 수 없다. 고른 곡만 오늘 날짜 묶음에 들어간다.
 * 트랙 보드는 학생 본인만 바꾸므로 학생 디깅 화면에서만 연다. 서버가 같은 규칙을 다시 검사한다.
 */
"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { importDiggingTracks, type ImportDiggingTracksResult } from "@/lib/actions/digging";
import type { DiggingPlaylist } from "@/lib/actions/digging-playlists";
import {
  diggingBoardImportKeys,
  diggingImportKey,
  findDiggingImportColumns,
  parsePastedTrackList,
  readSoundCloudImportCandidates,
  type DiggingImportCandidate,
} from "@/lib/digging-import";
import { useBusyNavigationGuard } from "@/lib/hooks/useBusyNavigationGuard";
import { useUnsavedUnloadGuard } from "@/lib/hooks/useUnsavedUnloadGuard";
import { cn } from "@/lib/utils";
import { readSoundCloudPlaylistSounds } from "./soundcloud-playlist-sounds";

export type ImportedDiggingTrack = Extract<ImportDiggingTracksResult, { ok: true }>["created"][number];

/** 가져오기가 보는 보드. 학생 디깅 화면이 보드와 같은 트랙 목록을 넘긴다. */
export type DiggingTrackImportBoard = {
  columns: readonly { id: string; name: string; columnType: string }[];
  tracks: readonly { linkUrl?: string | null; values: Record<string, unknown> }[];
  onImported: (created: ImportedDiggingTrack[]) => void;
};

type SoundCloudState =
  | { status: "loading" }
  | { status: "ready"; total: number; candidates: DiggingImportCandidate[] }
  | { status: "error" };

const TEXTAREA_CLASS =
  "w-full resize-y rounded-touch border border-input bg-background px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:opacity-50 md:rounded-md md:py-2 md:text-sm";
const NOTE_CLASS = "text-ui text-secondary-foreground";
const ACTION_CLASS = "md:h-9 md:rounded-md md:px-3.5 md:text-ui";

export function PlaylistTrackImport({
  playlist,
  board,
  onRequestClose,
  onDirtyChange,
}: {
  playlist: Pick<DiggingPlaylist, "provider" | "url">;
  board: DiggingTrackImportBoard;
  /** 닫기·Esc. 붙여 넣은 글이 있으면 부모가 버림 확인을 거친다. */
  onRequestClose: () => void;
  /** 붙여 넣은 글이 있는지. 칸이 사라질 때는 false로 돌린다. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const pasteId = useId();
  const soundCloud = playlist.provider === "soundcloud";
  const [sc, setSc] = useState<SoundCloudState>({ status: "loading" });
  const [pasteText, setPasteText] = useState("");
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, startImport] = useTransition();

  useBusyNavigationGuard(pending);
  useUnsavedUnloadGuard(pasteText.trim().length > 0);
  const updatePasteText = (value: string) => {
    setPasteText(value);
    onDirtyChange?.(value.trim().length > 0);
  };
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    if (!soundCloud) return;
    const controller = new AbortController();
    readSoundCloudPlaylistSounds(playlist.url, controller.signal)
      .then((sounds) => {
        const { total, candidates } = readSoundCloudImportCandidates(sounds);
        setSc(candidates.length > 0 ? { status: "ready", total, candidates } : { status: "error" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSc({ status: "error" });
      });
    return () => controller.abort();
  }, [soundCloud, playlist.url]);

  const ids = useMemo(() => findDiggingImportColumns(board.columns), [board.columns]);
  const boardKeys = useMemo(() => diggingBoardImportKeys(board.tracks, ids), [board.tracks, ids]);
  const pasted = useMemo(() => parsePastedTrackList(pasteText), [pasteText]);
  const rows = useMemo(() => {
    const listed = new Set<string>();
    const result: { candidate: DiggingImportCandidate; key: string; onBoard: boolean }[] = [];
    const loaded = sc.status === "ready" ? sc.candidates : [];
    for (const candidate of [...loaded, ...pasted]) {
      const key = diggingImportKey(candidate);
      // 위 목록과 같은 곡(링크, 링크가 없는 줄은 트랙명·아티스트)은 한 번만 보인다.
      if (listed.has(key)) continue;
      listed.add(key);
      listed.add(diggingImportKey({ ...candidate, linkUrl: null }));
      result.push({ candidate, key, onBoard: boardKeys.has(key) });
    }
    return result;
  }, [sc, pasted, boardKeys]);
  const selected = rows.filter((row) => !row.onBoard && !unchecked.has(row.key));

  const toggleRow = (key: string, checked: boolean) => {
    setUnchecked((current) => {
      const next = new Set(current);
      if (checked) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const submit = () => {
    if (selected.length === 0 || pending) return;
    const items = selected.map((row) => row.candidate);
    setError("");
    setNotice("");
    startImport(async () => {
      try {
        const result = await importDiggingTracks(items);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        board.onImported(result.created);
        updatePasteText("");
        setNotice(
          `${result.created.length}곡을 디깅 보드에 넣었습니다.`
          + (result.skipped > 0 ? ` 이미 보드에 있던 ${result.skipped}곡은 건너뛰었습니다.` : ""),
        );
      } catch {
        setError("트랙을 가져오지 못했습니다. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div
      className="flex flex-col gap-2.5 rounded-[10px] border border-muted p-3.5"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || pending) return;
        event.preventDefault();
        onRequestClose();
      }}
    >
      {soundCloud ? <SoundCloudSummary state={sc} /> : (
        <p className={NOTE_CLASS}>Beatport 곡 목록은 자동으로 읽을 수 없습니다. 플레이리스트 화면에서 곡 목록을 선택해 복사한 뒤 붙여 넣으세요.</p>
      )}

      {soundCloud && rows.length > 0 ? <ImportList rows={rows} unchecked={unchecked} disabled={pending} onToggle={toggleRow} /> : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={pasteId} className={NOTE_CLASS}>{soundCloud ? "나머지 곡 목록 붙여넣기(선택)" : "곡 목록 붙여넣기"}</label>
        <textarea
          id={pasteId}
          rows={soundCloud ? 2 : 3}
          value={pasteText}
          onChange={(event) => { updatePasteText(event.target.value); setNotice(""); }}
          placeholder="한 줄에 한 곡: 아티스트 - 제목"
          disabled={pending}
          className={TEXTAREA_CLASS}
        />
      </div>

      {!soundCloud && rows.length > 0 ? <ImportList rows={rows} unchecked={unchecked} disabled={pending} onToggle={toggleRow} /> : null}

      {pasted.length > 0 ? (
        <p className="text-xs text-muted-foreground">붙여 넣은 곡에는 링크가 없습니다. 보드에서 링크 칸으로 더할 수 있습니다.</p>
      ) : null}
      {error ? <p role="alert" className="text-ui text-destructive">{error}</p> : null}
      <p role="status" className={cn("text-ui text-secondary-foreground", !notice && "sr-only")}>{notice}</p>

      <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
        <Button type="button" variant="outline" size="touch" className={ACTION_CLASS} onClick={onRequestClose} disabled={pending}>
          닫기
        </Button>
        <Button
          type="button"
          size="touch"
          className={ACTION_CLASS}
          onClick={submit}
          disabled={selected.length === 0 || pending}
          aria-busy={pending || undefined}
        >
          {pending ? "추가 중..." : `고른 ${selected.length}곡 디깅 보드에 추가`}
        </Button>
      </div>
    </div>
  );
}

function SoundCloudSummary({ state }: { state: SoundCloudState }) {
  if (state.status === "loading") {
    return <p role="status" className={NOTE_CLASS}>SoundCloud에서 곡 목록을 읽는 중...</p>;
  }
  if (state.status === "error") {
    return (
      <p role="alert" className={NOTE_CLASS}>
        SoundCloud에서 곡 목록을 읽지 못했습니다. 플레이리스트 화면에서 곡 목록을 복사해 아래에 붙여 넣을 수 있습니다.
      </p>
    );
  }
  const loaded = state.candidates.length;
  return (
    <p className={NOTE_CLASS}>
      {loaded < state.total
        ? `${state.total}곡 중 앞 ${loaded}곡을 불러왔습니다. 나머지 ${state.total - loaded}곡은 아래에 목록을 붙여 넣어 더할 수 있습니다.`
        : `${loaded}곡을 불러왔습니다.`}
    </p>
  );
}

function ImportList({
  rows,
  unchecked,
  disabled,
  onToggle,
}: {
  rows: { candidate: DiggingImportCandidate; key: string; onBoard: boolean }[];
  unchecked: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (key: string, checked: boolean) => void;
}) {
  return (
    <ul data-import-list className="flex max-h-[360px] flex-col overflow-y-auto border-t border-muted">
      {rows.map(({ candidate, key, onBoard }) => (
        <li key={key} className="border-b border-muted">
          <label className={cn("flex min-h-11 items-center gap-2.5 text-ui md:min-h-10", onBoard && "text-muted-foreground")}>
            <input
              type="checkbox"
              checked={!onBoard && !unchecked.has(key)}
              disabled={onBoard || disabled}
              onChange={(event) => onToggle(key, event.target.checked)}
              className="size-4 shrink-0 accent-foreground"
            />
            {onBoard ? (
              <>
                <span className="min-w-0 flex-1 break-words">{candidate.artist ? `${candidate.title} · ${candidate.artist}` : candidate.title}</span>
                <span className="shrink-0 text-xs">보드에 있음</span>
              </>
            ) : (
              <span className="min-w-0 flex-1 break-words">
                <span className="font-medium text-foreground">{candidate.title}</span>
                {candidate.artist ? <>{" "}<span className="text-muted-foreground">· {candidate.artist}</span></> : null}
              </span>
            )}
          </label>
        </li>
      ))}
    </ul>
  );
}
