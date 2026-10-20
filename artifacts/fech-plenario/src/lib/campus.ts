// Campus de la Universidad y su relación con las unidades de cada integrante.
//
// El campus se registra por integrante (campo opcional «campus»). Sirve para que
// las consejerías y los centros de estudiantes de un mismo campus aparezcan
// relacionados en el portal.
//
// Si un integrante no tiene campus registrado, se deduce con estas tablas de
// respaldo. Lo que no aparezca aquí se agrupa bajo «Otras unidades», sin
// inventarle un campus: conviene registrarlo desde «Integrantes».

export const CAMPUS_OPCIONES = [
  "Juan Gómez Millas",
  "Andrés Bello",
  "Beauchef",
  "Norte",
  "Sur",
  "Centro",
] as const;

export const SIN_CAMPUS = "Otras unidades";

// Campus de cada unidad (la «facultad» de las consejerías).
const CAMPUS_POR_UNIDAD: Record<string, string> = {
  // Juan Gómez Millas
  FACSO: "Juan Gómez Millas",
  FYHH: "Juan Gómez Millas",
  FACIEN: "Juan Gómez Millas",
  FCEI: "Juan Gómez Millas",
  "F. Artes": "Juan Gómez Millas",
  // Andrés Bello
  FEN: "Andrés Bello",
  FAU: "Andrés Bello",
  FAGOB: "Andrés Bello",
  // Beauchef
  FCFM: "Beauchef",
  // Campus Norte
  FACMED: "Norte",
  FaO: "Norte",
  FaCQyF: "Norte",
  // Campus Sur
  FAGRO: "Sur",
  FAVET: "Sur",
  FCFCN: "Sur",
  // Centro
  Derecho: "Centro",
  "Artes Centro": "Centro",
};

// A qué unidad pertenece cada Centro de Estudiantes. Solo figuran los que se
// pudieron identificar con seguridad; los demás se completan registrando el
// campus del integrante.
const UNIDAD_DEL_CENTRO: Record<string, string> = {
  CEIA: "FAGRO",
  CEIREN: "FAGRO",
  CEIF: "FCFCN",
  VETERA: "FAVET",
  CEO: "FaO",
  CEFaQ: "FaCQyF",
  CES: "FACMED",
  CEI: "FCFM",
  CEG: "FAGOB",
  CEDIS: "FAU",
  CEIIA: "FEN",
  CEIC: "FEN",
  CECIP: "FACSO",
  CECSO: "FACSO",
  CED: "Derecho",
  CEFH: "FYHH",
  CEC: "FACIEN",
  CECO: "FCEI",
};

// Unidad a la que se asocia un integrante: la suya, o la de su centro.
export const unidadDe = (faculty: string | null | undefined): string | null =>
  faculty ? (UNIDAD_DEL_CENTRO[faculty] ?? faculty) : null;

type ConCampus = { campus?: string | null; faculty?: string | null };

// Campus de un integrante: el registrado, o el deducido de su unidad.
export const campusDe = (m: ConCampus): string => {
  const registrado = m.campus?.trim();
  if (registrado) return registrado;
  const unidad = unidadDe(m.faculty);
  return (unidad && CAMPUS_POR_UNIDAD[unidad]) || SIN_CAMPUS;
};

// Orden de presentación de los campus. Los no listados van al final.
export const ordenCampus = (c: string): number => {
  const i = (CAMPUS_OPCIONES as readonly string[]).indexOf(c);
  return i === -1 ? CAMPUS_OPCIONES.length : i;
};
