import { useLogout, useGetMe, useListDepartments } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  LogOut,
  Users,
  UserPlus,
  Wrench,
  Menu,
  Activity,
  Package,
  Building2,
  Calculator,
  HardHat,
  Receipt,
  TrendingUp,
  Truck,
  Sparkles,
  Shield,
  Download,
  Loader2,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { useUrlSearch } from "@/lib/use-url-search";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { DepartmentProvider, useDepartmentFilter } from "@/context/DepartmentContext";
import { usePendingDeleteRequestCount } from "@/lib/extra-api";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Users;
  // Roles permitted to see this nav entry. ADMIN always sees everything.
  roles?: ReadonlyArray<string>;
  // Opt into a dynamic badge (e.g. "3" pending-delete requests).
  // The Shell knows how to resolve each kind to a live count.
  badgeKind?: "pending-deletes";
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Fleet & Shop",
    items: [
      { href: "/fleet", label: "Fleet Pulse", icon: Activity },
      { href: "/assets", label: "Asset Registry", icon: Package },
      { href: "/maintenance", label: "Maintenance Log", icon: Wrench },
      { href: "/crews", label: "Crews", icon: HardHat },
      { href: "/employees", label: "Crew & Members", icon: Users },
      {
        href: "/team",
        label: "Invite Team",
        icon: UserPlus,
        roles: ["ADMIN"],
      },
      {
        href: "/delete-requests",
        label: "Delete Approvals",
        icon: Shield,
        roles: ["ADMIN"],
        badgeKind: "pending-deletes",
      },
    ],
  },
  {
    label: "Accounting",
    items: [
      {
        href: "/accounting",
        label: "By Department",
        icon: Calculator,
        roles: ["ADMIN", "ACCOUNTING_MANAGER"],
      },
      {
        href: "/accounting?tab=assets",
        label: "Per Asset",
        icon: Truck,
        roles: ["ADMIN", "ACCOUNTING_MANAGER"],
      },
      {
        href: "/accounting?tab=expenses",
        label: "Expense Categories",
        icon: Receipt,
        roles: ["ADMIN", "ACCOUNTING_MANAGER"],
      },
      {
        href: "/accounting?tab=trends",
        label: "Trends",
        icon: TrendingUp,
        roles: ["ADMIN", "ACCOUNTING_MANAGER"],
      },
    ],
  },
  // AI Assistant sits last in the sidebar on purpose — it's a power-user
  // tool that lives alongside the operational sections rather than
  // above them. Anchoring it to the bottom keeps daily-use links
  // (Fleet, Maintenance, Crews, Accounting) closest to the top.
  {
    label: "AI",
    items: [
      {
        href: "/assistant",
        label: "Assistant",
        icon: Sparkles,
        roles: ["ADMIN", "ACCOUNTING_MANAGER"],
      },
    ],
  },
];

function Brand({ inHeader = false }: { inHeader?: boolean }) {
  return (
    <div className="flex items-center">
      <img
        src={`${import.meta.env.BASE_URL}logo.png`}
        alt="Joshua Tree"
        className={`object-contain ${inHeader ? "h-8" : "h-9"}`}
        style={{ maxWidth: inHeader ? 140 : 155 }}
      />
    </div>
  );
}

function DepartmentSwitcher() {
  const { isAdmin } = useDepartmentFilter();
  if (!isAdmin) return null;
  return <DepartmentSwitcherInner />;
}

function DepartmentSwitcherInner() {
  const { activeDeptId, setActiveDeptId } = useDepartmentFilter();
  const { data: deptsData } = useListDepartments();

  const HIDDEN_DEPT_KEYS = ["Admin"];
  const depts = (deptsData?.departments ?? []).filter(
    (d) => !HIDDEN_DEPT_KEYS.includes(d.key),
  );
  const value = activeDeptId == null ? "all" : String(activeDeptId);

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <Select
        value={value}
        onValueChange={(v) =>
          setActiveDeptId(v === "all" ? undefined : parseInt(v, 10))
        }
      >
        <SelectTrigger className="h-auto border-0 p-0 text-xs font-medium shadow-none focus:ring-0 w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Departments</SelectItem>
          {depts.map((d) => (
            <SelectItem key={d.id} value={String(d.id)}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { data: authData } = useGetMe();
  const [location, setLocation] = useLocation();
  const currentSearch = useUrlSearch();
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const logoutMutation = useLogout();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/admin/export", { credentials: "include" });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `joshua-tree-export-${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Silently ignore — user will see nothing happened and can retry.
    } finally {
      setIsExporting(false);
    }
  };
  const queryClient = useQueryClient();
  // Pending-delete badge powering the "Delete Approvals" nav entry.
  // The hook is server-gated to ADMIN, so it returns { count: 0 }
  // for non-admin sessions — harmless to call from everyone here.
  const { data: pendingDeletes } = usePendingDeleteRequestCount();
  const pendingDeletesCount = pendingDeletes?.count ?? 0;

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
        queryClient.clear();
        setLocation("/login");
      },
    });
  };

  const role = authData?.user?.role ?? null;
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.roles || (role != null && item.roles.includes(role)),
    ),
  })).filter((group) => group.items.length > 0);

  const NavLinks = () => (
    <nav className="flex flex-col gap-6 py-5">
      {visibleGroups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <div className="px-3 pb-2 text-[10px] font-mono font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/40">
            {group.label}
          </div>
          {group.items.map((item) => {
            // Items with `?tab=...` need the search string compared too;
            // wouter's location is path-only. The bare-path entry stays
            // active only when there's no `tab` query.
            const [itemPath, itemQuery = ""] = item.href.split("?");
            let isActive = false;
            if (location === itemPath) {
              if (itemQuery === "") {
                isActive = currentSearch === "" || !currentSearch.includes("tab=");
              } else {
                isActive = currentSearch.includes(itemQuery);
              }
            }
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-sidebar-primary/95 text-sidebar-primary-foreground shadow-sm"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:translate-x-0.5"
                }`}
                onClick={() => setIsMobileNavOpen(false)}
              >
                {/* Left accent bar on the active item. Subtle, but
                    makes the current location pop without shouting. */}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-accent"
                  />
                )}
                <Icon
                  className={`h-4 w-4 shrink-0 transition-colors ${
                    isActive
                      ? ""
                      : "text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground"
                  }`}
                />
                <span className="flex-1">{item.label}</span>
                {item.badgeKind === "pending-deletes" &&
                  pendingDeletesCount > 0 && (
                    <span
                      className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
                      title={`${pendingDeletesCount} deletion${pendingDeletesCount === 1 ? "" : "s"} awaiting approval`}
                    >
                      {pendingDeletesCount}
                    </span>
                  )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const UserCard = () => {
    const fullName = authData?.user?.fullName ?? "—";
    const initials = fullName
      .split(" ")
      .map((n) => n[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
    return (
      <div className="shrink-0 border-t border-sidebar-border bg-sidebar p-4 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.2)]">
        <div className="mb-3 flex items-start gap-3">
          <div
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-sidebar-foreground ring-1 ring-inset ring-sidebar-border"
          >
            {initials || "—"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sidebar-foreground">
              {fullName}
            </p>
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-sidebar-foreground/55">
              {authData?.user?.role ?? ""}
            </p>
            {authData?.user?.department && (
              <p className="mt-0.5 truncate text-[10px] text-sidebar-foreground/45">
                {authData.user.department}
              </p>
            )}
          </div>
        </div>
        {role === "ADMIN" && (
          <Button
            variant="outline"
            size="sm"
            disabled={isExporting}
            className="mb-2 w-full justify-start border-sidebar-border/60 bg-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-60"
            onClick={handleExport}
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {isExporting ? "Exporting…" : "Download Backup"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start border-sidebar-border/60 bg-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </Button>
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row bg-background">
      {/*
        Sticky + h-screen on the desktop sidebar keeps the brand
        header at the top and the user card (with the "Log out"
        button) pinned at the bottom of the viewport regardless of
        how tall the main content is. Without these, when a long
        page extends past the viewport, the sidebar stretches with
        the page and the logout button drifts off-screen.
      */}
      <aside className="sticky top-0 hidden h-screen w-64 flex-col border-r border-sidebar-border bg-gradient-to-b from-sidebar to-sidebar/95 text-sidebar-foreground md:flex">
        <div className="flex h-16 items-center border-b border-sidebar-border/60 px-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <NavLinks />
        </div>
        <UserCard />
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border/60 bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:h-16">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={isMobileNavOpen} onOpenChange={setIsMobileNavOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flex w-72 flex-col bg-sidebar p-0 text-sidebar-foreground"
              >
                <div className="flex h-16 items-center border-b border-sidebar-border px-5">
                  <Brand />
                </div>
                <div className="flex-1 overflow-y-auto px-3">
                  <NavLinks />
                </div>
                <UserCard />
              </SheetContent>
            </Sheet>
            <div className="md:hidden">
              <Brand inHeader />
            </div>
            <PageTrail visibleGroups={visibleGroups} />
          </div>
          <DepartmentSwitcher />
        </header>

        <main className="flex-1 overflow-y-auto bg-background">
          <div className="mx-auto max-w-7xl p-4 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

/**
 * Tiny breadcrumb-style trail rendered in the desktop header. Looks
 * up the current location against the navigation groups so the user
 * always knows where they are even after long scrolls — and never
 * has to read the URL bar to figure out which section they're in.
 *
 * Hidden on mobile because the brand mark already occupies the
 * available header real estate there.
 */
function PageTrail({
  visibleGroups,
}: {
  visibleGroups: Array<{ label: string; items: NavItem[] }>;
}) {
  const [location] = useLocation();
  const currentSearch = useUrlSearch();

  let group: { label: string; items: NavItem[] } | undefined;
  let item: NavItem | undefined;
  for (const g of visibleGroups) {
    for (const i of g.items) {
      const [itemPath, itemQuery = ""] = i.href.split("?");
      if (location !== itemPath) continue;
      if (itemQuery === "") {
        if (currentSearch === "" || !currentSearch.includes("tab=")) {
          group = g;
          item = i;
          break;
        }
      } else if (currentSearch.includes(itemQuery)) {
        group = g;
        item = i;
        break;
      }
    }
    if (item) break;
  }

  if (!item || !group) return null;

  return (
    <div className="hidden min-w-0 items-center gap-2 md:flex">
      <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        {group.label}
      </span>
      <span aria-hidden className="text-muted-foreground/40">
        /
      </span>
      <span className="truncate text-sm font-semibold text-foreground">
        {item.label}
      </span>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <DepartmentProvider>
      <ShellInner>{children}</ShellInner>
    </DepartmentProvider>
  );
}
