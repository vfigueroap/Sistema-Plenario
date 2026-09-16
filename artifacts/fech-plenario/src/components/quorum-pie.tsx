// Gráfico de torta del quórum.
//
// Muestra la ponderación presente contra la ausente, y marca sobre la propia
// torta dónde cae el mínimo reglamentario. Lo que importa de un vistazo no es
// el porcentaje exacto sino si se cruzó ese umbral, así que la marca del
// mínimo es parte del dibujo y no una nota al pie.

interface Props {
  presente: number;
  total: number;
  /** Fracción de la ponderación total exigida para sesionar. Ej: 0.5 */
  minimo: number;
  /** Lado del gráfico en píxeles. */
  size?: number;
  /** Tipografía y detalles ampliados, para proyectar. */
  grande?: boolean;
}

const VERDE = "#4D7C0F";
const ROJO = "#B91C1C";
const GRIS = "#E5E7EB";
const BORDE = "#9CA3AF";

// Punto sobre la circunferencia. El ángulo parte arriba y avanza en el sentido
// del reloj, que es como se lee un gráfico de torta.
function punto(cx: number, cy: number, r: number, fraccion: number) {
  const ang = fraccion * 2 * Math.PI - Math.PI / 2;
  return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) };
}

function sector(cx: number, cy: number, r: number, desde: number, hasta: number) {
  // Una fracción completa no se puede dibujar con un solo arco: se cierra
  // como círculo entero.
  if (hasta - desde >= 0.9999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const a = punto(cx, cy, r, desde);
  const b = punto(cx, cy, r, hasta);
  const mayor = hasta - desde > 0.5 ? 1 : 0;
  return `M ${cx} ${cy} L ${a.x} ${a.y} A ${r} ${r} 0 ${mayor} 1 ${b.x} ${b.y} Z`;
}

export function QuorumPie({ presente, total, minimo, size = 200, grande = false }: Props) {
  const fraccion = total > 0 ? Math.min(presente / total, 1) : 0;
  const pct = fraccion * 100;
  const hayQuorum = total > 0 && presente >= total * minimo;
  const color = hayQuorum ? VERDE : ROJO;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - (grande ? 14 : 10);

  // Extremos de la línea que marca el umbral, cruzando el centro.
  const umbral = punto(cx, cy, r + (grande ? 12 : 8), minimo);

  return (
    <figure className="m-0 flex flex-col items-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Quórum: ${pct.toFixed(1)} por ciento de la ponderación presente. ${
          hayQuorum ? "Alcanza" : "No alcanza"} el mínimo de ${(minimo * 100).toFixed(0)} por ciento.`}
      >
        {/* Ausente */}
        <circle cx={cx} cy={cy} r={r} fill={GRIS} stroke={BORDE} strokeWidth="1" />
        {/* Presente */}
        {fraccion > 0 && (
          <path d={sector(cx, cy, r, 0, fraccion)} fill={color} stroke="#FFFFFF" strokeWidth="1.5" />
        )}

        {/* Umbral reglamentario, sobre la torta */}
        <line
          x1={cx} y1={cy} x2={umbral.x} y2={umbral.y}
          stroke="#111827" strokeWidth={grande ? 3 : 2} strokeDasharray={grande ? "7 5" : "5 4"}
        />
        <circle cx={umbral.x} cy={umbral.y} r={grande ? 5 : 3.5} fill="#111827" />

        {/* Centro con la cifra */}
        <circle cx={cx} cy={cy} r={r * 0.52} fill="#FFFFFF" stroke={BORDE} strokeWidth="1" />
        <text
          x={cx} y={cy - (grande ? 4 : 2)} textAnchor="middle"
          fontSize={size * (grande ? 0.16 : 0.19)} fontWeight="800" fill={color}
          fontFamily="ui-sans-serif, system-ui"
        >
          {pct.toFixed(0)}%
        </text>
        <text
          x={cx} y={cy + size * (grande ? 0.075 : 0.085)} textAnchor="middle"
          fontSize={size * (grande ? 0.052 : 0.062)} fill="#6B7280"
          fontFamily="ui-sans-serif, system-ui"
        >
          {presente.toFixed(2)} / {total.toFixed(2)}
        </text>
      </svg>

      <figcaption className="mt-3 w-full">
        <div
          className={`border-2 px-3 py-2 text-center ${
            hayQuorum ? "border-lime-700 bg-lime-50" : "border-red-700 bg-red-50"}`}
        >
          <div
            className={`font-bold ${grande ? "text-2xl" : "text-sm"} ${
              hayQuorum ? "text-lime-800" : "text-red-800"}`}
          >
            {hayQuorum ? "QUÓRUM ALCANZADO" : "SIN QUÓRUM"}
          </div>
          <div className={`text-muted-foreground ${grande ? "mt-1 text-base" : "text-[11px]"}`}>
            Mínimo {(minimo * 100).toFixed(0)}% = {(total * minimo).toFixed(2)} de ponderación
          </div>
        </div>

        <div className={`mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 ${grande ? "text-base" : "text-[11px]"}`}>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0" style={{ background: color }} />
            Presente
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 shrink-0" style={{ background: GRIS, border: `1px solid ${BORDE}` }} />
            Ausente
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 shrink-0 bg-gray-900" />
            Mínimo
          </span>
        </div>
      </figcaption>
    </figure>
  );
}
