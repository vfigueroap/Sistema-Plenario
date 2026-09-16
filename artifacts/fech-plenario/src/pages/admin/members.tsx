import { useState, useMemo } from "react";
import { useListMembers, useUpdateMember, useResetMemberPassword, useCreateMember, useDeleteMember, getListMembersQueryKey, useGetMemberAttendance, getGetMemberAttendanceQueryKey, useListUnidadesAcademicas, useCreateUnidadAcademica, useDeleteUnidadAcademica, getListUnidadesAcademicasQueryKey } from "@workspace/api-client-react";
import type { Member } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Spinner } from "@/components/ui/spinner";
import { GROUP_ORDER } from "@/lib/groups";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { RefreshCw, UserPlus, Trash2, Pencil, Ban, CheckCircle2, ArrowUpDown, Search } from "lucide-react";

function AddMemberDialog() {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [group, setGroup] = useState<string>("");
  const [faculty, setFaculty] = useState("");
  const [votingWeight, setVotingWeight] = useState("0");
  const [votingWeightAlt, setVotingWeightAlt] = useState("0");
  const createMember = useCreateMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const reset = () => {
    setUsername("");
    setDisplayName("");
    setPassword("");
    setGroup("");
    setFaculty("");
    setVotingWeight("0");
    setVotingWeightAlt("0");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedWeight = parseFloat(votingWeight);
    const parsedAlt = parseFloat(votingWeightAlt);
    createMember.mutate(
      {
        data: {
          username: username.trim(),
          displayName: displayName.trim(),
          password,
          group: group || null,
          faculty: faculty.trim() || null,
          votingWeight: isNaN(parsedWeight) ? 0 : parsedWeight,
          votingWeightAlt: isNaN(parsedAlt) ? 0 : parsedAlt,
          rol: "miembro",
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
          toast({ title: "Miembre agregade" });
          reset();
          setOpen(false);
        },
        onError: (err) => {
          const status = (err as { status?: number })?.status;
          toast({
            title: status === 409 ? "El nombre de usuario ya existe" : "Error al agregar miembre",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="h-4 w-4 mr-2" />
          Agregar miembre
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar nueve miembre</DialogTitle>
          <DialogDescription>Asigna una contraseña única y entrégala a la persona por un canal privado.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="nm-username">Nombre de usuario</Label>
            <Input id="nm-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ej: juan.perez" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-name">Nombre para mostrar</Label>
            <Input id="nm-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="ej: Juan Pérez" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="nm-password">Contraseña</Label>
            <Input id="nm-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nm-group">Grupo</Label>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger id="nm-group">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_ORDER.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nm-faculty">Facultad</Label>
              <Input id="nm-faculty" value={faculty} onChange={(e) => setFaculty(e.target.value)} placeholder="ej: FAU" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nm-weight">Ponderación</Label>
              <Input id="nm-weight" type="number" step="0.01" min="0" value={votingWeight} onChange={(e) => setVotingWeight(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nm-weight-alt">Ponderación alt.</Label>
              <Input id="nm-weight-alt" type="number" step="0.01" min="0" value={votingWeightAlt} onChange={(e) => setVotingWeightAlt(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={createMember.isPending} className="w-full">
            {createMember.isPending ? "Agregando..." : "Agregar miembre"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({ member }: { member: Member }) {
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(member.displayName);
  const [username, setUsername] = useState(member.username);
  const [group, setGroup] = useState<string>(member.group ?? "");
  const [faculty, setFaculty] = useState(member.faculty ?? "");
  const updateMember = useUpdateMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const reset = () => {
    setDisplayName(member.displayName);
    setUsername(member.username);
    setGroup(member.group ?? "");
    setFaculty(member.faculty ?? "");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMember.mutate(
      {
        id: member.id,
        data: {
          displayName: displayName.trim(),
          username: username.trim(),
          group: group || null,
          faculty: faculty.trim() || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
          toast({ title: "Miembre actualizade" });
          setOpen(false);
        },
        onError: (err) => {
          const status = (err as { status?: number })?.status;
          toast({
            title: status === 409 ? "El nombre de usuario ya existe" : "Error al actualizar miembre",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar miembre</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="em-name">Nombre para mostrar</Label>
            <Input id="em-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="em-username">Nombre de usuario</Label>
            <Input id="em-username" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="em-group">Grupo</Label>
              <Select value={group} onValueChange={setGroup}>
                <SelectTrigger id="em-group">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_ORDER.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="em-faculty">Facultad</Label>
              <Input id="em-faculty" value={faculty} onChange={(e) => setFaculty(e.target.value)} placeholder="ej: FAU" />
            </div>
          </div>
          <Button type="submit" disabled={updateMember.isPending} className="w-full">
            {updateMember.isPending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditableWeight({ memberId, initialWeight, field }: { memberId: number, initialWeight: number, field: "votingWeight" | "votingWeightAlt" }) {
  const [isEditing, setIsEditing] = useState(false);
  const [weight, setWeight] = useState(initialWeight.toString());
  const updateMember = useUpdateMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSave = () => {
    const parsed = parseFloat(weight);
    if (isNaN(parsed)) {
      setWeight(initialWeight.toString());
      setIsEditing(false);
      return;
    }

    if (parsed !== initialWeight) {
      updateMember.mutate({ id: memberId, data: { [field]: parsed } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
          toast({ title: "Ponderación actualizada" });
          setIsEditing(false);
        },
        onError: () => {
          toast({ title: "Error al actualizar", variant: "destructive" });
          setWeight(initialWeight.toString());
          setIsEditing(false);
        }
      });
    } else {
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <Input
        type="number"
        step="0.01"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => e.key === "Enter" && handleSave()}
        className="w-24 h-8"
        autoFocus
      />
    );
  }

  return (
    <div
      className="cursor-pointer hover:bg-gray-100 px-2 py-1 rounded select-none inline-block min-w-16 text-right"
      onClick={() => { setWeight(initialWeight.toString()); setIsEditing(true); }}
    >
      {initialWeight}
    </div>
  );
}

function ToggleActiveDialog({ member }: { member: Member }) {
  const [open, setOpen] = useState(false);
  const updateMember = useUpdateMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deactivating = member.active;

  const handleToggle = () => {
    updateMember.mutate({ id: member.id, data: { active: !member.active } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
        toast({ title: deactivating ? "Cuenta inhabilitada" : "Cuenta habilitada" });
        setOpen(false);
      },
      onError: () => toast({ title: "Error al cambiar el estado de la cuenta", variant: "destructive" }),
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={deactivating ? "text-amber-600 hover:text-amber-700" : "text-lime-600 hover:text-lime-700"}
          title={deactivating ? "Inhabilitar cuenta" : "Habilitar cuenta"}
        >
          {deactivating ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{deactivating ? "Inhabilitar" : "Habilitar"} a {member.displayName}</AlertDialogTitle>
          <AlertDialogDescription>
            {deactivating
              ? "La persona podrá iniciar sesión pero verá su cuenta inhabilitada: no podrá marcar asistencia ni votar, y su ponderación quedará excluida de todos los totales. Su perfil e historial se conservan."
              : "La persona volverá a poder marcar asistencia y votar, y su ponderación volverá a contar en los totales."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleToggle(); }}
            disabled={updateMember.isPending}
            className={deactivating ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-lime-600 text-white hover:bg-lime-700"}
          >
            {deactivating ? "Inhabilitar" : "Habilitar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResetPasswordDialog({ memberId, memberName }: { memberId: number, memberName: string }) {
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState(false);
  const resetPassword = useResetMemberPassword();
  const { toast } = useToast();

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    resetPassword.mutate({ id: memberId, data: { newPassword: password } }, {
      onSuccess: () => {
        toast({ title: "Contraseña restablecida" });
        setOpen(false);
        setPassword("");
      },
      onError: () => toast({ title: "Error al restablecer contraseña", variant: "destructive" })
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Contraseña</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restablecer Contraseña: {memberName}</DialogTitle>
          <DialogDescription>Define una nueva contraseña. La contraseña anterior no se puede consultar.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleReset} className="space-y-4 pt-4">
          <Label htmlFor={`reset-password-${memberId}`}>Nueva contraseña</Label>
          <Input
            id={`reset-password-${memberId}`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Nueva contraseña"
            required
          />
          <Button type="submit" disabled={resetPassword.isPending}>Restablecer</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteMemberDialog({ memberId, memberName }: { memberId: number, memberName: string }) {
  const [open, setOpen] = useState(false);
  const deleteMember = useDeleteMember();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleDelete = () => {
    deleteMember.mutate({ id: memberId }, {
      onSuccess: () => {
        toast({ title: "Miembre eliminade" });
        queryClient.invalidateQueries({ queryKey: getListMembersQueryKey() });
        setOpen(false);
      },
      onError: () => toast({ title: "Error al eliminar miembre", variant: "destructive" }),
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar a {memberName}</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción es permanente. Se eliminará la cuenta junto con sus votos, asistencias e historial. No se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); handleDelete(); }}
            disabled={deleteMember.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Eliminar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AttendanceHistoryDialog({ memberId, memberName }: { memberId: number, memberName: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useGetMemberAttendance(memberId, { query: { enabled: open, queryKey: getGetMemberAttendanceQueryKey(memberId) } });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">Asistencias</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Asistencias: {memberName}</DialogTitle>
        </DialogHeader>
        <div className="pt-2 max-h-96 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 flex justify-center"><Spinner /></div>
          ) : data && data.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sesión</TableHead>
                  <TableHead>Lugar</TableHead>
                  <TableHead>Registro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((a, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{a.sessionTitle}</TableCell>
                    <TableCell className="text-muted-foreground">{a.location || "—"}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{new Date(a.timestamp).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-8 text-center text-muted-foreground">Sin asistencias registradas.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UnidadesManager() {
  const [name, setName] = useState("");
  const { data: unidades, isLoading } = useListUnidadesAcademicas({
    query: { queryKey: getListUnidadesAcademicasQueryKey() },
  });
  const createUnidad = useCreateUnidadAcademica();
  const deleteUnidad = useDeleteUnidadAcademica();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListUnidadesAcademicasQueryKey() });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createUnidad.mutate(
      { data: { name: trimmed } },
      {
        onSuccess: () => {
          setName("");
          invalidate();
          toast({ title: "Unidad académica creada" });
        },
        onError: (err: any) =>
          toast({
            title: err?.status === 409 ? "Esa unidad ya existe" : "No se pudo crear la unidad",
            variant: "destructive",
          }),
      },
    );
  };

  const handleDelete = (id: number, unidadName: string) => {
    if (!confirm(`¿Eliminar la unidad académica "${unidadName}"?`)) return;
    deleteUnidad.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Unidad eliminada" });
        },
        onError: () => toast({ title: "No se pudo eliminar la unidad", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border p-4 space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Unidades Académicas</h2>
        <p className="text-sm text-muted-foreground">
          Catálogo usado para las palabras colectivas de consejeres.
        </p>
      </div>
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input
          placeholder="Nombre de la unidad académica"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-sm"
        />
        <Button type="submit" disabled={createUnidad.isPending || !name.trim()}>
          <UserPlus className="h-4 w-4 mr-2" /> Agregar
        </Button>
      </form>
      {isLoading ? (
        <div className="py-4 flex justify-center"><Spinner /></div>
      ) : (unidades?.length ?? 0) === 0 ? (
        <div className="text-sm text-muted-foreground">Sin unidades académicas.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {unidades?.map((u) => (
            <Badge key={u.id} variant="secondary" className="flex items-center gap-1.5 pl-3 pr-1 py-1">
              <span>{u.name}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-red-600 hover:text-red-700"
                disabled={deleteUnidad.isPending}
                onClick={() => handleDelete(u.id, u.name)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

type SortKey = "displayName" | "username" | "group";

export default function AdminMembers() {
  const { data: members, isLoading, isFetching, refetch } = useListMembers({
    query: { refetchInterval: 10000, queryKey: getListMembersQueryKey() },
  });
  const [sortKey, setSortKey] = useState<SortKey>("displayName");
  // Con casi cien integrantes, buscar es más frecuente que ordenar.
  const [search, setSearch] = useState("");

  const sortedMembers = useMemo(() => {
    if (!members) return [];
    const q = search.trim().toLowerCase();
    const arr = members.filter((m) =>
      !q ||
      m.displayName.toLowerCase().includes(q) ||
      m.username.toLowerCase().includes(q) ||
      (m.group ?? "").toLowerCase().includes(q) ||
      (m.faculty ?? "").toLowerCase().includes(q));
    arr.sort((a, b) => {
      const av = (sortKey === "group" ? a.group : a[sortKey]) ?? "";
      const bv = (sortKey === "group" ? b.group : b[sortKey]) ?? "";
      return av.localeCompare(bv, "es", { sensitivity: "base" });
    });
    return arr;
  }, [members, sortKey, search]);

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-gray-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Integrantes del pleno</h1>
            <p className="text-sm text-muted-foreground">
              {members?.filter((m) => m.active).length ?? 0} activos de {members?.length ?? 0}.
              Las altas y bajas no afectan sesiones ya creadas.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-none" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
            <AddMemberDialog />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, usuario, facultad o grupo…"
              className="rounded-none pl-9"
            />
          </div>
          <div className="flex items-center gap-1">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-10 w-36 rounded-none" aria-label="Ordenar por">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="displayName">Nombre</SelectItem>
                <SelectItem value="username">Usuario</SelectItem>
                <SelectItem value="group">Grupo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {search && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {sortedMembers.length} resultado{sortedMembers.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="bg-white border overflow-hidden">
          {isLoading ? (
            <div className="p-8 flex justify-center"><Spinner /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Facultad/Grupo</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Ponderación</TableHead>
                  <TableHead className="text-right">Ponderación alt.</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedMembers.map((member) => (
                  <TableRow key={member.id} className={member.rol !== "admin" && !member.active ? "opacity-60" : ""}>
                    <TableCell className="font-medium">{member.displayName}</TableCell>
                    <TableCell>{member.username}</TableCell>
                    <TableCell>
                      {member.faculty && <Badge variant="outline" className="mr-1">{member.faculty}</Badge>}
                      {member.group && <Badge variant="secondary">{member.group}</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.rol === "admin" ? "default" : "secondary"}>
                        {member.rol === "admin" ? "admin" : "miembre"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {member.rol === "admin" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : member.active ? (
                        <Badge variant="outline" className="bg-lime-50 text-lime-700 border-lime-200">Habilitada</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Inhabilitada</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {member.rol === "admin" ? "-" : (
                        <EditableWeight memberId={member.id} initialWeight={member.votingWeight} field="votingWeight" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {member.rol === "admin" ? "-" : (
                        <EditableWeight memberId={member.id} initialWeight={member.votingWeightAlt} field="votingWeightAlt" />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <AttendanceHistoryDialog memberId={member.id} memberName={member.displayName} />
                        {member.rol !== "admin" && <EditMemberDialog member={member} />}
                        <ResetPasswordDialog memberId={member.id} memberName={member.displayName} />
                        {member.rol !== "admin" && <ToggleActiveDialog member={member} />}
                        {member.rol !== "admin" && (
                          <DeleteMemberDialog memberId={member.id} memberName={member.displayName} />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && sortedMembers.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Nadie coincide con «{search}».
            </div>
          )}
        </div>

        {/* Catálogo de unidades: mantenimiento ocasional. Antes estaba sobre la
            nómina, ocupando espacio permanente en la pantalla que más se usa. */}
        <details className="border">
          <summary className="cursor-pointer select-none bg-muted/40 px-4 py-2.5 text-sm font-semibold hover:bg-muted/60">
            Unidades académicas
          </summary>
          <div className="border-t p-4">
            <UnidadesManager />
          </div>
        </details>
      </div>
    </AppLayout>
  );
}
