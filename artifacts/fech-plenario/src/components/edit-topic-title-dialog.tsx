import { useState } from "react";
import { Pencil } from "lucide-react";
import { useUpdateTopic, getListTopicsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export function EditTopicTitleDialog({
  sessionId,
  topic,
}: {
  sessionId: number;
  topic: { id: number; title: string; detail?: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const [detail, setDetail] = useState(topic.detail ?? "");
  const updateTopic = useUpdateTopic();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    updateTopic.mutate(
      { topicId: topic.id, data: { title: title.trim(), detail: detail.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTopicsQueryKey(sessionId) });
          toast({ title: "Moción actualizada" });
          setOpen(false);
        },
        onError: () => toast({ title: "No se pudo actualizar la moción", variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTitle(topic.title);
          setDetail(topic.detail ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="Editar título de la moción">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar moción</DialogTitle>
        </DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`topic-title-${topic.id}`}>Título</Label>
            <Input id={`topic-title-${topic.id}`} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`topic-detail-${topic.id}`}>Detalle</Label>
            <Textarea id={`topic-detail-${topic.id}`} value={detail} onChange={(e) => setDetail(e.target.value)} rows={4} />
          </div>
          <Button type="submit" disabled={updateTopic.isPending || !title.trim()}>Guardar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
