import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetMe, useListSessions, useMarkAttendance, useListTopics, useListAttendance, useListAgendaPoints, useCheckOutAttendance, useRejoinAttendance, getGetMeQueryKey, getListTopicsQueryKey, getListSessionsQueryKey, getListAttendanceQueryKey, getListAgendaPointsQueryKey, type AttendanceInputModality } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { QrScannerDialog } from "@/components/qr-scanner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { SessionAgenda } from "@/components/session-agenda";
import { LiveRoster } from "@/components/live-roster";
import { SpeakingPanel } from "@/components/speaking-panel";
import { CurrentSpeaker } from "@/components/current-speaker";
import { SessionResources } from "@/components/session-resources";
import { useSessionLive } from "@/hooks/use-session-live";
import { getSocket } from "@/lib/realtime";
import { useLobbyLive } from "@/hooks/use-lobby-live";
import { TopicBallotsPanel } from "@/components/topic-ballots-panel";
import { QrCode, ArrowRight, RefreshCw, MapPin, Clock, Wifi, LogOut, CheckCircle2, Hand, ChevronDown, Users, LogIn } from "lucide-react";


// Botón para plegar un apartado. Va junto al título y no sobre la cabecera
// entera, porque varias traen sus propios controles.
function Plegar({ abierto, onClick, que }: { abierto: boolean; onClick: () => void; que: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={abierto}
      aria-label={`${abierto ? "Plegar" : "Desplegar"} ${que}`}
      className="flex h-7 w-7 shrink-0 items-center justify-center border border-gray-300 text-muted-foreground transition-colors hover:border-gray-800 hover:text-foreground"
    >
      <ChevronDown className={`h-4 w-4 transition-transform ${abierto ? "" : "-rotate-90"}`} />
    </button>
  );
}

export default function MemberDashboard() {
  const { data: user } = useGetMe();
  const { data: sessions } = useListSessions({ query: { queryKey: getListSessionsQueryKey() } });
  const markAttendance = useMarkAttendance();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [refreshing, setRefreshing] = useState(false);

  const [sessionCode, setSessionCode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);

  const [modality, setModality] = useState<AttendanceInputModality>("presencial");

  // Cada apartado se pliega por separado, para no llegar a una pantalla
  // saturada al entrar a una sesión en curso.
  const [abierto, setAbierto] = useState<Record<string, boolean>>({
    asistencia: true, mociones: true, tabla: true, palabra: true, nomina: true,
  });
  const alternar = (k: string) => setAbierto((p) => ({ ...p, [k]: !p[k] }));

  const openSession = sessions?.find(s => s.status === "abierta");
  const sessionId = openSession?.id || 0;
  const { data: topics } = useListTopics(sessionId, { query: { enabled: !!openSession, queryKey: getListTopicsQueryKey(sessionId) } });
  // Polling kept as a fallback at a larger interval; Socket.io drives instant updates.
  const { data: attendance } = useListAttendance(sessionId, { query: { enabled: !!openSession, refetchInterval: 30000, queryKey: getListAttendanceQueryKey(sessionId) } });
  const { data: agenda } = useListAgendaPoints(sessionId, { query: { enabled: !!openSession, refetchInterval: 30000, queryKey: getListAgendaPointsQueryKey(sessionId) } });
  const checkOut = useCheckOutAttendance();
  const rejoin = useRejoinAttendance();

  const { connected: liveConnected } = useSessionLive(openSession?.id);
  useLobbyLive();

  const openTopics = topics?.filter(t => t.status === "abierto") || [];

  const myAttendance = attendance?.present?.find(p => p.userId === user?.id);
  const iCheckedOut = attendance?.checkedOut?.some(p => p.userId === user?.id) ?? false;
  const isPresent = !!myAttendance;

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListTopicsQueryKey(sessionId) }),
      queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey(sessionId) }),
      queryClient.invalidateQueries({ queryKey: getListAgendaPointsQueryKey(sessionId) }),
    ]);
    setRefreshing(false);
  };

  const handleCheckOut = () => {
    if (!openSession || checkOut.isPending) return;
    if (!confirm("¿Seguro que quieres retirarte de la sesión? Dejarás de contar para el quórum y no podrás votar.")) return;
    checkOut.mutate({ id: openSession.id }, {
      onSuccess: () => {
        toast({ title: "Te has retirado de la sesión" });
        // Live updates only flow to active attendees; leave the room on retire.
        getSocket().emit("leave", openSession.id);
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey(sessionId) });
      },
      onError: () => toast({ title: "No se pudo registrar el retiro", variant: "destructive" }),
    });
  };

  const handleRejoin = () => {
    if (!openSession || rejoin.isPending) return;
    rejoin.mutate({ id: openSession.id }, {
      onSuccess: () => {
        toast({ title: "Has reingresado a la sesión" });
        // Al retirarse se salió de la sala de eventos: hay que volver a entrar
        // para recibir las actualizaciones en vivo.
        getSocket().emit("join", openSession.id);
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey(sessionId) });
      },
      onError: (err) => toast({
        title: "No se pudo reingresar",
        description: err instanceof Error ? err.message.slice(0, 200) : undefined,
        variant: "destructive",
      }),
    });
  };

  const submitCode = (code: string) => {
    if (!openSession || !code || markAttendance.isPending) return;
    markAttendance.mutate({ id: openSession.id, data: { sessionCode: code, modality } }, {
      onSuccess: () => {
        toast({ title: "Asistencia registrada correctamente" });
        setSessionCode("");
        // Now an active attendee — join the live room so updates arrive instantly.
        getSocket().emit("join", openSession.id);
        queryClient.invalidateQueries({ queryKey: getListAttendanceQueryKey(sessionId) });
      },
      onError: () => {
        toast({ title: "Código incorrecto", variant: "destructive" });
      }
    });
  };

  const handleMarkAttendance = (e: React.FormEvent) => {
    e.preventDefault();
    submitCode(sessionCode);
  };

  const handleScan = (text: string) => {
    const code = text.trim().toUpperCase();
    setSessionCode(code);
    submitCode(code);
  };

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        </div>

        <Card className="border-none text-white bg-gradient-to-br from-red-500 via-amber-500 to-lime-600 shadow-md">
          <CardContent className="p-6">
            <h2 className="text-2xl font-bold mb-1">Hola, {user?.displayName}</h2>
            <p className="opacity-90">
              Ponderación de voto: <strong>{user?.votingWeight}</strong>
              {user?.faculty && ` • ${user.faculty}`}
              {user?.group && ` • ${user.group}`}
            </p>
          </CardContent>
        </Card>

        {openSession && (
          <CurrentSpeaker sessionId={sessionId} currentUserId={user?.id} live={liveConnected} />
        )}

        {openSession ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div className="space-y-1.5">
                <CardTitle>Marcar Asistencia</CardTitle>
                <CardDescription>
                  {isPresent
                    ? "Ya registraste tu asistencia en esta sesión."
                    : iCheckedOut
                    ? "Te retiraste de esta sesión."
                    : "Ingresa el código mostrado en la pantalla principal para poder votar."}
                </CardDescription>
                </div>
                <Plegar abierto={abierto.asistencia} onClick={() => alternar("asistencia")} que="Marcar Asistencia" />
              </CardHeader>
              {abierto.asistencia && <CardContent>
                {isPresent ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded-lg border border-lime-200 bg-lime-50/60 p-4">
                      <CheckCircle2 className="h-6 w-6 text-lime-600 shrink-0" />
                      <div className="text-sm">
                        <div className="font-semibold text-foreground">Asistencia confirmada</div>
                        <div className="text-muted-foreground flex items-center gap-1">
                          {myAttendance?.modality === "online" ? <Wifi className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
                          {myAttendance?.modality === "online" ? "Participación online" : "Participación presencial"}
                        </div>
                      </div>
                    </div>
                    <Button type="button" variant="outline" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleCheckOut} disabled={checkOut.isPending}>
                      <LogOut className="h-4 w-4 mr-2" /> Retirarse de la sesión
                    </Button>
                  </div>
                ) : iCheckedOut ? (
                  <div className="space-y-4">
                    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                      <LogOut className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <div className="font-semibold text-foreground">Te retiraste de esta sesión</div>
                        No cuentas para el quórum y no puedes votar. Si vuelves, tu asistencia se
                        reactiva y recuperas ambas cosas.
                      </div>
                    </div>
                    <Button
                      type="button"
                      className="w-full"
                      disabled={rejoin.isPending}
                      onClick={handleRejoin}
                    >
                      <LogIn className="h-4 w-4 mr-2" />
                      {rejoin.isPending ? "Reingresando…" : "Reingresar a la sesión"}
                    </Button>
                  </div>
                ) : (
                  <>
                    <form onSubmit={handleMarkAttendance} className="space-y-4">
                      <div>
                        <div className="text-sm font-medium mb-2">Modalidad de participación</div>
                        <div className="grid grid-cols-2 gap-2">
                          <Button type="button" variant={modality === "presencial" ? "default" : "outline"} className="w-full" onClick={() => setModality("presencial")}>
                            <MapPin className="h-4 w-4 mr-2" /> Presencial
                          </Button>
                          <Button type="button" variant={modality === "online" ? "default" : "outline"} className="w-full" onClick={() => setModality("online")}>
                            <Wifi className="h-4 w-4 mr-2" /> Online
                          </Button>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <Input
                          placeholder="Ej: ABC12"
                          value={sessionCode}
                          onChange={e => setSessionCode(e.target.value.toUpperCase())}
                          className="uppercase text-lg tracking-widest text-center"
                        />
                      </div>
                      <Button type="submit" className="w-full" disabled={markAttendance.isPending || !sessionCode}>
                        Registrar Asistencia
                      </Button>
                    </form>
                    <div className="mt-6">
                      <div className="relative mb-4">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">o</span>
                        </div>
                      </div>
                      <Button type="button" variant="outline" className="w-full" onClick={() => setScannerOpen(true)}>
                        <QrCode className="w-4 h-4 mr-2" /> Escanear código QR
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>}
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div className="space-y-1.5">
                <CardTitle>Mociones Abiertas</CardTitle>
                <CardDescription>Sesión: {openSession.title}</CardDescription>
                <div className="text-sm text-muted-foreground flex flex-col gap-1 pt-1">
                  {openSession.location && (
                    <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{openSession.location}</span>
                  )}
                  {openSession.scheduledAt && (
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{new Date(openSession.scheduledAt).toLocaleString()}</span>
                  )}
                </div>
                <SessionResources meetingLink={openSession.meetingLink} actaObjectPath={openSession.actaObjectPath} actaFileName={openSession.actaFileName} className="pt-2" />
                </div>
                <Plegar abierto={abierto.mociones} onClick={() => alternar("mociones")} que="Mociones Abiertas" />
              </CardHeader>
              {abierto.mociones && <CardContent>
                {openTopics.length > 0 ? (
                  <div className="space-y-3">
                    {openTopics.map(topic => (
                      <div key={topic.id} className="p-4 rounded-lg border border-l-4 border-l-lime-500 bg-lime-50/40 flex flex-col justify-between gap-4">
                        <div className="font-medium text-lg leading-tight">{topic.title}</div>
                        <Button onClick={() => setLocation(`/member/vote/${topic.id}`)} className="w-full justify-between">
                          Votar ahora <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No hay mociones abiertas en este momento.
                  </div>
                )}
              </CardContent>}
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div className="space-y-1.5">
                  <CardTitle>Tabla de la Sesión</CardTitle>
                  <CardDescription>Puntos a tratar en esta sesión.</CardDescription>
                </div>
                <Plegar abierto={abierto.tabla} onClick={() => alternar("tabla")} que="la Tabla de la Sesión" />
              </CardHeader>
              {abierto.tabla && <CardContent>
                <SessionAgenda points={agenda ?? []} />
              </CardContent>}
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2"><Hand className="h-5 w-5" /> Sistema de Palabra</CardTitle>
                <CardDescription>
                  {isPresent
                    ? "Pide la palabra y sigue la cola de oradores en tiempo real."
                    : "Marca tu asistencia para poder pedir la palabra."}
                </CardDescription>
                </div>
                <Plegar abierto={abierto.palabra} onClick={() => alternar("palabra")} que="el Sistema de Palabra" />
              </CardHeader>
              {abierto.palabra && <CardContent>
                <SpeakingPanel
                  sessionId={sessionId}
                  agenda={agenda ?? []}
                  isAdmin={false}
                  currentUserId={user?.id}
                  speakingRoundOpen={openSession.speakingRoundOpen}
                  speakingRoundAgendaPointId={openSession.speakingRoundAgendaPointId}
                />
              </CardContent>}
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div className="space-y-1.5">
                <CardTitle>Nómina en Vivo</CardTitle>
                <CardDescription>
                  {attendance?.present.length ?? 0} presentes · ponderación {attendance?.presentWeight.toFixed(2) ?? "0.00"} / {attendance?.totalWeight.toFixed(2) ?? "0.00"}
                </CardDescription>
                </div>
                <Plegar abierto={abierto.nomina} onClick={() => alternar("nomina")} que="la Nómina en Vivo" />
              </CardHeader>
              {abierto.nomina && <CardContent className="space-y-4">
                <LiveRoster present={attendance?.present ?? []} checkedOut={attendance?.checkedOut ?? []} />

                {/* Desglose nominal por moción. Va plegado: son decenas de
                    nombres y desplegarlo por defecto sepultaría la nómina. */}
                {(topics ?? []).length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      Cómo votó cada integrante
                    </div>
                    {(topics ?? []).map((t) => (
                      <details key={t.id} className="border">
                        <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                          <span className="flex min-w-0 items-center gap-2">
                            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{t.title}</span>
                          </span>
                          <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white ${
                            t.status === "abierto" ? "bg-lime-600" : "bg-gray-500"}`}>
                            {t.status === "abierto" ? "EN VOTACIÓN" : "CERRADA"}
                          </span>
                        </summary>
                        <div className="border-t p-3">
                          {t.status === "abierto" && (
                            <p className="mb-3 border-l-[3px] border-amber-500 bg-amber-50/60 px-3 py-2 text-xs leading-snug">
                              Esta votación sigue abierta: el recuento no es definitivo y puede
                              cambiar hasta que la Mesa la cierre.
                            </p>
                          )}
                          <TopicBallotsPanel topicId={t.id} sessionId={sessionId} live />
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </CardContent>}
            </Card>
          </div>
        ) : (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              <div className="text-xl font-semibold text-foreground mb-2">No hay sesiones abiertas</div>
              <p>Le administradore debe abrir una sesión para que puedas marcar asistencia y votar.</p>
            </CardContent>
          </Card>
        )}

      </div>

      <QrScannerDialog open={scannerOpen} onOpenChange={setScannerOpen} onResult={handleScan} />
    </AppLayout>
  );
}
