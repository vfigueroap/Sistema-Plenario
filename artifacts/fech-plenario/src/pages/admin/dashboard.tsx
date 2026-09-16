import { useState } from "react";
import { Link } from "wouter";
import {
  useListSessions,
  useCreateSession,
  getListSessionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/hooks/use-toast";
import { useLobbyLive } from "@/hooks/use-lobby-live";
import { MapPin, Clock, ArrowRight, Plus, X, FileCheck2, Video, Radio } from "lucide-react";

type Fase = "viva" | "futura" | "cerrada";

// Misma clasificación que usa el panel público: una sesión abierta está en
// curso; una cerrada con fecha futura está por venir; el resto ya ocurrió.
function faseDe(session: { status: string; scheduledAt?: string | null }): Fase {
  if (session.status === "abierta") return "viva";
  const ms = session.scheduledAt ? new Date(session.scheduledAt).getTime() : null;
  return ms !== null && ms > Date.now() ? "futura" : "cerrada";
}

const FASE = {
  viva: { label: "EN VIVO", chip: "bg-rose-500", border: "border-l-rose-500", cta: "Conducir", cy: "text-rose-600" },
  futura: { label: "PRÓXIMA", chip: "bg-violet-500", border: "border-l-violet-500", cta: "Preparar", cy: "text-violet-600" },
  cerrada: { label: "CERRADA", chip: "bg-gray-400", border: "border-l-gray-300", cta: "Ver", cy: "text-gray-500" },
} as const;

const ORDEN: Record<Fase, number> = { viva: 0, futura: 1, cerrada: 2 };

export default function AdminDashboard() {
  const { data: sessions, isLoading } = useListSessions({
    query: { refetchInterval: 30000, queryKey: getListSessionsQueryKey() },
  });
  const createSession = useCreateSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  useLobbyLive();

  const [formOpen, setFormOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [newMeetingLink, setNewMeetingLink] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle) return;
    createSession.mutate({
      data: {
        title: newTitle,
        location: newLocation || undefined,
        scheduledAt: newScheduledAt ? new Date(newScheduledAt).toISOString() : undefined,
        meetingLink: newMeetingLink.trim() || undefined,
      },
    }, {
      onSuccess: () => {
        setNewTitle("");
        setNewLocation("");
        setNewScheduledAt("");
        setNewMeetingLink("");
        setFormOpen(false);
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        toast({ title: "Sesión creada exitosamente" });
      },
      onError: () => toast({ title: "Error al crear sesión", variant: "destructive" }),
    });
  };

  const ordered = [...(sessions ?? [])].sort((a, b) => {
    const d = ORDEN[faseDe(a)] - ORDEN[faseDe(b)];
    if (d !== 0) return d;
    const ta = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
    const tb = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
    return tb - ta;
  });

  const activas = ordered.filter((s) => faseDe(s) !== "cerrada");
  const cerradas = ordered.filter((s) => faseDe(s) === "cerrada");

  const SessionRow = ({ session }: { session: typeof ordered[number] }) => {
    const fase = faseDe(session);
    const cfg = FASE[fase];
    return (
      <Link
        href={`/admin/sessions/${session.id}`}
        className={`group flex items-center gap-4 rounded-xl border border-l-4 bg-white p-4 transition-all hover:-translate-y-px hover:shadow-md ${cfg.border}`}
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-white ${cfg.chip}`}>
              {fase === "viva" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
              {cfg.label}
            </span>
            <h3 className="text-base font-semibold leading-tight">{session.title}</h3>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {session.scheduledAt && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />{new Date(session.scheduledAt).toLocaleString()}
              </span>
            )}
            {session.location && (
              <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{session.location}</span>
            )}
            {session.meetingLink && (
              <span className="flex items-center gap-1.5 text-cyan-600"><Video className="h-3.5 w-3.5" />Enlace</span>
            )}
            {session.actaObjectPath && (
              <span className="flex items-center gap-1.5 text-orange-600"><FileCheck2 className="h-3.5 w-3.5" />Acta</span>
            )}
          </div>
        </div>
        <span className={`flex shrink-0 items-center gap-2 text-sm font-semibold ${cfg.cy}`}>
          <span className="hidden sm:inline">{cfg.cta}</span>
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sesiones del pleno</h1>
            <p className="text-sm text-muted-foreground">
              Entra a cualquier sesión para editarla y conducirla.
            </p>
          </div>
          <Button onClick={() => setFormOpen((v) => !v)}>
            {formOpen ? <><X className="mr-2 h-4 w-4" /> Cancelar</> : <><Plus className="mr-2 h-4 w-4" /> Nueva sesión</>}
          </Button>
        </div>

        {formOpen && (
          <Card>
            <CardHeader>
              <CardTitle>Nueva sesión</CardTitle>
              <CardDescription>
                Al crearla se congela la ponderación de cada integrante para esta sesión.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="title">Título</Label>
                    <Input id="title" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Título de la sesión" autoFocus />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="location">Lugar</Label>
                    <Input id="location" value={newLocation} onChange={e => setNewLocation(e.target.value)} placeholder="Ej: Casa Central" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="scheduledAt">Fecha y hora</Label>
                    <Input id="scheduledAt" type="datetime-local" value={newScheduledAt} onChange={e => setNewScheduledAt(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="meetingLink">Enlace de la sesión</Label>
                  <Input id="meetingLink" type="url" value={newMeetingLink} onChange={e => setNewMeetingLink(e.target.value)} placeholder="https://meet.google.com/... (visible para todo el pleno)" />
                </div>
                <Button type="submit" disabled={createSession.isPending || !newTitle}>Crear sesión</Button>
              </form>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : ordered.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-white p-12 text-center">
            <Radio className="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-40" />
            <p className="font-semibold text-gray-900">Aún no hay sesiones</p>
            <p className="mt-1 text-sm text-muted-foreground">Crea la primera con el botón «Nueva sesión».</p>
          </div>
        ) : (
          <div className="space-y-6">
            {activas.length > 0 && (
              <div>
                <div className="mb-2.5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  En curso y próximas <span className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-2.5">
                  {activas.map((s) => <SessionRow key={s.id} session={s} />)}
                </div>
              </div>
            )}
            {cerradas.length > 0 && (
              <div>
                <div className="mb-2.5 flex items-center gap-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Cerradas <span className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-2.5">
                  {cerradas.map((s) => <SessionRow key={s.id} session={s} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
