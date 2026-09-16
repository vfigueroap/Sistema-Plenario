type OriginEnvironment = {
  NODE_ENV?: string;
  ALLOWED_ORIGINS?: string;
  APP_URL?: string;
};

/** Extract an HTTP(S) origin from a public URL or Referer, never request Host. */
export function httpUrlOrigin(value: string | undefined): string | undefined {
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || /[@*]/.test(authority)) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function normalizedOrigin(value: string | undefined): string | undefined {
  // Origins have no path, query or fragment. A root slash is harmless in env.
  if (!value || !/^https?:\/\/[^/?#]+\/?$/i.test(value)) return undefined;
  return httpUrlOrigin(value);
}

/**
 * ALLOWED_ORIGINS: comma-separated exact HTTP(S) origins (no wildcards).
 * APP_URL: explicit public application URL, including a Vercel preview.
 * Configure the legitimate same-origin URL here too: Host/Forwarded headers
 * cannot establish trust when the backend is directly reachable.
 * Invalid configuration fails at startup; an empty production policy denies all.
 * Pure predicate, suitable for reuse by Socket.IO's origin/handshake checks.
 */
export function createAllowedOrigin(env: OriginEnvironment): (origin: string | undefined) => boolean {
  const allowed = new Set<string>();
  for (const entry of (env.ALLOWED_ORIGINS ?? "").split(",")) {
    if (!entry.trim()) continue;
    const origin = normalizedOrigin(entry.trim());
    if (!origin) throw new Error("ALLOWED_ORIGINS must contain explicit HTTP(S) origins");
    allowed.add(origin);
  }
  if (env.APP_URL?.trim()) {
    const origin = httpUrlOrigin(env.APP_URL.trim());
    if (!origin) throw new Error("APP_URL must be an explicit HTTP(S) URL");
    allowed.add(origin);
  }

  const isProduction = env.NODE_ENV === "production";
  return (value) => {
    const origin = normalizedOrigin(value);
    if (!origin) return false;
    const hostname = new URL(origin).hostname;
    const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    if (isLoopback) return !isProduction;
    return allowed.has(origin);
  };
}
