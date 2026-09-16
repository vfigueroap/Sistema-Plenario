import { useState, useMemo } from "react";
import {
  useListAdminMessages,
  useSendMessage,
  useReviewMessageReply,
  useListSessions,
  useListMembers,
  getListAdminMessagesQueryKey,
  getListSessionsQueryKey,
  getListMembersQueryKey,
} from "@workspace/api-client-react";
import type { AdminMessage, AdminMessageRecipient } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { GROUP_ORDER } from "@/lib/groups";
import {
  Mail, Send, Plus, X, CheckCircle2, XCircle, Clock, Users, Scale, AlertTriangle, Search, MapPin, Wifi,
} from "lucide-react";

const TIPOS = [
  { value: "citacion", label: "Citación", desc: "Cita al pleno y pide responder si asistirá" },
  { value: "informativo", label: "Informativo", desc: "Aviso que no espera respuesta" },
] as const;

const ETIQUETA_TIPO: Record<string, { label: string; clase: string }> = {
  citacion: { label: "CITACIÓN", clase: "bg-violet-700" },
  informativo: { label: "INFORMATIVO", clase: "bg-gray-500" },
};


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
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ─── Redactar ────────────────────────────────────────────────────────────────

function Redactar({ onEnviado }: { onEnviado: () => void }) {
  const { data: sessions } = useListSessions({ query: { queryKey: getListSessionsQueryKey() } });
  const { data: members } = useListMembers({ query: { queryKey: getListMembersQueryKey() } });
  const enviar = useSendMessage();
  const { toast } = useToast();

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"citacion" | "informativo">("citacion");
  const [sessionId, setSessionId] = useState<string>("ninguna");
  const [deadline, setDeadline] = useState("");
  // "todos" | "grupos" | "personas"
  const [modo, setModo] = useState<"todos" | "grupos" | "personas">("todos");
  const [grupos, setGrupos] = useState<string[]>([]);
  const [personas, setPersonas] = useState<number[]>([]);
  const [busca, setBusca] = useState("");

  const activos = useMemo(() => (members ?? []).filter((m) => m.active && m.rol === "miembro"), [members]);
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return activos.filter((m) =>
      !q || m.displayName.toLowerCase().includes(q) || (m.faculty ?? "").toLowerCase().includes(q));
  }, [activos, busca]);

  const cuantos =
    modo === "todos" ? activos.length
    : modo === "grupos" ? activos.filter((m) => m.group && grupos.includes(m.group)).length
    : personas.length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    enviar.mutate(
      {
        data: {
          subject: subject.trim(),
          body: body.trim(),
          kind,
          sessionId: sessionId === "ninguna" ? null : Number(sessionId),
          replyDeadline: deadline ? new Date(deadline).toISOString() : null,
          ...(modo === "grupos" ? { groups: grupos } : {}),
          ...(modo === "personas" ? { userIds: personas } : {}),
        },
      },
      {
        onSuccess: (m) => {
          toast({ title: `Mensaje enviado a ${m.total ?? cuantos} destinatarios` });
          setSubject(""); setBody(""); setGrupos([]); setPersonas([]); setDeadline("");
          onEnviado();
        },
        onError: (err) => toast({
            title: "No se pudo enviar el mensaje",
            description: detalleError(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4 border border-gray-300 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Tipo de mensaje</Label>
          <div className="grid gap-1.5">
            {TIPOS.map((t) => (
              <button key={t.value} type="button" onClick={() => setKind(t.value)}
                className={`border p-2.5 text-left transition-colors ${
                  kind === t.value ? "border-gray-900 bg-gray-50" : "border-gray-300 hover:border-gray-500"}`}>
                <div className="text-sm font-semibold">{t.label}</div>
                <div className="text-[11px] leading-snug text-muted-foreground">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="msg-session">Pleno al que se refiere</Label>
            <Select value={sessionId} onValueChange={setSessionId}>
              <SelectTrigger id="msg-session" className="rounded-none"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ninguna">Sin pleno asociado (extra-pleno)</SelectItem>
                {(sessions ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Asociarlo a un pleno permite que las justificaciones aceptadas queden en su acta.
            </p>
          </div>
          {kind === "citacion" && (
            <div className="space-y-2">
              <Label htmlFor="msg-deadline">Plazo para responder</Label>
              <Input id="msg-deadline" type="datetime-local" className="rounded-none"
                value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Destinatarios <span className="font-normal text-muted-foreground">· {cuantos} personas</span></Label>
        <div className="flex flex-wrap gap-1.5">
          {([["todos", "Todo el pleno"], ["grupos", "Por estamento"], ["personas", "Elegir personas"]] as const)
            .map(([k, l]) => (
              <button key={k} type="button" onClick={() => setModo(k)}
                className={`border px-3 py-1.5 text-xs font-semibold ${
                  modo === k ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 hover:border-gray-500"}`}>
                {l}
              </button>
            ))}
        </div>

        {modo === "grupos" && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {GROUP_ORDER.map((g) => {
              const on = grupos.includes(g);
              const n = activos.filter((m) => m.group === g).length;
              return (
                <button key={g} type="button"
                  onClick={() => setGrupos((p) => on ? p.filter((x) => x !== g) : [...p, g])}
                  className={`border px-3 py-1 text-xs ${
                    on ? "border-gray-900 bg-gray-100 font-semibold" : "border-gray-300"}`}>
                  {g} <span className="tabular-nums text-muted-foreground">{n}</span>
                </button>
              );
            })}
          </div>
        )}

        {modo === "personas" && (
          <div className="space-y-2 pt-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nombre o facultad…" className="rounded-none pl-9" />
            </div>
            <div className="max-h-52 overflow-y-auto border border-gray-300">
              {filtrados.map((m) => {
                const on = personas.includes(m.id);
                return (
                  <label key={m.id}
                    className="flex cursor-pointer items-center gap-2.5 border-b border-gray-100 px-3 py-1.5 text-sm last:border-b-0 hover:bg-gray-50">
                    <input type="checkbox" checked={on}
                      onChange={() => setPersonas((p) => on ? p.filter((x) => x !== m.id) : [...p, m.id])} />
                    <span className="flex-1">{m.displayName}</span>
                    <span className="text-xs text-muted-foreground">{m.faculty ?? m.group}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="msg-subject">Asunto</Label>
        <Input id="msg-subject" className="rounded-none" value={subject}
          onChange={(e) => setSubject(e.target.value)} placeholder="Ej: Citación al 5.º Pleno Ordinario" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="msg-body">Mensaje</Label>
        <Textarea id="msg-body" className="min-h-32 rounded-none" value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Escribe aquí el contenido. Lo verán en su panel al ingresar." />
      </div>

      <Button type="submit" className="rounded-none"
        disabled={enviar.isPending || !subject.trim() || !body.trim() || cuantos === 0}>
        <Send className="mr-2 h-4 w-4" />
        {enviar.isPending ? "Enviando…" : `Enviar a ${cuantos} destinatarios`}
      </Button>
    </form>
  );
}

// ─── Respuestas de un mensaje ────────────────────────────────────────────────

function Respuestas({ mensaje }: { mensaje: AdminMessage }) {
  const revisar = useReviewMessageReply();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const resolver = (r: AdminMessageRecipient, review: "aceptada" | "rechazada") => {
    revisar.mutate(
      { id: mensaje.id, userId: r.userId, data: { review } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAdminMessagesQueryKey() });
          toast({
            title: review === "aceptada"
              ? `Justificación aceptada — ${r.name} queda con Inasistencia Justificada`
              : `Justificación rechazada — ${r.name}`,
          });
        },
        onError: (err) => toast({
          title: "No se pudo resolver la justificación",
          description: detalleError(err),
          variant: "destructive",
        }),
      },
    );
  };

  const dest = mensaje.recipients ?? [];
  const justificadas = dest.filter((d) => d.reply === "justificada");
  const presenciales = dest.filter((d) => d.reply === "presencial");
  const enLinea = dest.filter((d) => d.reply === "online");
  const sinResponder = dest.filter((d) => d.reply === null || d.reply === undefined);

  return (
    <div className="space-y-4">
      {justificadas.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-orange-700">
            Justificaciones ({justificadas.length})
          </div>
          <div className="space-y-2">
            {justificadas.map((r) => (
              <div key={r.userId} className={`border border-l-[3px] p-3 ${
                r.review === "aceptada" ? "border-l-lime-600 bg-lime-50/50"
                : r.review === "rechazada" ? "border-l-red-600 bg-red-50/50"
                : "border-l-orange-500"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{r.name}</span>
                  <span className="text-[11px] text-muted-foreground">{fecha(r.repliedAt)}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {r.group} {r.faculty && `· ${r.faculty}`} · ponderación {r.weight}
                </div>
                {r.replyReason && (
                  <p className="mt-2 border border-gray-200 bg-white p-2.5 text-sm leading-relaxed">
                    {r.replyReason}
                  </p>
                )}
                {r.review === "pendiente" || r.review === null ? (
                  <div className="mt-2.5 flex gap-2">
                    <Button size="sm" className="rounded-none bg-lime-700 hover:bg-lime-800"
                      disabled={revisar.isPending} onClick={() => resolver(r, "aceptada")}>
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Aceptar
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-none"
                      disabled={revisar.isPending} onClick={() => resolver(r, "rechazada")}>
                      <XCircle className="mr-1.5 h-3.5 w-3.5" /> Rechazar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`px-2 py-0.5 text-[10px] font-bold tracking-wider text-white ${
                      r.review === "aceptada" ? "bg-lime-700" : "bg-red-700"}`}>
                      {r.review === "aceptada" ? "ACEPTADA" : "RECHAZADA"}
                    </span>
                    <button className="text-[11px] font-semibold text-blue-700 underline"
                      onClick={() => resolver(r, r.review === "aceptada" ? "rechazada" : "aceptada")}>
                      Cambiar
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-lime-700">
              <MapPin className="h-3.5 w-3.5" /> Presencial ({presenciales.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {presenciales.length === 0
                ? <span className="text-xs text-muted-foreground">Nadie todavía.</span>
                : presenciales.map((r) => (
                    <span key={r.userId} className="border border-lime-300 bg-lime-50 px-2 py-0.5 text-xs">
                      {r.name}
                    </span>
                  ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-700">
              <Wifi className="h-3.5 w-3.5" /> Online ({enLinea.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {enLinea.length === 0
                ? <span className="text-xs text-muted-foreground">Nadie todavía.</span>
                : enLinea.map((r) => (
                    <span key={r.userId} className="border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs">
                      {r.name}
                    </span>
                  ))}
            </div>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Sin responder ({sinResponder.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {sinResponder.length === 0
              ? <span className="text-xs text-muted-foreground">Todes respondieron.</span>
              : sinResponder.map((r) => (
                  <span key={r.userId} className="border border-gray-300 px-2 py-0.5 text-xs text-muted-foreground">
                    {r.name}
                  </span>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function AdminMessages() {
  const { data: mensajes, isLoading } = useListAdminMessages({
    query: { refetchInterval: 30000, queryKey: getListAdminMessagesQueryKey() },
  });
  const queryClient = useQueryClient();
  const [redactando, setRedactando] = useState(false);

  const pendientes = (mensajes ?? []).reduce((n, m) => n + (m.pendientesRevision ?? 0), 0);

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-gray-800 pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Mail className="h-6 w-6" /> Mensajería Plenaria
            </h1>
            <p className="text-sm text-muted-foreground">
              Citaciones y avisos al pleno, con sus respuestas.
            </p>
          </div>
          <Button className="rounded-none" onClick={() => setRedactando((v) => !v)}>
            {redactando ? <><X className="mr-2 h-4 w-4" /> Cancelar</> : <><Plus className="mr-2 h-4 w-4" /> Nuevo mensaje</>}
          </Button>
        </div>

        {pendientes > 0 && (
          <div className="flex items-start gap-2.5 border border-l-4 border-l-orange-500 bg-orange-50/60 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-700" />
            <div className="text-sm">
              <b className="text-orange-900">
                {pendientes} justificación{pendientes !== 1 ? "es" : ""} por revisar
              </b>
              <p className="text-xs text-muted-foreground">
                Aceptar una justificación deja la etiqueta en el acta. No cambia el quórum:
                la persona sigue contando como ausente.
              </p>
            </div>
          </div>
        )}

        {redactando && <Redactar onEnviado={() => {
          setRedactando(false);
          queryClient.invalidateQueries({ queryKey: getListAdminMessagesQueryKey() });
        }} />}

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (mensajes ?? []).length === 0 ? (
          <div className="border border-dashed border-gray-400 p-12 text-center">
            <Mail className="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-40" />
            <p className="font-semibold">No has enviado mensajes todavía</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Usa «Nuevo mensaje» para citar al pleno o enviar un aviso.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {(mensajes ?? []).map((m) => {
              const tipo = ETIQUETA_TIPO[m.kind] ?? ETIQUETA_TIPO.informativo;
              return (
                <details key={m.id} className="border border-gray-300 bg-white">
                  <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`px-2 py-0.5 text-[10px] font-bold tracking-wider text-white ${tipo.clase}`}>
                          {tipo.label}
                        </span>
                        <span className="text-sm font-bold">{m.subject}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{fecha(m.createdAt)}</span>
                        {m.sessionTitle
                          ? <span className="font-semibold text-violet-700">{m.sessionTitle}</span>
                          : <span>Extra-pleno</span>}
                        <span className="flex items-center gap-1"><Users className="h-3 w-3" />{m.total} destinatarios</span>
                        {m.replyDeadline && (
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Plazo {fecha(m.replyDeadline)}</span>
                        )}
                      </div>
                    </div>
                    {m.kind === "citacion" && (
                      <div className="flex shrink-0 flex-wrap gap-1.5 text-[11px] font-bold">
                        <span className="border border-lime-300 bg-lime-50 px-2 py-0.5 text-lime-800">
                          {m.presenciales} presencial
                        </span>
                        <span className="border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-800">
                          {m.online} online
                        </span>
                        <span className="border border-orange-300 bg-orange-50 px-2 py-0.5 text-orange-800">
                          {m.justificadas} justifican
                        </span>
                        <span className="border border-gray-300 px-2 py-0.5 text-muted-foreground">
                          {m.sinResponder} sin responder
                        </span>
                        {(m.pendientesRevision ?? 0) > 0 && (
                          <span className="bg-orange-600 px-2 py-0.5 text-white">
                            {m.pendientesRevision} por revisar
                          </span>
                        )}
                      </div>
                    )}
                  </summary>
                  <div className="space-y-4 border-t border-gray-200 p-4">
                    <p className="whitespace-pre-line border-l-[3px] border-gray-300 bg-gray-50 px-3 py-2 text-sm leading-relaxed">
                      {m.body}
                    </p>
                    {m.kind === "citacion" && (
                      <div className="flex items-center gap-2 border border-gray-300 bg-white px-3 py-2 text-sm">
                        <Scale className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Ponderación comprometida</span>
                        <b className="tabular-nums">{(m.pesoConfirmado ?? 0).toFixed(2)}</b>
                        <span className="text-xs text-muted-foreground">
                          — proyección, no asistencia registrada
                        </span>
                      </div>
                    )}
                    {m.kind === "citacion"
                      ? <Respuestas mensaje={m} />
                      : (
                        <div>
                          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            Leído por {m.leidos} de {m.total}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {(m.recipients ?? []).map((r) => (
                              <span key={r.userId}
                                className={`border px-2 py-0.5 text-xs ${
                                  r.readAt ? "border-lime-300 bg-lime-50" : "border-gray-300 text-muted-foreground"}`}>
                                {r.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
