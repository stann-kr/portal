"use client";

import { useCallback, useRef, useState } from "react";
import {
  abandonMediaUpload,
  completeMediaUploadAction,
  requestMediaUpload,
} from "@/lib/actions/upload";
import { createCreationOperationId } from "@/lib/creation-operation";
import {
  DOCUMENT_IMAGE_MAX_BYTES,
  DOCUMENT_IMAGE_MIME_TYPES,
  mediaUploadRequestHeaders,
} from "@/lib/media-lifecycle";

export const EDITOR_IMAGE_ACCEPT = DOCUMENT_IMAGE_MIME_TYPES.join(",");

export type EditorImageUploadState = {
  pendingCount: number;
  error: string | null;
};

export function isEditorImageFile(file: File): boolean {
  return (DOCUMENT_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
}

/** 업로드 전에 사용자에게 바로 알려 줄 수 있는 형식·크기 문제를 찾는다. */
export function editorImageFileError(file: File): string | null {
  if (!isEditorImageFile(file)) {
    return "JPG, PNG, GIF, WebP 이미지만 넣을 수 있습니다.";
  }
  if (file.size <= 0) return "빈 파일은 넣을 수 없습니다.";
  if (file.size > DOCUMENT_IMAGE_MAX_BYTES) {
    return "이미지는 한 장에 10MB까지 넣을 수 있습니다.";
  }
  return null;
}

async function uploadOne(file: File, draftOperationId: string): Promise<string> {
  const requested = await requestMediaUpload({
    purpose: "DOCUMENT_IMAGE",
    fileName: file.name || "image",
    mimeType: file.type,
    fileSize: file.size,
    draftOperationId,
  });
  if (!requested.success) throw new Error(requested.error);

  let response: Response;
  try {
    response = await fetch(requested.uploadUrl, {
      method: "PUT",
      headers: mediaUploadRequestHeaders(requested.uploadContentType),
      body: file,
      credentials: "same-origin",
    });
  } catch {
    await abandonMediaUpload(requested.mediaObjectId).catch(() => undefined);
    throw new Error("네트워크 문제로 이미지를 올리지 못했습니다.");
  }
  if (!response.ok) {
    await abandonMediaUpload(requested.mediaObjectId).catch(() => undefined);
    throw new Error(
      response.status === 415
        ? "이미지 파일 내용이 형식과 맞지 않습니다."
        : "이미지를 올리지 못했습니다.",
    );
  }

  const completed = await completeMediaUploadAction(requested.mediaObjectId);
  if (!completed.success) throw new Error(completed.error);
  return completed.deliveryUrl;
}

/**
 * 편집기 본문 이미지 업로드를 맡는다. 편집기 하나가 한 draft 작업 ID를 쓰고,
 * 업로드가 끝난 이미지만 본문에 넣는다. 문서 저장 때 서버가 이미지를 문서에 연결한다.
 */
export function useEditorImageUpload(
  onUploaded: (deliveryUrl: string, file: File) => void,
) {
  const [state, setState] = useState<EditorImageUploadState>({
    pendingCount: 0,
    error: null,
  });
  const draftOperationIdRef = useRef<string | null>(null);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const uploadImages = useCallback((files: readonly File[]) => {
    const images = files.filter(isEditorImageFile);
    const firstError = files.map(editorImageFileError).find(Boolean) ?? null;
    const valid = images.filter((file) => editorImageFileError(file) === null);
    setState((current) => ({
      pendingCount: current.pendingCount + valid.length,
      error: firstError,
    }));
    if (valid.length === 0) return;
    draftOperationIdRef.current ??= createCreationOperationId();
    const draftOperationId = draftOperationIdRef.current;

    // 끝난 순서가 아니라 고른 순서대로 본문에 들어가도록 차례로 올린다.
    void (async () => {
      for (const file of valid) {
        try {
          const deliveryUrl = await uploadOne(file, draftOperationId);
          onUploadedRef.current(deliveryUrl, file);
          setState((current) => ({ ...current, pendingCount: current.pendingCount - 1 }));
        } catch (error) {
          setState((current) => ({
            pendingCount: current.pendingCount - 1,
            error: error instanceof Error ? error.message : "이미지를 올리지 못했습니다.",
          }));
        }
      }
    })();
  }, []);

  const clearError = useCallback(() => {
    setState((current) => ({ ...current, error: null }));
  }, []);

  return { ...state, uploadImages, clearError };
}
