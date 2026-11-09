import { useState } from "react";
import { Users } from "lucide-react";
import { TopicBallotsPanel } from "@/components/topic-ballots-panel";

export function TopicBallotDetails({ topic, sessionId }: {
  topic: { id: number; title: string; status: string };
  sessionId: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="border" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/40">
        <span className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{topic.title}</span>
        </span>
        <span className={`shrink-0 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white ${topic.status === "abierto" ? "bg-lime-600" : "bg-gray-500"}`}>
          {topic.status === "abierto" ? "EN VOTACIÓN" : "CERRADA"}
        </span>
      </summary>
      {open && (
        <div className="border-t p-3">
          {topic.status === "abierto" && (
            <p className="mb-3 border-l-[3px] border-amber-500 bg-amber-50/60 px-3 py-2 text-xs leading-snug">
              Esta votación sigue abierta. El recuento no es definitivo y puede cambiar hasta que la Mesa la cierre.
            </p>
          )}
          <TopicBallotsPanel topicId={topic.id} sessionId={sessionId} live />
        </div>
      )}
    </details>
  );
}
