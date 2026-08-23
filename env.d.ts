declare global {
  interface Env {
    DB: D1Database;
    BUCKET: R2Bucket;
    ACCOUNT_CLEANUP_RATE_LIMITER: RateLimit;
  }
}

export {};
