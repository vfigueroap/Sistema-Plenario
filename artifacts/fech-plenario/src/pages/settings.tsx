import { useState, useEffect } from "react";
import { useChangeMyPassword, useUpdateMyEmail, useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");

  const { data: me } = useGetMe();
  const changePassword = useChangeMyPassword();
  const updateEmail = useUpdateMyEmail();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (me?.email) setEmail(me.email);
  }, [me?.email]);

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateEmail.mutate({ data: { email } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        toast({ title: "Correo actualizado exitosamente" });
      },
      onError: () => {
        toast({ title: "Error", description: "Verifica que el correo sea válido.", variant: "destructive" });
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: "Las contraseñas no coinciden", variant: "destructive" });
      return;
    }

    changePassword.mutate({ data: { currentPassword, newPassword } }, {
      onSuccess: () => {
        toast({ title: "Contraseña actualizada exitosamente" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      },
      onError: () => {
        toast({ title: "Error", description: "Verifica tu contraseña actual e intenta de nuevo.", variant: "destructive" });
      }
    });
  };

  return (
    <AppLayout>
      <div className="max-w-md mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Ajustes</h1>

        <Card>
          <CardHeader>
            <CardTitle>Correo Electrónico</CardTitle>
            <CardDescription>Necesario para recuperar tu contraseña si la olvidas.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@correo.cl"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={updateEmail.isPending || !email}>
                Guardar Correo
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cambiar Contraseña</CardTitle>
            <CardDescription>Actualiza tu contraseña de acceso al sistema.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current">Contraseña actual</Label>
                <Input
                  id="current"
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">Nueva contraseña</Label>
                <Input
                  id="new"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmar nueva contraseña</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={changePassword.isPending || !currentPassword || !newPassword || !confirmPassword}>
                Actualizar Contraseña
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
