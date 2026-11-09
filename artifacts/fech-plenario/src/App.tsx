import { Switch, Route, Router as WouterRouter } from "wouter";
import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGuard } from "@/lib/auth-guard";
import { usesRealtimePolling } from "@/lib/realtime";
const Login = lazy(() => import("@/pages/login"));
const AdminDashboard = lazy(() => import("@/pages/admin/dashboard"));
const AdminSessionDetail = lazy(() => import("@/pages/admin/session-detail"));
const AdminMembers = lazy(() => import("@/pages/admin/members"));
const AdminMessages = lazy(() => import("@/pages/admin/messages"));
const MemberDashboard = lazy(() => import("@/pages/member/dashboard"));
const MemberVote = lazy(() => import("@/pages/member/vote"));
const MemberHistory = lazy(() => import("@/pages/member/history"));
const MemberMessages = lazy(() => import("@/pages/member/messages"));
const Settings = lazy(() => import("@/pages/settings"));
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const PublicHome = lazy(() => import("@/pages/public-home"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: !usesRealtimePolling,
      staleTime: 10_000,
      retry: (attempt, error) => attempt < 1 && !("status" in error && [400, 401, 403, 404, 409, 429].includes(Number(error.status))),
      retryDelay: (attempt) => Math.min(30000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 1000),
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Suspense fallback={<div className="flex h-screen items-center justify-center">Cargando…</div>}>
          <Switch>
            <Route path="/login" component={Login} />
            <Route path="/forgot-password" component={ForgotPassword} />

            <Route path="/admin">
              <AuthGuard allowedRole="admin"><AdminDashboard /></AuthGuard>
            </Route>
            <Route path="/admin/sessions/:id">
              <AuthGuard allowedRole="admin"><AdminSessionDetail /></AuthGuard>
            </Route>
            <Route path="/admin/members">
              <AuthGuard allowedRole="admin"><AdminMembers /></AuthGuard>
            </Route>
            <Route path="/admin/messages">
              <AuthGuard allowedRole="admin"><AdminMessages /></AuthGuard>
            </Route>

            <Route path="/member">
              <AuthGuard allowedRole="miembro"><MemberDashboard /></AuthGuard>
            </Route>
            <Route path="/member/vote/:topicId">
              <AuthGuard allowedRole="miembro"><MemberVote /></AuthGuard>
            </Route>
            <Route path="/member/history">
              <AuthGuard allowedRole="miembro"><MemberHistory /></AuthGuard>
            </Route>
            <Route path="/member/messages">
              <AuthGuard allowedRole="miembro"><MemberMessages /></AuthGuard>
            </Route>

            <Route path="/settings">
              <AuthGuard><Settings /></AuthGuard>
            </Route>

            <Route path="/" component={PublicHome} />

            <Route>
              <div className="flex h-screen items-center justify-center">No encontrado</div>
            </Route>
          </Switch>
          </Suspense>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
