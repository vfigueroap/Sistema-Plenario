import { describe, expect, it } from "vitest";
import { campusDe, ordenCampus, SIN_CAMPUS, unidadDe } from "./campus";

describe("campusDe", () => {
  it("prefiere el campus registrado del integrante", () => {
    expect(campusDe({ campus: "Sur", faculty: "FEN" })).toBe("Sur");
  });

  it("ignora un campus vacío o con solo espacios", () => {
    expect(campusDe({ campus: "   ", faculty: "FEN" })).toBe("Andrés Bello");
  });

  it("deduce el campus de la unidad de una consejería", () => {
    expect(campusDe({ campus: null, faculty: "FAGRO" })).toBe("Sur");
    expect(campusDe({ faculty: "Derecho" })).toBe("Centro");
  });

  it("relaciona un centro de estudiantes con el campus de su unidad", () => {
    expect(unidadDe("CEIA")).toBe("FAGRO");
    expect(campusDe({ campus: null, faculty: "CEIA" })).toBe("Sur");
    expect(campusDe({ campus: null, faculty: "CEO" })).toBe("Norte");
  });

  it("no inventa campus para lo que no conoce", () => {
    expect(campusDe({ campus: null, faculty: "CEET" })).toBe(SIN_CAMPUS);
    expect(campusDe({})).toBe(SIN_CAMPUS);
  });
});

describe("ordenCampus", () => {
  it("ordena los campus conocidos y deja los demás al final", () => {
    expect(ordenCampus("Juan Gómez Millas")).toBeLessThan(ordenCampus("Sur"));
    expect(ordenCampus(SIN_CAMPUS)).toBeGreaterThan(ordenCampus("Centro"));
  });
});
