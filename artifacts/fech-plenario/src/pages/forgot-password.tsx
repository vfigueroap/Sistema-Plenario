import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, UserCog } from "lucide-react";

export default function ForgotPassword() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-primary tracking-tight">FECh Plenario</h1>
        <p className="text-muted-foreground mt-2">Recuperación de Contraseña</p>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>¿Olvidaste tu contraseña?</CardTitle>
          <CardDescription>
            Por seguridad, la recuperación de contraseñas la realiza la administración de la FECh.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <UserCog className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                Escríbele a{" "}
                <a
                  href="mailto:mesa@fech.cl"
                  className="font-semibold text-primary hover:underline"
                >
                  mesa@fech.cl
                </a>{" "}
                indicando tu nombre de usuario. La Mesa Directiva podrá restablecer tu contraseña o
                entregarte la actual.
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Una vez que tengas tu nueva contraseña, podrás cambiarla desde
            <span className="font-medium text-foreground"> Ajustes </span>
            cuando inicies sesión.
          </p>

          <Link
            href="/login"
            className="text-primary text-sm font-medium hover:underline block text-center"
          >
            Volver al inicio de sesión
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
