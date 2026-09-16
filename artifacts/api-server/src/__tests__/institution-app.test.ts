import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, institutionsTable, usersTable } from "@workspace/db";

const institutionId = "00000000-0000-4000-8000-000000000001";
const otherInstitutionId = crypto.randomUUID();
const username = `tenant-login-${crypto.randomUUID()}`;
let firstUserId: number;
let secondUserId: number;
process.env.INSTITUTION_ID = institutionId;
process.env.SESSION_SECRET = "institution-test-secret";
const app = (await import("../app")).default;

beforeAll(async () => {
  const password = await bcrypt.hash("correct-password", 4);
  await db.insert(institutionsTable).values({ id: otherInstitutionId, slug: `other-${otherInstitutionId}`, name: "Other" });
  firstUserId = (await db.insert(usersTable).values({ institutionId, username, displayName: "Visible", password }).returning())[0].id;
  secondUserId = (await db.insert(usersTable).values({ institutionId: otherInstitutionId, username, displayName: "Hidden", password }).returning())[0].id;
});

afterAll(async () => {
  await db.delete(usersTable).where(sql`${usersTable.id} in (${firstUserId}, ${secondUserId})`);
  await db.delete(institutionsTable).where(eq(institutionsTable.id, otherInstitutionId));
});

describe("application institution boundary", () => {
  it("authenticates only the configured institution when usernames match", async () => {
    const response = await request(app).post("/api/auth/login")
      .set("Origin", "http://localhost:3000")
      .send({ username, password: "correct-password" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: firstUserId, displayName: "Visible" });
    expect(response.body.id).not.toBe(secondUserId);
  });
});
