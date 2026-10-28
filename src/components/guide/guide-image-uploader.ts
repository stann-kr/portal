import type { EditorImageUploader } from "@/components/editor/useEditorImageUpload";

/**
 * 가이드 편집기의 본문 이미지 업로드. 학생 문서 이미지(media_objects)와 달리 공용 가이드 이미지 저장소로 올린다.
 * 본문에 넣지 않은 업로드는 어느 페이지에도 연결되지 않은 채 남는다(저장 때 본문이 가리키는 이미지만 페이지에 연결).
 */
export const GUIDE_IMAGE_UPLOADER: EditorImageUploader = {
  async upload(file) {
    let response: Response;
    try {
      response = await fetch("/api/guide-assets", {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
        credentials: "same-origin",
      });
    } catch {
      throw new Error("네트워크 문제로 이미지를 올리지 못했습니다.");
    }
    if (!response.ok) {
      throw new Error(
        response.status === 415
          ? "이미지 파일 내용이 형식과 맞지 않습니다."
          : response.status === 413
            ? "이미지는 한 장에 10MB까지 넣을 수 있습니다."
            : response.status === 401 || response.status === 403
              ? "가이드 이미지는 관리자만 올릴 수 있습니다."
              : "이미지를 올리지 못했습니다.",
      );
    }
    const body = (await response.json().catch(() => null)) as { id?: unknown; url?: unknown } | null;
    if (typeof body?.id !== "string" || typeof body.url !== "string") {
      throw new Error("이미지 업로드 결과를 확인하지 못했습니다.");
    }
    return { deliveryUrl: body.url, mediaObjectId: body.id };
  },
  abandon() {
    // 연결되지 않은 가이드 이미지는 공용 자료라 바로 지우지 않는다.
  },
};
