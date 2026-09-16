import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useLogout, useGetMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetClose, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { RealtimeStatusBadge } from "@/components/realtime-status-badge";
import { RealtimeOfflineNotice } from "@/components/realtime-offline-notice";

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "border-b-2 pb-0.5 transition-colors",
        active ? "border-white font-medium" : "border-transparent hover:border-white/50",
      )}
    >
      {children}
    </Link>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: user } = useGetMe();
  const logout = useLogout();
  const [location, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    setMenuOpen(false);
    logout.mutate(undefined, {
      onSuccess: () => setLocation("/login")
    });
  };

  const navItems =
    user?.rol === "admin"
      ? [
          { href: "/admin", label: "Panel" },
          { href: "/admin/messages", label: "Mensajería" },
          { href: "/admin/members", label: "Miembres" },
        ]
      : user?.rol === "miembro"
        ? [
            { href: "/member", label: "Panel" },
            { href: "/member/history", label: "Historial" },
            { href: "/member/messages", label: "Mensajería" },
          ]
        : [];

  const secondaryItems = [
    { href: "/ayuda", label: "¿Cómo usarme?" },
    { href: "/settings", label: "Ajustes" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="shadow-sm">
        <div className="h-1.5 fech-stripe" />
        <div className="bg-primary text-primary-foreground">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="font-bold text-lg tracking-tight flex gap-4 items-center">
              <span className="flex items-center gap-2">
                <span className="flex gap-0.5" aria-hidden>
                  <span className="h-3 w-3 rounded-full bg-red-500" />
                  <span className="h-3 w-3 rounded-full bg-yellow-400" />
                  <span className="h-3 w-3 rounded-full bg-lime-500" />
                </span>
                FECh Plenario
              </span>
              {navItems.length > 0 && (
                <nav className="hidden md:flex gap-4 ml-6 text-sm font-normal">
                  {navItems.map((item) => (
                    <NavLink key={item.href} href={item.href} active={location === item.href}>
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
              )}
            </div>

            {/* Acciones de escritorio */}
            <div className="hidden md:flex items-center gap-4 text-sm">
              <RealtimeStatusBadge />
              <span className="hidden sm:inline">{user?.displayName}</span>
              <Link href="/ayuda" className="hover:underline">¿Cómo usarme?</Link>
              <Link href="/settings" className="hover:underline">Ajustes</Link>
              <Button variant="secondary" size="sm" onClick={handleLogout} disabled={logout.isPending}>Salir</Button>
            </div>

            {/* Menú móvil */}
            <div className="md:hidden">
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="secondary" size="icon" aria-label="Abrir menú">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72">
                  <SheetHeader className="text-left">
                    <SheetTitle>Menú</SheetTitle>
                  </SheetHeader>
                  <div className="mt-1 flex items-center gap-3">
                    {user?.displayName && (
                      <span className="text-sm text-muted-foreground">{user.displayName}</span>
                    )}
                    <RealtimeStatusBadge className="bg-muted text-muted-foreground" />
                  </div>
                  <nav className="mt-6 flex flex-col gap-1 text-base">
                    {navItems.map((item) => (
                      <SheetClose asChild key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            "rounded-md px-3 py-2 transition-colors",
                            location === item.href ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
                          )}
                        >
                          {item.label}
                        </Link>
                      </SheetClose>
                    ))}
                    <div className="my-2 border-t" />
                    {secondaryItems.map((item) => (
                      <SheetClose asChild key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            "rounded-md px-3 py-2 transition-colors",
                            location === item.href ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted",
                          )}
                        >
                          {item.label}
                        </Link>
                      </SheetClose>
                    ))}
                  </nav>
                  <Button
                    variant="outline"
                    className="mt-6 w-full"
                    onClick={handleLogout}
                    disabled={logout.isPending}
                  >
                    Salir
                  </Button>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>
      <RealtimeOfflineNotice />
      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
