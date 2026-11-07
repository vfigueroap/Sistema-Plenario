import { describe, expect, it, vi } from "vitest";

const { compare } = vi.hoisted(() => ({ compare: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { compare } }));
import { checkPassword } from "../lib/password-check";

describe("verificación de claves bajo ráfaga", () => {
  it("limita el trabajo simultáneo y libera el turno aunque una verificación falle", async () => {
    let active = 0;
    let peak = 0;
    compare.mockImplementation(async (password: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      if (password === "error") throw new Error("fallo simulado");
      return password === "correcta";
    });
    const results = await Promise.allSettled(
      Array.from({ length: 110 }, (_, i) =>
        checkPassword(i === 5 ? "error" : "correcta", "hash ficticio"),
      ),
    );
    expect(peak).toBe(2);
    expect(
      results.filter((r) => r.status === "fulfilled" && r.value),
    ).toHaveLength(109);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await checkPassword("incorrecta", "hash ficticio")).toBe(false);
    expect(active).toBe(0);
  });
});
