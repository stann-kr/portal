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

/**
 * 붙여넣기에서 올릴 이미지 파일을 고른다. 표·문서 복사처럼 글(HTML·텍스트)이 함께 오면
 * 미리보기 그림 대신 글을 붙여야 하므로 null을 돌려 기본 붙여넣기에 맡긴다.
 */
export function pastedEditorImageFiles(clipboard: {
  types: readonly string[];
  files: ArrayLike<File>;
} | null): File[] | null {
  if (!clipboard) return null;
  if (clipboard.types.includes("text/html") || clipboard.types.includes("text/plain")) return null;
  const files = Array.from(clipboard.files);
  return files.some(isEditorImageFile) ? files : null;
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

export type EditorUploadedImage = {
  deliveryUrl: string;
  mediaObjectId: string;
  file: File;
};

/** 본문에 넣지 않을 업로드를 서버 삭제 대기열에 넘긴다. 실패해도 만료 정리가 뒤따른다. */
export function abandonEditorImage(mediaObjectId: string): void {
  void abandonMediaUpload(mediaObjectId).catch(() => undefined);
}

async function uploadOne(
  file: File,
  draftOperationId: string,
): Promise<{ deliveryUrl: string; mediaObjectId: string }> {
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
    abandonEditorImage(requested.mediaObjectId);
    throw new Error("네트워크 문제로 이미지를 올리지 못했습니다.");
  }
  if (!response.ok) {
    abandonEditorImage(requested.mediaObjectId);
    throw new Error(
      response.status === 415
        ? "이미지 파일 내용이 형식과 맞지 않습니다."
        : "이미지를 올리지 못했습니다.",
    );
  }

  let completed: Awaited<ReturnType<typeof completeMediaUploadAction>>;
  try {
    completed = await completeMediaUploadAction(requested.mediaObjectId);
  } catch {
    abandonEditorImage(requested.mediaObjectId);
    throw new Error("이미지 업로드 완료를 확인하지 못했습니다.");
  }
  if (!completed.success) {
    abandonEditorImage(requested.mediaObjectId);
    throw new Error(completed.error);
  }
  return { deliveryUrl: completed.deliveryUrl, mediaObjectId: requested.mediaObjectId };
}

/**
 * 본문 이미지를 어디에 올릴지 정한다. 기본은 학생 문서 이미지(media_objects) 흐름이고,
 * 공용 가이드처럼 다른 저장 경로를 쓰는 편집기는 자기 uploader를 넘긴다.
 */
export type EditorImageUploader = {
  upload: (file: File, draftOperationId: string) => Promise<{ deliveryUrl: string; mediaObjectId: string }>;
  /** 본문에 넣지 않기로 한 업로드를 정리한다. */
  abandon: (uploadId: string) => void;
};

export const DOCUMENT_IMAGE_UPLOADER: EditorImageUploader = {
  upload: uploadOne,
  abandon: abandonEditorImage,
};

/**
 * 편집기 본문 이미지 업로드를 맡는다. 편집기 하나가 한 draft 작업 ID를 쓰고,
 * 업로드가 끝난 이미지만 넘긴다. 넣을지·미룰지·버릴지는 편집기가 `context`로 판단한다.
 * 문서 저장 때 서버가 이미지를 문서에 연결한다.
 */
export function useEditorImageUpload<Context>(
  onUploaded: (upload: EditorUploadedImage, context: Context) => void,
  uploader: EditorImageUploader = DOCUMENT_IMAGE_UPLOADER,
) {
  const [state, setState] = useState<EditorImageUploadState>({
    pendingCount: 0,
    error: null,
  });
  const draftOperationIdRef = useRef<string | null>(null);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;
  const uploaderRef = useRef(uploader);
  uploaderRef.current = uploader;

  const uploadImages = useCallback((files: readonly File[], context: Context) => {
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
          const uploaded = await uploaderRef.current.upload(file, draftOperationId);
          onUploadedRef.current({ ...uploaded, file }, context);
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
