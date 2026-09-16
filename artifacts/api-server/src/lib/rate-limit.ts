interface Bucket {
  count: number;
  resetAt: number;
}

// Per-process in-memory fixed-window counters. The app is deployed as a single
// instance (see replit.md "Deployment topology"), so a module-level map is a
// correct place to track per-IP / per-identifier request counts.
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

/**
 * Records a hit against `key` and reports whether the caller has exceeded `max`
 * hits within the rolling `windowMs`. The first call after a window expires
 * starts a fresh window.
 */
export function rateLimitHit(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > max) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

/**
 * Reports whether `key` is currently at or over `max` hits within its active
 * window WITHOUT recording a hit. Use this to gate a request up-front (e.g. only
 * count failed logins via {@link rateLimitHit}, but block further attempts here
 * so a successful login never increments the counter).
 */
export function rateLimitPeek(key: string, max: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

/** Clears all counters. Intended for tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
