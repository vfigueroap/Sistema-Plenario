import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

describe("Supabase object storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses an institution-prefixed private path without exposing the service key", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "server-only-key");
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "acts");
    vi.stubEnv("INSTITUTION_ID", "00000000-0000-4000-8000-000000000001");
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new ObjectStorageService();
    const target = service.createUploadTarget();
    expect(target.uploadURL).toMatch(/^\/api\/storage\/uploads\/[0-9a-f-]{36}$/);
    expect(target.objectPath).toMatch(/^\/objects\/[0-9a-f-]{36}$/);
    expect(JSON.stringify(target)).not.toContain("server-only-key");
    await service.upload(target.objectPath.slice(9), new Uint8Array([1, 2]));
    const requestUrl = String((fetchMock.mock.calls as unknown[][])[0][0]);
    expect(requestUrl).toContain("/acts/00000000-0000-4000-8000-000000000001/");
  });

  it("rejects arbitrary object paths before fetching", async () => {
    await expect(new ObjectStorageService().getObjectEntityFile("/objects/../../other"))
      .rejects.toBeInstanceOf(ObjectNotFoundError);
  });
});
