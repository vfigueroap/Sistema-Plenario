import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, FileUp, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateSession, getListSessionsQueryKey, type Session } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Estado = "pendiente" | "subiendo" | "listo" | "omitido" | "error";
type Fila = { nombre: string; estado: Estado; detalle: string };

const fechaDelNombre = (nombre: string): string | null => {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(nombre);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const fechaDeLaSesion = (iso: string): string =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Santiago" }).format(new Date(iso));

export function ActasEnLoteDialog({ sessions }: { sessions: Session[] }) {
  const [open, setOpen] = useState(false);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const { uploadFile } = useUpload();
  const updateSession = useUpdateSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const marcar = (indice: number, cambio: Partial<Fila>) =>
    setFilas((actual) => actual.map((f, i) => (i === indice ? { ...f, ...cambio } : f)));

  const procesar = async (archivos: File[]) => {
    const ordenados = [...archivos].sort((a, b) => a.name.localeCompare(b.name, "es"));
    setFilas(ordenados.map((f) => ({ nombre: f.name, estado: "pendiente", detalle: "En espera" })));
    setTrabajando(true);
    let subidas = 0;
    for (let i = 0; i < ordenados.length; i++) {
      const archivo = ordenados[i];
      const fecha = fechaDelNombre(archivo.name);
      if (!archivo.name.toLowerCase().endsWith(".pdf")) {
        marcar(i, { estado: "error", detalle: "No es un PDF" });
        continue;
      }
      if (!fecha) {
        marcar(i, { estado: "error", detalle: "El nombre no trae la fecha en formato DD-MM-AAAA" });
        continue;
      }
      const sesion = sessions.find((s) => s.scheduledAt && fechaDeLaSesion(s.scheduledAt) === fecha);
      if (!sesion) {
        marcar(i, { estado: "error", detalle: `No hay una sesión del ${fecha.split("-").reverse().join("-")}` });
        continue;
      }
      if (sesion.actaObjectPath) {
        marcar(i, { estado: "omitido", detalle: `${sesion.title} ya tiene un acta, no se reemplazó` });
        continue;
      }
      marcar(i, { estado: "subiendo", detalle: `Subiendo a ${sesion.title}` });
      const resultado = await uploadFile(archivo);
      if (!resultado) {
        marcar(i, { estado: "error", detalle: "No se pudo subir el archivo" });
        continue;
      }
      try {
        await updateSession.mutateAsync({
          id: sesion.id,
          data: { actaObjectPath: resultado.objectPath, actaFileName: archivo.name },
        });
        subidas++;
        marcar(i, { estado: "listo", detalle: `Subida a ${sesion.title}` });
      } catch {
        marcar(i, { estado: "error", detalle: "Se subió el archivo pero no se pudo asociar a la sesión" });
      }
    }
    setTrabajando(false);
    queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
    toast({ title: subidas === 1 ? "1 acta subida" : `${subidas} actas subidas` });
  };

  return (
    <Dialog open={open} onOpenChange={(abierto) => !trabajando && setOpen(abierto)}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUp className="mr-2 h-4 w-4" /> Subir actas en lote
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Subir actas en lote</DialogTitle>
          <DialogDescription>
            Selecciona varios PDF a la vez. Cada archivo se asocia solo a la sesión cuya fecha aparece en su nombre
            con el formato DD-MM-AAAA. Las sesiones que ya tienen acta no se tocan.
          </DialogDescription>
        </DialogHeader>
        <input
          ref={entrada}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const archivos = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (archivos.length > 0) void procesar(archivos);
          }}
        />
        <Button onClick={() => entrada.current?.click()} disabled={trabajando}>
          {trabajando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
          Elegir los PDF
        </Button>
        {filas.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {filas.map((f) => (
              <li key={f.nombre} className="flex items-start gap-2 px-3 py-2">
                {f.estado === "listo" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : f.estado === "error" || f.estado === "omitido" ? (
                  <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${f.estado === "error" ? "text-red-600" : "text-amber-600"}`} />
                ) : (
                  <Loader2 className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground ${f.estado === "subiendo" ? "animate-spin" : ""}`} />
                )}
                <div className="min-w-0">
                  <div className="truncate font-medium">{f.nombre}</div>
                  <div className="text-xs text-muted-foreground">{f.detalle}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
