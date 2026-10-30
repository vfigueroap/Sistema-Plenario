import { useState } from "react";
import { Mic, Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useRegularSpeakerMutations, useRegularSpeakers, type RegularSpeaker } from "@/lib/regular-speakers";

function SpeakerRow({ speaker }: { speaker: RegularSpeaker }) {
  const { update, remove } = useRegularSpeakerMutations();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(speaker.name);
  const [description, setDescription] = useState(speaker.description ?? "");

  const fail = (error: Error) => toast({ title: error.message, variant: "destructive" });

  const save = () =>
    update.mutate(
      { id: speaker.id, data: { name, description } },
      { onSuccess: () => setEditing(false), onError: fail },
    );

  if (editing) {
    return (
      <div className="space-y-2 rounded-md border p-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción (opcional)" />
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={update.isPending || !name.trim()}>
            <Check className="mr-1 h-4 w-4" /> Guardar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            <X className="mr-1 h-4 w-4" /> Cancelar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{speaker.name}</span>
          {!speaker.active && <Badge variant="secondary">Inactivo</Badge>}
        </div>
        {speaker.description && <div className="text-xs text-muted-foreground">{speaker.description}</div>}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => update.mutate({ id: speaker.id, data: { active: !speaker.active } }, { onError: fail })}
      >
        {speaker.active ? "Desactivar" : "Activar"}
      </Button>
      <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditing(true)} aria-label="Editar">
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 w-8 p-0 text-red-600"
        aria-label="Eliminar"
        onClick={() => {
          if (confirm(`¿Eliminar a ${speaker.name} de los intervinientes regulares? Sus intervenciones pasadas se conservan.`)) {
            remove.mutate(speaker.id, { onError: fail });
          }
        }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function RegularSpeakersDialog() {
  const { data: speakers, isLoading } = useRegularSpeakers();
  const { create } = useRegularSpeakerMutations();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      { name, description },
      {
        onSuccess: () => {
          setName("");
          setDescription("");
          toast({ title: "Interviniente agregade" });
        },
        onError: (error) => toast({ title: error.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-none">
          <Mic className="mr-2 h-4 w-4" /> Intervinientes regulares
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Intervinientes regulares</DialogTitle>
          <DialogDescription>
            Personas y organizaciones que hablan con frecuencia, como la Defensoría Jurídica o estudiantes de base. Se eligen
            desde la lista al agregar une orador, para unificar sus tiempos de palabra bajo un mismo nombre.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={add} className="space-y-2 rounded-md border bg-muted/30 p-3">
          <Label htmlFor="rs-name">Nuevo interviniente</Label>
          <Input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre u organización" required />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descripción (opcional)" />
          <Button type="submit" size="sm" disabled={create.isPending || !name.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Agregar
          </Button>
        </form>
        <div className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (speakers ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay intervinientes regulares.</p>
          ) : (
            (speakers ?? []).map((s) => <SpeakerRow key={s.id} speaker={s} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
