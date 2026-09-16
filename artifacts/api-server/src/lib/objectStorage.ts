import { randomUUID } from "node:crypto";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
  }
}

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "plenario-actas";
  const institutionId = process.env.INSTITUTION_ID;
  if (!url || !key || !institutionId) throw new Error("Supabase Storage is not configured");
  return { url, key, bucket, institutionId };
}

function objectId(path: string): string {
  const match = /^\/objects\/([0-9a-f-]{36})$/i.exec(path);
  if (!match || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(match[1])) {
    throw new ObjectNotFoundError();
  }
  return match[1];
}

export class ObjectStorageService {
  createUploadTarget(): { uploadURL: string; objectPath: string } {
    const id = randomUUID();
    return { uploadURL: `/api/storage/uploads/${id}`, objectPath: `/objects/${id}` };
  }

  async upload(id: string, body: Uint8Array): Promise<void> {
    const { url, key, bucket, institutionId } = configuration();
    objectId(`/objects/${id}`);
    const response = await fetch(`${url}/storage/v1/object/${bucket}/${institutionId}/${id}.pdf`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/pdf", "x-upsert": "false" },
      body,
    });
    if (!response.ok) throw new Error(`Storage upload failed (${response.status})`);
  }

  async getObjectEntityFile(path: string): Promise<string> {
    return objectId(path);
  }

  async downloadObject(id: string): Promise<Response> {
    const { url, key, bucket, institutionId } = configuration();
    const response = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${institutionId}/${id}.pdf`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (response.status === 404) throw new ObjectNotFoundError();
    if (!response.ok) throw new Error(`Storage download failed (${response.status})`);
    return response;
  }
}
