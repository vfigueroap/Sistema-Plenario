import { useGetMe } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout";
import {
  LogIn, UserCheck, Vote, History, KeyRound, Hand,
  CalendarPlus, DoorOpen, QrCode, ListChecks, Gauge, Users, Download,
  type LucideIcon,
} from "lucide-react";

interface Step {
  icon: LucideIcon;
  title: string;
  desc: string;
}

const memberSteps: Step[] = [
  {
    icon: LogIn,
    title: "Inicia sesión",
    desc: "Entra con el usuario y la contraseña que te entregó la administración por un canal privado. Cambia tu contraseña desde “Ajustes”.",
  },
  {
    icon: UserCheck,
    title: "Marca tu asistencia",
    desc: "Cuando haya una sesión abierta, en el Panel escribe el código que muestra la mesa o pulsa “Escanear código QR” para leerlo con la cámara de tu celular. Luego presiona “Registrar Asistencia”. Debes estar presente para poder votar.",
  },
  {
    icon: Vote,
    title: "Vota en cada moción",
    desc: "En “Mociones Abiertas” pulsa “Votar ahora”, elige A Favor, En Contra o Abstención y confirma. Tu voto pesa según tu ponderación.",
  },
  {
    icon: Hand,
    title: "Pide la palabra",
    desc: "Solo cuando la mesa abra la ronda de palabras podrás pedir la palabra: en “Sistema de Palabra” elige tu categoría y el punto de la tabla y presiona “Pedir la palabra”. Mientras la ronda esté cerrada el botón aparece deshabilitado, pero igual puedes ver la cola de oradores.",
  },
  {
    icon: History,
    title: "Revisa tu historial",
    desc: "En “Historial” ves cada sesión: si asististe, cómo votaste en cada moción y los resultados ponderados que ve todo el mundo.",
  },
  {
    icon: KeyRound,
    title: "Cambia tu contraseña",
    desc: "En “Ajustes” puedes actualizar tu contraseña y tu correo de recuperación cuando quieras.",
  },
];

const adminSteps: Step[] = [
  {
    icon: CalendarPlus,
    title: "Crea una sesión",
    desc: "En el Panel usa “Nueva Sesión” e ingresa título, lugar y fecha. La sesión se crea cerrada.",
  },
  {
    icon: DoorOpen,
    title: "Abre la sesión",
    desc: "Entra al detalle de la sesión y presiona “Reabrir Sesión” para abrirla. Solo con la sesión abierta les miembres pueden marcar asistencia y votar.",
  },
  {
    icon: QrCode,
    title: "Comparte el código o QR",
    desc: "Muestra en pantalla el código de la sesión o su código QR para que les miembres registren su asistencia.",
  },
  {
    icon: ListChecks,
    title: "Crea las mociones",
    desc: "Dentro de la sesión, en “Mociones propuestas”, agrega cada moción y presiona “Reabrir” para abrir esa votación.",
  },
  {
    icon: Gauge,
    title: "Cierra y revisa resultados",
    desc: "Presiona “Cerrar moción” para fijar el resultado ponderado de cada moción (Aprobado o Rechazado). Los resultados se actualizan en tiempo real.",
  },
  {
    icon: Hand,
    title: "Gestiona la ronda de palabras",
    desc: "En “Sistema de Palabra” usa “Abrir ronda” para que les miembres puedan pedir la palabra; “Cerrar ronda” lo desactiva. Puedes agregar oradores manualmente y armar una palabra colectiva que suma los minutos de todo el grupo de consejeres de una Unidad Académica (estén presentes o no).",
  },
  {
    icon: KeyRound,
    title: "Gestiona contraseñas",
    desc: "En “Miembres” puedes restablecer una contraseña con el botón “Contraseña”. No es posible consultar contraseñas guardadas. Entrega la nueva contraseña a la persona por un canal privado.",
  },
  {
    icon: Users,
    title: "Ajusta ponderaciones",
    desc: "En “Miembres” haz clic sobre la ponderación de une miembre para editar cuánto pesa su voto.",
  },
  {
    icon: History,
    title: "Consulta el histórico",
    desc: "En “Histórico” revisas todas las sesiones con sus mociones, resultados ponderados y resumen de asistencia.",
  },
  {
    icon: Download,
    title: "Exporta a Excel",
    desc: "En el detalle de la sesión descargas la Asistencia, los Resultados y la Matriz de Votos en Excel.",
  },
];

const palette = [
  { border: "border-l-red-500", dot: "bg-red-500", soft: "bg-red-50", icon: "text-red-600" },
  { border: "border-l-amber-400", dot: "bg-amber-400", soft: "bg-amber-50", icon: "text-amber-600" },
  { border: "border-l-lime-500", dot: "bg-lime-500", soft: "bg-lime-50", icon: "text-lime-600" },
  { border: "border-l-sky-500", dot: "bg-sky-500", soft: "bg-sky-50", icon: "text-sky-600" },
];

function StepList({ steps }: { steps: Step[] }) {
  return (
    <div className="space-y-3">
      {steps.map((s, i) => {
        const c = palette[i % palette.length];
        const Icon = s.icon;
        return (
          <div
            key={i}
            className={`flex gap-4 rounded-xl border border-l-4 ${c.border} bg-white p-5 shadow-sm`}
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${c.dot} font-bold text-white`}
            >
              {i + 1}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${c.soft} ${c.icon}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="text-lg font-semibold">{s.title}</h3>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Help() {
  const { data: user } = useGetMe();
  const isAdmin = user?.rol === "admin";
  const steps = isAdmin ? adminSteps : memberSteps;

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="h-1.5 fech-stripe" />
          <div className="p-6">
            <h1 className="text-2xl font-bold text-gray-900">¿Cómo usarme?</h1>
            <p className="mt-1 text-muted-foreground">
              {isAdmin
                ? "Guía paso a paso para administrar las sesiones plenarias, las mociones, la palabra y las cuentas."
                : "Guía paso a paso para participar: marcar tu asistencia, votar, pedir la palabra y gestionar tu cuenta."}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-lime-500" /> A favor</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-yellow-400" /> Abstención</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-red-500" /> En contra</span>
            </div>
          </div>
        </div>

        <StepList steps={steps} />
      </div>
    </AppLayout>
  );
}
