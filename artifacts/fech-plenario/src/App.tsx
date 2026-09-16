import { Switch, Route, Router as WouterRouter } from "wouter";
import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthGuard } from "@/lib/auth-guard";
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
const Help = lazy(() => import("@/pages/help"));
const ForgotPassword = lazy(() => import("@/pages/forgot-password"));
const PublicHome = lazy(() => import("@/pages/public-home"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Realtime (Socket.io) is the instant path; polling is only a fallback.
      // Disabling focus refetch avoids refetch storms when ~200 attendees
      // switch tabs during a session. Reconnect refetch closes gaps after a
      // network blip; a short staleTime de-dupes bursts of identical fetches.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 10_000,
      retry: 1,
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
            <Route path="/ayuda">
              <AuthGuard><Help /></AuthGuard>
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
