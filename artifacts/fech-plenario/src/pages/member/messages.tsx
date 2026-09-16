import { useState } from "react";
import {
  useListMyMessages,
  useReplyMessage,
  useMarkMessageRead,
  getListMyMessagesQueryKey,
} from "@workspace/api-client-react";
import type { InboxMessage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle2, Clock, Send, AlertTriangle, FileText, MapPin, Wifi } from "lucide-react";

const MOTIVOS = [
  "Motivos académicos (evaluación o clase)",
  "Motivos de salud",
  "Motivos laborales",
  "Problema de conectividad o transporte",
  "Otro motivo",
];

const ETIQUETA: Record<string, { label: string; clase: string }> = {
  citacion: { label: "CITACIÓN", clase: "bg-violet-700" },
  informativo: { label: "INFORMATIVO", clase: "bg-gray-500" },
};

type Respuesta = "presencial" | "online" | "justificada";


// Los errores del servidor traen la causa en el mensaje (incluye el código
// HTTP). Mostrarla es la diferencia entre "no se pudo" y saber que falta
// correr las migraciones.
function detalleError(err: unknown): string {
  const m = err instanceof Error ? err.message : "";
  return m ? m.slice(0, 200) : "Error desconocido";
}

function fecha(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("es-CL", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function Responder({ mensaje }: { mensaje: InboxMessage }) {
  const responder = useReplyMessage();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [detalle, setDetalle] = useState("");

  const vencido = mensaje.replyDeadline
    ? new Date(mensaje.replyDeadline).getTime() < Date.now()
    : false;

  const enviar = (reply: Respuesta) => {
    responder.mutate(
      {
        id: mensaje.id,
        data: { reply, ...(reply === "justificada" ? { reason: `${motivo}. ${detalle.trim()}` } : {}) },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMyMessagesQueryKey() });
          toast({
            title: reply === "justificada"
              ? "Justificación enviada — queda pendiente de revisión"
              : reply === "presencial"
                ? "Confirmaste asistencia presencial"
                : "Confirmaste asistencia online",
          });
          setAbierto(false);
          setDetalle("");
        },
        onError: (err) => toast({
          title: "No se pudo enviar la respuesta",
          description: detalleError(err),
          variant: "destructive",
        }),
      },
    );
  };

  // Ya respondió: se muestra el estado, con opción de cambiarlo si hay plazo.
  if (mensaje.reply) {
    const justifico = mensaje.reply === "justificada";
    const presencial = mensaje.reply === "presencial";
    const borde = justifico ? "border-l-orange-500 bg-orange-50/50"
      : presencial ? "border-l-lime-600 bg-lime-50/50" : "border-l-blue-600 bg-blue-50/50";
    return (
      <div className={`border border-l-[3px] p-3.5 ${borde}`}>
        <div className="flex items-start gap-2.5">
          {justifico ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" />
            : presencial ? <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-lime-700" />
            : <Wifi className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">
              {justifico ? "Justificaste tu inasistencia"
                : presencial ? "Confirmaste asistencia presencial"
                : "Confirmaste asistencia online"}
            </div>
            {mensaje.replyReason && (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{mensaje.replyReason}</p>
            )}
            {justifico && (
              <div className="mt-2">
                {mensaje.review === "aceptada" ? (
                  <span className="inline-block bg-lime-700 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white">
                    ACEPTADA POR LA MESA
                  </span>
                ) : mensaje.review === "rechazada" ? (
                  <span className="inline-block bg-red-700 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white">
                    RECHAZADA
                  </span>
                ) : (
                  <span className="inline-block border border-orange-400 px-2 py-0.5 text-[10px] font-bold tracking-wider text-orange-800">
                    PENDIENTE DE REVISIÓN
                  </span>
                )}
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  Aceptada o no, sigues contando como ausente para el quórum. Lo que cambia es
                  cómo aparece en el acta.
                </p>
              </div>
            )}
            {!vencido && (
              <button className="mt-2 text-xs font-semibold text-blue-700 underline"
                onClick={() => setAbierto(true)}>
                Cambiar mi respuesta
              </button>
            )}
          </div>
        </div>
        {abierto && (
          <div className="mt-3 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="rounded-none bg-lime-700 hover:bg-lime-800"
                disabled={responder.isPending} onClick={() => enviar("presencial")}>
                <MapPin className="mr-1.5 h-3.5 w-3.5" /> Presencial
              </Button>
              <Button size="sm" className="rounded-none bg-blue-700 hover:bg-blue-800"
                disabled={responder.isPending} onClick={() => enviar("online")}>
                <Wifi className="mr-1.5 h-3.5 w-3.5" /> Online
              </Button>
              <Button size="sm" variant="outline" className="rounded-none"
                onClick={() => setAbierto(false)}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (vencido) {
    return (
      <div className="flex items-start gap-2.5 border border-l-[3px] border-l-gray-400 bg-gray-50 p-3.5">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="text-sm">
          <b>Plazo vencido</b>
          <p className="text-xs text-muted-foreground">
            El plazo cerró el {fecha(mensaje.replyDeadline)}. Habla con la Mesa si tu situación cambió.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-dashed border-gray-400 p-4">
      <div className="text-sm font-bold">¿Asistirás a este pleno?</div>
      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
        Tu respuesta le permite a la Mesa estimar el quórum. No reemplaza el registro de
        asistencia del día de la sesión.
      </p>
      {mensaje.replyDeadline && (
        <p className="mt-2 inline-block border border-blue-300 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-800">
          Plazo para responder: {fecha(mensaje.replyDeadline)}
        </p>
      )}

      {!abierto ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Button className="rounded-none bg-lime-700 hover:bg-lime-800"
            disabled={responder.isPending} onClick={() => enviar("presencial")}>
            <MapPin className="mr-2 h-4 w-4" /> Asistiré presencial
          </Button>
          <Button className="rounded-none bg-blue-700 hover:bg-blue-800"
            disabled={responder.isPending} onClick={() => enviar("online")}>
            <Wifi className="mr-2 h-4 w-4" /> Asistiré online
          </Button>
          <Button variant="outline" className="rounded-none" onClick={() => setAbierto(true)}>
            <FileText className="mr-2 h-4 w-4" /> No podré asistir
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger className="rounded-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MOTIVOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="det">Detalle para la Mesa Directiva</Label>
            <Textarea id="det" className="min-h-24 rounded-none" value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              placeholder="Explica brevemente tu situación." />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-none bg-orange-700 hover:bg-orange-800"
              disabled={responder.isPending || !detalle.trim()}
              onClick={() => enviar("justificada")}>
              <Send className="mr-2 h-4 w-4" /> Enviar justificación
            </Button>
            <Button variant="outline" className="rounded-none" onClick={() => setAbierto(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MemberMessages() {
  const { data: mensajes, isLoading } = useListMyMessages({
    query: { refetchInterval: 60000, queryKey: getListMyMessagesQueryKey() },
  });
  const marcarLeido = useMarkMessageRead();

  const sinLeer = (mensajes ?? []).filter((m) => !m.readAt).length;
  const porResponder = (mensajes ?? []).filter(
    (m) => m.kind === "citacion" && !m.reply &&
      (!m.replyDeadline || new Date(m.replyDeadline).getTime() > Date.now()),
  ).length;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="border-b-2 border-gray-800 pb-4">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Mail className="h-6 w-6" /> Mensajería Plenaria
          </h1>
          <p className="text-sm text-muted-foreground">
            Citaciones y avisos de la Mesa Directiva.
          </p>
        </div>

        {porResponder > 0 && (
          <div className="flex items-start gap-2.5 border border-l-4 border-l-orange-500 bg-orange-50/60 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" />
            <div className="text-sm">
              <b className="text-orange-900">
                Tienes {porResponder} citación{porResponder !== 1 ? "es" : ""} sin responder
              </b>
              <p className="text-xs text-muted-foreground">
                Confirma tu asistencia o justifica tu inasistencia antes del plazo.
              </p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (mensajes ?? []).length === 0 ? (
          <div className="border border-dashed border-gray-400 p-12 text-center">
            <Mail className="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-40" />
            <p className="font-semibold">No tienes mensajes</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(mensajes ?? []).map((m) => {
              const tipo = ETIQUETA[m.kind] ?? ETIQUETA.informativo;
              return (
                <article key={m.id}
                  className={`border bg-white ${m.readAt ? "border-gray-300" : "border-l-4 border-l-blue-700 border-gray-300"}`}
                  onMouseEnter={() => { if (!m.readAt) marcarLeido.mutate({ id: m.id }); }}>
                  <header className="border-b border-gray-200 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-0.5 text-[10px] font-bold tracking-wider text-white ${tipo.clase}`}>
                        {tipo.label}
                      </span>
                      {!m.readAt && (
                        <span className="bg-blue-700 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white">
                          NUEVO
                        </span>
                      )}
                      <h2 className="text-base font-bold">{m.subject}</h2>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{fecha(m.createdAt)}</span>
                      {m.sessionTitle
                        ? <span className="font-semibold text-violet-700">{m.sessionTitle}</span>
                        : <span>Extra-pleno</span>}
                    </div>
                  </header>
                  <div className="space-y-4 p-4">
                    <p className="whitespace-pre-line text-sm leading-relaxed">{m.body}</p>
                    {m.kind === "citacion" && <Responder mensaje={m} />}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {sinLeer > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            {sinLeer} mensaje{sinLeer !== 1 ? "s" : ""} sin leer
          </p>
        )}
      </div>
    </AppLayout>
  );
}
