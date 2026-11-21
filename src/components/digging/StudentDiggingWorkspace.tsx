/**
 * @file src/components/digging/StudentDiggingWorkspace.tsx
 * @description 학생 본인 디깅 화면의 플레이리스트와 트랙 보드. 트랙 목록을 한 곳에서 들어,
 * 플레이리스트 "트랙 가져오기"가 보드에 있는 곡을 알고 넣은 곡을 바로 보드 오늘 묶음에 보인다.
 * Stann이 보는 학생 상세는 이 묶음을 쓰지 않는다(트랙 보드는 학생 본인만 바꾼다).
 */
"use client";

import { useCallback, useMemo, useState, type ComponentProps } from "react";
import { DiggingBoard, type DiggingBoardTrack } from "@/components/digging/DiggingBoard";
import { PlaylistSection } from "@/components/digging/PlaylistSection";
import type { DiggingTrackImportBoard, ImportedDiggingTrack } from "@/components/digging/PlaylistTrackImport";

type BoardProps = Omit<ComponentProps<typeof DiggingBoard>, "tracksState" | "readonly">;

export function StudentDiggingWorkspace({
  studentId,
  playlists,
  board,
}: {
  studentId: string;
  playlists: ComponentProps<typeof PlaylistSection>["initialPlaylists"];
  board: BoardProps;
}) {
  const tracksState = useState<DiggingBoardTrack[]>(board.initialTracks);
  const [tracks, setTracks] = tracksState;
  const onImported = useCallback((created: ImportedDiggingTrack[]) => {
    // 보드 맨 위(오늘 묶음)에 고른 순서대로 놓는다.
    setTracks((current) => [...created, ...current]);
  }, [setTracks]);
  const trackImport = useMemo<DiggingTrackImportBoard>(
    () => ({ columns: board.initialColumns, tracks, onImported }),
    [board.initialColumns, tracks, onImported],
  );

  return (
    <>
      <PlaylistSection studentId={studentId} initialPlaylists={playlists} trackImport={trackImport} />
      <DiggingBoard {...board} tracksState={tracksState} />
    </>
  );
}
