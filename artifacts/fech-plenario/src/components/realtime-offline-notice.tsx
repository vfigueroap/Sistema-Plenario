import { useEffect, useRef, useState } from "react";
import { WifiOff, X } from "lucide-react";
import { useRealtimeStatus } from "@/hooks/use-realtime-status";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const OFFLINE_THRESHOLD_MS = 10_000;
const RECONNECTED_TOAST_MS = 4_000;

/**
 * Prominent, dismissible notice that appears when the realtime connection has
 * stayed down (reconnecting/disconnected) beyond a short threshold.
 *
 * The small header badge is easy to miss during an active plenary, so this
 * surfaces a banner once the socket has been offline for a while. The app keeps
 * working via React Query polling underneath — this only warns that live data
 * may be stale. It clears automatically when the connection returns to "live".
 */
export function RealtimeOfflineNotice() {
  const status = useRealtimeStatus();
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineNoticeShownRef = useRef(false);

  useEffect(() => {
    // Polling is an intentional transport, not a failed socket connection.
    if (status === "polling") return;
    if (status === "connected") {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (offlineNoticeShownRef.current) {
        offlineNoticeShownRef.current = false;
        toast({
          title: "Conexión en vivo restablecida",
          description: "Los datos vuelven a actualizarse en tiempo real.",
          duration: RECONNECTED_TOAST_MS,
        });
      }
      setShowBanner(false);
      setDismissed(false);
      return;
    }

    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      offlineNoticeShownRef.current = true;
      setShowBanner(true);
      timerRef.current = null;
    }, OFFLINE_THRESHOLD_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status]);

  if (!showBanner || dismissed) return null;

  const message =
    status === "disconnected"
      ? "No se pudo restablecer la conexión en vivo. Los datos pueden estar desactualizados; se siguen actualizando más lento."
      : "La conexión en vivo lleva un rato interrumpida. Los datos pueden estar desactualizados mientras se reintenta reconectar.";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "border-b border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      <div className="container mx-auto flex items-start gap-3 px-4 py-2.5 text-sm">
        <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="flex-1">
          <span className="font-medium">Actualizaciones en vivo interrumpidas. </span>
          <span>{message}</span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Descartar aviso"
          className="-mr-1 shrink-0 rounded-md p-1 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
