import { useEffect, useId, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const GENERIC_ERROR =
  "No se pudo acceder a la cámara. Revisa los permisos del navegador o ingresa el código manualmente.";
const NO_CAMERA_ERROR = "Tu navegador no permite usar la cámara. Ingresa el código manualmente.";

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

export function QrScannerDialog({
  open,
  onOpenChange,
  onResult,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (text: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const containerId = `qr-reader-${useId().replace(/:/g, "")}`;

  // Reset state whenever the dialog closes.
  useEffect(() => {
    if (!open) {
      setScannedCode(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || scannedCode) return;
    setError(null);
    setStarting(true);

    let active = true;
    let scanner: Html5Qrcode | null = null;

    const stop = async () => {
      if (!scanner) return;
      try {
        const { Html5QrcodeScannerState } = await import("html5-qrcode");
        const state = scanner.getState();
        if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
          await scanner.stop();
        }
      } catch {
        /* ignore */
      }
      try {
        scanner.clear();
      } catch {
        /* ignore */
      }
    };

    (async () => {
      try {
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          if (active) setError(NO_CAMERA_ERROR);
          return;
        }

        await nextFrame();
        if (!active) return;
        if (!document.getElementById(containerId)) {
          await nextFrame();
        }
        if (!active) return;
        if (!document.getElementById(containerId)) {
          setError(GENERIC_ERROR);
          return;
        }

        const { Html5Qrcode } = await import("html5-qrcode");
        if (!active) return;

        scanner = new Html5Qrcode(containerId);
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
              const size = Math.max(150, Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.75));
              return { width: size, height: size };
            },
          },
          (decodedText: string) => {
            if (!active) return;
            active = false;
            const text = decodedText.trim();
            void stop().finally(() => setScannedCode(text));
          },
          () => {},
        );
        if (active) setStarting(false);
      } catch {
        if (active) setError(GENERIC_ERROR);
      }
    })();

    return () => {
      active = false;
      void stop();
    };
  }, [open, scannedCode, containerId]);

  const handleConfirm = () => {
    if (!scannedCode) return;
    onResult(scannedCode);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{scannedCode ? "Confirmar asistencia" : "Escanear código QR"}</DialogTitle>
          <DialogDescription>
            {scannedCode ? "Revisa el código y confirma para registrar tu asistencia." : "Apunta la cámara al código QR de la sesión."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <>
            <div className="py-6 text-center text-sm text-destructive">{error}</div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </>
        ) : scannedCode ? (
          <>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="h-14 w-14 text-lime-600" />
              <div>
                <div className="text-lg font-semibold">Código correcto</div>
                <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Código de sesión</div>
                <div className="text-2xl font-bold tracking-widest">{scannedCode}</div>
              </div>
              <div className="text-base font-medium">¿Marcar tu asistencia?</div>
            </div>
            <div className="space-y-2">
              <Button className="w-full" onClick={handleConfirm}>
                Confirmar
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setScannedCode(null)}>
                  Escanear de nuevo
                </Button>
                <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="relative">
              <div
                id={containerId}
                className="w-full overflow-hidden rounded-lg border bg-black/5 [&_video]:w-full [&_video]:rounded-lg"
              />
              {starting && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg text-sm text-muted-foreground">
                  Iniciando cámara…
                </div>
              )}
            </div>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
