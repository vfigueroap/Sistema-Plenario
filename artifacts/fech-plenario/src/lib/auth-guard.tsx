import { useEffect } from "react";
import { useLocation } from "wouter";
import { useGetMe, useLogout } from "@workspace/api-client-react";
import { useUserLive } from "@/hooks/use-user-live";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Ban } from "lucide-react";

function DisabledAccountScreen({ name }: { name: string }) {
  const [, setLocation] = useLocation();
  const logout = useLogout();
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
            <Ban className="h-7 w-7 text-red-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Cuenta inhabilitada</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Hola {name}, tu cuenta está inhabilitada. No puedes marcar asistencia ni votar. Si crees que es un error, contacta a la administración de la FECh.
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => logout.mutate(undefined, { onSuccess: () => setLocation("/login") })}
          >
            Cerrar sesión
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function AuthGuard({ children, allowedRole }: { children: React.ReactNode, allowedRole?: "admin" | "miembro" }) {
  const { data: user, isLoading, isError } = useGetMe();
  const [, setLocation] = useLocation();

  // Flip to the disabled screen the instant an admin deactivates this account,
  // instead of waiting for the next /auth/me refetch.
  useUserLive();

  const disabled = !!user && user.rol !== "admin" && user.active === false;

  useEffect(() => {
    if (!isLoading) {
      if (isError || !user) {
        setLocation("/login");
      } else if (disabled) {
        // Stay put; the disabled screen renders below.
      } else if (allowedRole && user.rol !== allowedRole) {
        setLocation(user.rol === "admin" ? "/admin" : "/member");
      } else if (window.location.pathname === "/" || window.location.pathname === "") {
        setLocation(user.rol === "admin" ? "/admin" : "/member");
      }
    }
  }, [user, isLoading, isError, allowedRole, setLocation, disabled]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  }

  if (isError || !user) {
    return null;
  }

  if (disabled) {
    return <DisabledAccountScreen name={user.displayName} />;
  }

  if (allowedRole && user.rol !== allowedRole) {
    return null;
  }

  return <>{children}</>;
}
