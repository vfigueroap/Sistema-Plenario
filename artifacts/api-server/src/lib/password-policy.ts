const MIN_LENGTH = 8;
const MAX_BYTES = 72;
const COMMON = new Set([
  "12345", "123456", "1234567", "12345678", "123456789", "1234567890",
  "password", "contraseña", "qwerty", "qwertyui", "abcd1234", "admin1234", "fech1234", "plenario",
]);

export function validatePassword(value: unknown, current?: string): string | null {
  if (typeof value !== "string") return "La contraseña debe ser un texto";
  if (value.length < MIN_LENGTH) return `La contraseña debe tener al menos ${MIN_LENGTH} caracteres`;
  if (Buffer.byteLength(value, "utf8") > MAX_BYTES) return `La contraseña no puede superar ${MAX_BYTES} bytes`;
  if (COMMON.has(value.toLowerCase())) return "Esa contraseña es demasiado común";
  if (/^(.)\1+$/.test(value)) return "La contraseña no puede repetir un mismo carácter";
  if (current !== undefined && value === current) return "La nueva contraseña debe ser distinta de la actual";
  return null;
}
