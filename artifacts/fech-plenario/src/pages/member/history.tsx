import { useGetMyVotes, useGetMyAttendance, useGetMyHistory } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ResultsBar, CandidateResultsBar, MyVoteBadge } from "@/components/results-bar";
import { SessionResources } from "@/components/session-resources";
import { CheckCircle2, XCircle, MapPin, Clock, Mic, Hourglass } from "lucide-react";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const hhmm = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
};

function HistoricoTab() {
  const { data: history, isLoading } = useGetMyHistory();

  if (isLoading) {
    return <div className="p-12 flex justify-center"><Spinner /></div>;
  }
  if (!history || history.length === 0) {
    return (
      <div className="p-12 text-center text-muted-foreground bg-white rounded-lg border">
        Aún no hay sesiones registradas.
      </div>
    );
  }

  // Registro propio de uso de la palabra, acumulado en todas las sesiones.
  const misSegundos = history.reduce((n, s) => n + (s.mySeconds ?? 0), 0);
  const misTurnos = history.reduce((n, s) => n + (s.myTurns ?? 0), 0);
  const sesionesHablando = history.filter((s) => (s.myTurns ?? 0) > 0).length;
  const asistidas = history.filter((s) => s.attended).length;
  const horasPleno = history.reduce((n, s) => n + (s.officialMinutes ?? 0), 0);

  return (
    <div className="space-y-4">
      {misTurnos > 0 && (
        <div className="grid grid-cols-2 border-l border-t sm:grid-cols-4">
          {[
            { v: mmss(misSegundos), l: "Mi tiempo de palabra", icon: Mic, c: "text-orange-700" },
            { v: misTurnos, l: "Intervenciones", icon: Mic, c: "text-violet-700" },
            { v: `${sesionesHablando} de ${asistidas}`, l: "Sesiones en que hablé", icon: CheckCircle2, c: "text-emerald-700" },
            { v: horasPleno > 0 ? hhmm(horasPleno * 60) : "—", l: "Horas de pleno", icon: Hourglass, c: "text-blue-700" },
          ].map((x) => {
            const Icon = x.icon;
            return (
              <div key={x.l} className="border-b border-r bg-white p-3">
                <Icon className={`mb-1.5 h-4 w-4 ${x.c}`} />
                <div className={`text-lg font-bold tabular-nums ${x.c}`}>{x.v}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{x.l}</div>
              </div>
            );
          })}
        </div>
      )}

    <Accordion type="multiple" className="space-y-3">
      {history.map((s) => (
        <AccordionItem key={s.sessionId} value={String(s.sessionId)} className="border rounded-lg bg-white px-4">
          <AccordionTrigger className="hover:no-underline">
            <div className="flex flex-1 items-center justify-between gap-3 pr-3 text-left">
              <div>
                <div className="font-semibold text-gray-900">{s.title}</div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                  {s.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{s.location}</span>}
                  {s.scheduledAt && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(s.scheduledAt).toLocaleString()}</span>}
                  <span>{s.topics.length} moción(es)</span>
                  {s.officialMinutes != null && (
                    <span className="flex items-center gap-1"><Hourglass className="w-3 h-3" />{hhmm(s.officialMinutes * 60)}</span>
                  )}
                  {(s.myTurns ?? 0) > 0 && (
                    <span className="flex items-center gap-1 font-semibold text-orange-700">
                      <Mic className="w-3 h-3" />Hablaste {mmss(s.mySeconds ?? 0)}
                    </span>
                  )}
                </div>
              </div>
              {s.attended ? (
                <Badge variant="outline" className="bg-lime-50 text-lime-700 border-lime-200 shrink-0">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Asististe
                </Badge>
              ) : s.justified ? (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 shrink-0">
                  <XCircle className="w-3 h-3 mr-1" /> Inasistencia Justificada
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 shrink-0">
                  <XCircle className="w-3 h-3 mr-1" /> Ausente
                </Badge>
              )}
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pb-2">
              <SessionResources meetingLink={s.meetingLink} actaObjectPath={s.actaObjectPath} actaFileName={s.actaFileName} />

              {/* Quiénes tomaron la palabra en esta sesión. Es el registro
                  público de la deliberación, no solo del voto. */}
              {(s.speakers?.length ?? 0) > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-orange-700">
                    <Mic className="h-3.5 w-3.5" /> Uso de la palabra ({s.speakers!.length})
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[380px] text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2 text-left font-bold">Interviniente</th>
                          <th className="w-24 px-3 py-2 text-right font-bold">Tiempo</th>
                          <th className="w-20 px-3 py-2 text-right font-bold">Turnos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.speakers!.map((sp, i) => (
                          <tr key={i} className="border-b last:border-b-0">
                            <td className="px-3 py-1.5">
                              <span className="font-medium">{sp.name}</span>
                              {sp.collective && (
                                <span className="ml-2 rounded border border-teal-300 bg-teal-50 px-1.5 text-[10px] font-bold text-teal-700">
                                  COLECTIVA
                                </span>
                              )}
                              {sp.group && <span className="ml-2 text-xs text-muted-foreground">{sp.group}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{mmss(sp.seconds)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{sp.turns}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {s.topics.length === 0 ? (
                <div className="text-sm text-muted-foreground py-2">Esta sesión no tuvo mociones.</div>
              ) : (
                s.topics.map((t) => (
                  <Card key={t.topicId} className="p-4 border-primary/10">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="font-medium">{t.title}</div>
                        <div className="flex gap-2 items-center mt-1">
                          <Badge variant={t.status === "abierto" ? "default" : "secondary"} className="text-[10px]">
                            {t.status === "abierto" ? "ABIERTA" : "CERRADA"}
                          </Badge>
                          {t.approved !== null && (
                            <Badge variant="outline" className={t.approved ? "bg-lime-50 text-lime-700 border-lime-200 text-[10px]" : "bg-red-50 text-red-700 border-red-200 text-[10px]"}>
                              {t.approved ? "APROBADO" : "RECHAZADO"}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-muted-foreground uppercase">Mi voto</div>
                        <div className="mt-1"><MyVoteBadge myVote={t.myVote} attended={s.attended} /></div>
                      </div>
                    </div>
                    {/* Qué se sometió a votación: sin el detalle, el histórico
                        deja solo el título y se pierde el contenido de la moción. */}
                    {t.detail && (
                      <div className="mb-3 rounded-r-lg border-l-[3px] border-primary/60 bg-muted/40 px-3 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-primary mb-1">
                          Detalle de la moción
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{t.detail}</p>
                      </div>
                    )}
                    {t.type === "candidato" ? (
                      <CandidateResultsBar candidates={t.candidates ?? []} />
                    ) : (
                      <ResultsBar percentages={t.percentages} weights={t.weights} />
                    )}
                  </Card>
                ))
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
    </div>
  );
}

export default function MemberHistory() {
  const { data: votes, isLoading } = useGetMyVotes();
  const { data: attendance, isLoading: attendanceLoading } = useGetMyAttendance();

  return (
    <AppLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Mi Historial</h1>

        <Tabs defaultValue="historico">
          <TabsList>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
            <TabsTrigger value="votes">Mis Votos</TabsTrigger>
            <TabsTrigger value="attendance">Asistencias</TabsTrigger>
          </TabsList>

          <TabsContent value="historico">
            <HistoricoTab />
          </TabsContent>

          <TabsContent value="votes">
            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              {isLoading ? (
                <div className="p-12 flex justify-center"><Spinner /></div>
              ) : votes && votes.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Sesión</TableHead>
                      <TableHead>Tema</TableHead>
                      <TableHead>Ponderación</TableHead>
                      <TableHead>Mi Voto</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {votes.map((vote, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{new Date(vote.timestamp).toLocaleDateString()} {new Date(vote.timestamp).toLocaleTimeString()}</TableCell>
                        <TableCell className="text-muted-foreground">{vote.sessionTitle}</TableCell>
                        <TableCell className="font-medium">{vote.topicTitle}</TableCell>
                        <TableCell>{vote.weightAtVote}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              vote.option === "favor" ? "bg-lime-50 text-lime-700 border-lime-200" :
                              vote.option === "contra" ? "bg-red-50 text-red-700 border-red-200" :
                              "bg-yellow-50 text-yellow-700 border-yellow-200"
                            }
                          >
                            {vote.option.toUpperCase()}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  Aún no has emitido ningún voto.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="attendance">
            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              {attendanceLoading ? (
                <div className="p-12 flex justify-center"><Spinner /></div>
              ) : attendance && attendance.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha de registro</TableHead>
                      <TableHead>Sesión</TableHead>
                      <TableHead>Lugar</TableHead>
                      <TableHead>Hora programada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendance.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell className="whitespace-nowrap">{new Date(a.timestamp).toLocaleDateString()} {new Date(a.timestamp).toLocaleTimeString()}</TableCell>
                        <TableCell className="font-medium">{a.sessionTitle}</TableCell>
                        <TableCell className="text-muted-foreground">{a.location || "—"}</TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">{a.scheduledAt ? new Date(a.scheduledAt).toLocaleString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  Aún no tienes asistencias registradas.
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
