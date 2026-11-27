"use client";

import { useEffect } from "react";
import { recordNoteView } from "@/lib/actions/noteViews";

/**
 * 학생이 노트를 연 때를 남긴다(관리자만 보는 "학생 열람", 0044). 화면에는 아무것도 그리지 않는다.
 * 미리 받기(prefetch)로는 남지 않도록 실제로 그려진 뒤에만 부른다. 실패해도 노트 보기는 그대로다.
 */
export function NoteViewRecorder({ noteId }: { noteId: string }) {
  useEffect(() => {
    recordNoteView(noteId).catch(() => undefined);
  }, [noteId]);
  return null;
}
