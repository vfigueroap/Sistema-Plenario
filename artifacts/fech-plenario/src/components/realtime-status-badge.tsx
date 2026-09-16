import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import { cn } from "@/lib/utils";

const CONFIG = {
  polling: {
    label: "Actualización periódica",
    dot: "bg-sky-400",
    pulse: false,
    title: "Se consultan los datos cada 3–4 segundos mientras esta pestaña está visible",
  },
  connected: {
    label: "En vivo",
    dot: "bg-lime-400",
    pulse: false,
    title: "Actualizaciones en tiempo real activas",
  },
  reconnecting: {
    label: "Reconectando…",
    dot: "bg-yellow-400",
    pulse: true,
    title: "Conexión en vivo interrumpida; reintentando. Mientras tanto se actualiza más lento.",
  },
  disconnected: {
    label: "Sin conexión en vivo",
    dot: "bg-red-500",
    pulse: false,
    title: "No se pudo restablecer la conexión en vivo. Los datos se actualizan más lento.",
  },
} as const;

export function RealtimeStatusBadge({ className }: { className?: string }) {
  const status = useRealtimeStatus();
  const config = CONFIG[status];

  return (
    <span
      role="status"
      aria-live="polite"
      title={config.title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium",
        className,
      )}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        {config.pulse && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
              config.dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", config.dot)} />
      </span>
      {config.label}
    </span>
  );
}
