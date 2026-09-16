import { useState } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const loginMutation = useLogin();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const formatRetryAfter = (seconds: number): string => {
    if (seconds >= 60) {
      const minutes = Math.ceil(seconds / 60);
      return `Intenta de nuevo en ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.`;
    }
    const secs = Math.max(1, seconds);
    return `Intenta de nuevo en ${secs} ${secs === 1 ? "segundo" : "segundos"}.`;
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { username, password } }, {
      onSuccess: (user) => {
        if (user.rol === "admin") {
          setLocation("/admin");
        } else {
          setLocation("/member");
        }
      },
      onError: (error) => {
        if (error.status === 429) {
          const retryHeader = error.headers?.get("Retry-After");
          const retrySeconds = retryHeader ? parseInt(retryHeader, 10) : NaN;
          const detail = Number.isFinite(retrySeconds)
            ? ` ${formatRetryAfter(retrySeconds)}`
            : "";
          toast({
            title: "Demasiados intentos fallidos",
            description: `Por seguridad, el acceso quedó bloqueado temporalmente.${detail}`,
            variant: "destructive",
          });
          return;
        }
        toast({ title: "Error", description: "Credenciales incorrectas", variant: "destructive" });
      }
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm mb-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setLocation("/")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" /> Panel público
        </Button>
      </div>
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight bg-gradient-to-r from-red-600 via-amber-500 to-lime-600 bg-clip-text text-transparent">FECh Plenario</h1>
        <p className="text-muted-foreground mt-2">Sistema de Votación Ponderada</p>
      </div>

      <Card className="w-full max-w-sm overflow-hidden">
        <div className="h-1.5 fech-stripe" />
        <CardHeader>
          <CardTitle>Iniciar Sesión</CardTitle>
          <CardDescription>Ingresa tus credenciales para continuar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? "Ingresando..." : "Ingresar"}
            </Button>
            <Link href="/forgot-password" className="text-sm text-muted-foreground hover:underline block text-center">
              ¿Olvidaste tu contraseña?
            </Link>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
