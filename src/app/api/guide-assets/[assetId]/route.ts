import { createDbContext } from "@/db/client";
import { getActiveAuthSession } from "@/lib/auth-guard";
import { handleGuideAssetGet } from "@/lib/guide-asset-handlers";
import { getGuideAssetStorage } from "@/lib/r2";

/** 가이드 이미지는 로그인한 활성 사용자 누구나 본다(공용 자료). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
): Promise<Response> {
  return handleGuideAssetGet((await params).assetId, {
    getSession: getActiveAuthSession,
    getContext: createDbContext,
    getStorage: getGuideAssetStorage,
  });
}
