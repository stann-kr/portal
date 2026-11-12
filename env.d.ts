declare global {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ACCOUNT_CLEANUP_RATE_LIMITER: RateLimit;
    /** 가입 링크 메일. 로컬 Node·테스트에는 없다. */
    EMAIL?: { send(message: unknown): Promise<unknown> };
  }
}

export {};
