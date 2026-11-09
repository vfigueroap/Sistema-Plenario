import { describe, expect, it } from "vitest";
import bcryptjs from "bcryptjs";
import { checkPassword } from "../lib/password-check";

describe("compatibilidad de claves existentes", () => {
  it.each(["Clave-ficticia-123", "contraseña-áéíóú-🔑", "a".repeat(80)])("valida el hash anterior sin reducir su costo", async (password) => {
    const hash = await bcryptjs.hash(password, 10);
    expect(await checkPassword(password, hash)).toBe(true);
    expect(await checkPassword(`incorrecta-${password}`, hash)).toBe(false);
    expect(bcryptjs.getRounds(hash)).toBe(10);
    expect(await checkPassword(password, hash.replace("$2b$", "$2a$"))).toBe(true);
  });
});
