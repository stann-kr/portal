import { createDbContext } from "@/db/client";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { handleGuideAssetUpload } from "@/lib/guide-asset-handlers";
import { getGuideAssetStorage } from "@/lib/r2";

/** 관리자가 가이드 본문에 넣을 이미지를 올린다. body는 이미지 bytes 그대로다. */
export async function POST(request: Request): Promise<Response> {
  return handleGuideAssetUpload(request, {
    getSession: getActiveAuthSession,
    getContext: createDbContext,
    getStorage: getGuideAssetStorage,
  });
}
