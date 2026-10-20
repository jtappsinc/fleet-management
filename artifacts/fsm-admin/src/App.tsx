import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGetMe } from "@workspace/api-client-react";
import { Spinner } from "@/components/ui/spinner";
import { Shell } from "@/components/layout/Shell";
import NotFound from "@/pages/not-found";

import { Login } from "@/pages/Login";
import { Customers } from "@/pages/Customers";
import { CustomerProfile } from "@/pages/CustomerProfile";
import { Leads } from "@/pages/Leads";
import { Jobs } from "@/pages/Jobs";
import { Quotes } from "@/pages/Quotes";
import { Invoices } from "@/pages/Invoices";
import { FleetPulse } from "@/pages/FleetPulse";
import { AssetRegistry } from "@/pages/AssetRegistry";
import { AssetActionPage } from "@/pages/AssetActionPage";
import { Maintenance } from "@/pages/Maintenance";
import { ShopSupplies } from "@/pages/ShopSupplies";
import { Employees } from "@/pages/Employees";
import { Permissions } from "@/pages/Permissions";
import { Accounting } from "@/pages/Accounting";
import { Crews } from "@/pages/Crews";
import { Assistant } from "@/pages/Assistant";
import { Setup } from "@/pages/Setup";
import { AcceptInvite } from "@/pages/AcceptInvite";
import { Team } from "@/pages/Team";
import { DeleteRequests } from "@/pages/DeleteRequests";
import { useNeedsSetup } from "@/lib/extra-api";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { data: authData, isLoading, error } = useGetMe();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && error) {
      // Preserve the originally requested path (incl. query/hash) so the user
      // lands back on it after they log in. Critical for QR-code deep-links
      // from /assets/:slug — scanning while logged out should still get you
      // there after auth.
      const search = window.location.search ?? "";
      const hash = window.location.hash ?? "";
      const next = `${location}${search}${hash}`;
      const target =
        next && next !== "/" && next !== "/login"
          ? `/login?next=${encodeURIComponent(next)}`
          : "/login";
      setLocation(target);
    }
  }, [isLoading, error, setLocation, location]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }

  if (error || !authData) {
    return null;
  }

  return <>{children}</>;
}

// First-boot gate: when the DB is empty, redirect every unauthed
// route to /setup so Joshua lands in the founder bootstrap form on
// the very first visit. Once a user exists, this hook flips and
// the gate becomes a no-op.
function SetupGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useNeedsSetup();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!data?.needsSetup) return;
    // Allow setup + invite-accept pages through; redirect everywhere
    // else so a brand-new deploy doesn't get stuck on /login with no
    // accounts to use.
    if (location === "/setup") return;
    if (location.startsWith("/invite/")) return;
    setLocation("/setup");
  }, [data, isLoading, location, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }
  return <>{children}</>;
}

function AppRouter() {
  return (
    <SetupGate>
      <Switch>
        {/* Public routes — outside AuthGuard. /invite/:token lets a
            new teammate claim their account without an existing
            session, and /setup is the founder bootstrap. */}
        <Route path="/setup" component={Setup} />
        <Route path="/invite/:token" component={AcceptInvite} />
        <Route path="/login" component={Login} />

        <Route path="/(.*)">
          <AuthGuard>
            <Shell>
              <Switch>
                <Route path="/">
                  <Redirect to="/fleet" />
                </Route>
                <Route path="/customers" component={Customers} />
                <Route path="/customers/:id" component={CustomerProfile} />
                <Route path="/leads" component={Leads} />
                <Route path="/jobs" component={Jobs} />
                <Route path="/quotes" component={Quotes} />
                <Route path="/invoices" component={Invoices} />
                <Route path="/fleet" component={FleetPulse} />
                <Route path="/assets" component={AssetRegistry} />
                <Route path="/assets/:slug" component={AssetActionPage} />
                <Route path="/maintenance" component={Maintenance} />
                <Route path="/shop-supplies" component={ShopSupplies} />
                <Route path="/crews" component={Crews} />
                <Route path="/team" component={Team} />
                <Route path="/delete-requests" component={DeleteRequests} />
                <Route path="/employees" component={Employees} />
                <Route path="/permissions" component={Permissions} />
                <Route path="/accounting" component={Accounting} />
                <Route path="/assistant" component={Assistant} />
                <Route component={NotFound} />
              </Switch>
            </Shell>
          </AuthGuard>
        </Route>
      </Switch>
    </SetupGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
