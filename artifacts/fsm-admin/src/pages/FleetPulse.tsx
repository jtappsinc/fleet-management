import { useState } from "react";
import { Link } from "wouter";
import { useGetFleetPulse, useGetMe } from "@workspace/api-client-react";
import { useDepartmentFilter } from "@/context/DepartmentContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Activity,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Wrench,
  TrendingUp,
  DollarSign,
  ArrowRight,
  UserCheck,
  Package,
  HardHat,
  Users,
  Calculator,
  Receipt,
  Sparkles,
  Shield,
  UserPlus,
  Boxes,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";

const usd = (cents: number | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);

const num = (n: number) => new Intl.NumberFormat("en-US").format(n);

function monthLabel(key: string) {
  // key like "2025-04"
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short" });
}

type ChartView = "MONTHLY" | "YEARLY";
type PeriodKey = "MTD" | "YTD" | "LIFETIME";

// Quick-action shortcuts shown at the top of the home dashboard. Each
// tile is a one-click jump into a major section of the app, ordered
// by how often a foreman/admin needs them. Visibility honors the same
// role gates as the sidebar (Shell.tsx NAV_GROUPS): admin-only links
// are filtered out for non-admin viewers so the grid never shows a
// shortcut they can't follow.
type QuickAction = {
  href: string;
  label: string;
  description: string;
  icon: typeof Activity;
  roles?: ReadonlyArray<string>;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    href: "/assets",
    label: "Asset Registry",
    description: "Trucks, trailers & equipment",
    icon: Package,
  },
  {
    href: "/maintenance",
    label: "Maintenance Log",
    description: "Repairs, inspections, costs",
    icon: Wrench,
  },
  {
    href: "/shop-supplies",
    label: "Shop Supplies",
    description: "Stock on hand & prices",
    icon: Boxes,
  },
  {
    href: "/crews",
    label: "Crews",
    description: "Field crews & assignments",
    icon: HardHat,
  },
  {
    href: "/employees",
    label: "Crew & Members",
    description: "Roster, roles, activity",
    icon: Users,
  },
  {
    href: "/team",
    label: "Invite Team",
    description: "Add users, set permissions",
    icon: UserPlus,
    roles: ["ADMIN"],
  },
  {
    href: "/delete-requests",
    label: "Delete Approvals",
    description: "Review pending deletes",
    icon: Shield,
    roles: ["ADMIN"],
  },
  {
    href: "/accounting",
    label: "Accounting",
    description: "Spend by department",
    icon: Calculator,
    roles: ["ADMIN", "ACCOUNTING_MANAGER"],
  },
  {
    href: "/accounting?tab=assets",
    label: "Cost per Asset",
    description: "What each truck costs",
    icon: TrendingUp,
    roles: ["ADMIN", "ACCOUNTING_MANAGER"],
  },
  {
    href: "/accounting?tab=expenses",
    label: "Expense Categories",
    description: "Labor, parts, fuel breakdown",
    icon: Receipt,
    roles: ["ADMIN", "ACCOUNTING_MANAGER"],
  },
  // Keep AI Assistant last so the tile order matches the sidebar.
  {
    href: "/assistant",
    label: "AI Assistant",
    description: "Ask anything about the fleet",
    icon: Sparkles,
    roles: ["ADMIN", "ACCOUNTING_MANAGER"],
  },
];

function QuickActions({ role }: { role: string | null | undefined }) {
  const visible = QUICK_ACTIONS.filter((a) => {
    if (!a.roles) return true;
    if (!role) return false;
    return a.roles.includes(role);
  });
  if (visible.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Jump to
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className="group flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 transition-all hover:border-primary/60 hover:bg-accent/30 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{action.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {action.description}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function FleetPulse() {
  const { activeDeptId } = useDepartmentFilter();
  const { data, isLoading } = useGetFleetPulse(activeDeptId != null ? { departmentId: activeDeptId } : {});
  const { data: meData } = useGetMe();
  const role = meData?.user?.role ?? null;
  const [chartView, setChartView] = useState<ChartView>("MONTHLY");
  const [period, setPeriod] = useState<PeriodKey>("MTD");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const counts = (data?.counts ?? {
    active: 0,
    inShop: 0,
    outOfService: 0,
    down: 0,
    openRepairs: 0,
    checkedOut: 0,
    withImage: 0,
    total: 0,
  }) as {
    active: number;
    inShop: number;
    outOfService: number;
    down: number;
    openRepairs: number;
    checkedOut?: number;
    withImage?: number;
    total: number;
  };
  const overdue = data?.overdue ?? [];
  const dueSoon = data?.dueSoon ?? [];
  const monthly = data?.monthlySpend ?? [];
  // yearlySpend is a v2 addition — orval types may not include it yet.
  const yearly = ((data as { yearlySpend?: Array<{ year: string; totalCents: number; laborCents: number; partsCents: number }> })?.yearlySpend ?? []);
  const moneyPits = data?.topMoneyPits ?? [];
  const recent = data?.recentMaintenance ?? [];
  const totals = data?.totals ?? {
    mtdCents: 0,
    last30DaysCents: 0,
    ytdCents: 0,
    lifetimeCents: 0,
  };

  const monthlyChart = monthly.map((m) => ({
    label: monthLabel(m.month),
    total: (m.totalCents ?? 0) / 100,
    labor: (m.laborCents ?? 0) / 100,
    parts: (m.partsCents ?? 0) / 100,
  }));
  const yearlyChart = yearly.map((y) => ({
    label: y.year,
    total: (y.totalCents ?? 0) / 100,
    labor: (y.laborCents ?? 0) / 100,
    parts: (y.partsCents ?? 0) / 100,
  }));
  const chartData = chartView === "MONTHLY" ? monthlyChart : yearlyChart;
  const periodValue =
    period === "MTD"
      ? totals.mtdCents
      : period === "YTD"
        ? totals.ytdCents
        : totals.lifetimeCents;
  const periodLabel =
    period === "MTD" ? "This month" : period === "YTD" ? "This year" : "All time";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fleet & Shop"
        title="Fleet Pulse"
        description="One screen to know if every truck and chainsaw is healthy — and where the money is going."
        icon={<Activity className="h-5 w-5" />}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/assets">
              <Wrench className="mr-2 h-4 w-4" /> Asset Registry
            </Link>
          </Button>
        }
      />

      <QuickActions role={role} />

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
        <KpiCard
          label="Active"
          value={num(counts.active)}
          sub={`of ${counts.total} total`}
          icon={CheckCircle2}
          tone="emerald"
        />
        <KpiCard
          label="Down"
          value={num(counts.down)}
          sub="out of service"
          icon={AlertTriangle}
          tone={counts.down > 0 ? "rose" : "neutral"}
        />
        <KpiCard
          label="Open Repairs"
          value={num(counts.openRepairs)}
          sub={`${overdue.length} overdue · ${dueSoon.length} due soon`}
          icon={Wrench}
          tone={counts.openRepairs > 0 ? "amber" : "neutral"}
        />
        <KpiCard
          label="Checked Out"
          value={num(counts.checkedOut ?? 0)}
          sub="currently with a person"
          icon={UserCheck}
          tone={(counts.checkedOut ?? 0) > 0 ? "amber" : "neutral"}
        />
        <PeriodKpiCard
          period={period}
          onPeriodChange={setPeriod}
          value={usd(periodValue)}
          label={periodLabel}
          totals={totals}
        />
      </div>

      <Card className="border-border/60">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            {chartView === "MONTHLY" ? "Monthly" : "Yearly"} Maintenance Spend
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {chartView === "MONTHLY" ? "Last 12 months" : "Last 5 years"}
            </span>
          </CardTitle>
          <div className="inline-flex overflow-hidden rounded-md border" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={chartView === "MONTHLY"}
              data-testid="chart-view-monthly"
              className={`px-3 py-1.5 text-xs font-medium ${chartView === "MONTHLY" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              onClick={() => setChartView("MONTHLY")}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chartView === "YEARLY"}
              data-testid="chart-view-yearly"
              className={`px-3 py-1.5 text-xs font-medium ${chartView === "YEARLY" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              onClick={() => setChartView("YEARLY")}
            >
              Yearly
            </button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full" data-testid="monthly-spend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${Math.round(Number(v))}`}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [
                    `$${value.toFixed(2)}`,
                    name === "total" ? "Total" : name,
                  ]}
                />
                <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, idx) => (
                    <Cell key={idx} fill="hsl(var(--accent))" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <ServiceList
          title="Overdue"
          items={overdue}
          icon={AlertTriangle}
          tone="rose"
          emptyText="Nothing overdue. "
          testid="overdue-list"
        />
        <ServiceList
          title="Due Soon"
          items={dueSoon}
          icon={Clock}
          tone="amber"
          emptyText="Nothing due in the near term."
          testid="due-soon-list"
        />
        <Card className="border-border/60" data-testid="money-pits" id="money-pits-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-rose-600" />
              Top 5 Money Pits
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Ranked by year-to-date spend
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {moneyPits.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                No spend recorded yet.
              </div>
            ) : (
              <ol className="divide-y">
                {moneyPits.map((m, i) => (
                  <li key={`${m.kind}-${m.id}`} className="px-6 py-3">
                    <Link
                      href={`/assets/${m.slug}`}
                      className="flex items-center justify-between gap-3 hover:underline"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-mono text-xs text-muted-foreground">
                          #{i + 1}
                        </span>
                        <span className="truncate text-sm font-medium">{m.name}</span>
                      </span>
                      <span className="text-right">
                        <span className="block font-mono text-sm font-semibold">
                          {usd(m.ytdSpendCents)}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          LTD {usd(m.lifeToDateSpendCents)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60" data-testid="recent-maintenance">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wrench className="h-4 w-4" /> Recent Maintenance
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Last 8 entries
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              No maintenance has been logged yet.
            </div>
          ) : (
            <ul className="divide-y">
              {recent.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 px-6 py-3"
                >
                  <Link
                    href={`/assets/${r.assetSlug}`}
                    className="min-w-0 hover:underline"
                  >
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="font-mono text-[10px] uppercase"
                      >
                        {r.kind}
                      </Badge>
                      <span className="truncate text-sm font-medium">
                        {r.assetName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.performedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.description}
                    </div>
                  </Link>
                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold">
                      {usd(r.costCents)}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {usd(r.laborCostCents)} labor · {usd(r.partsCostCents)} parts
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "rose" | "amber" | "emerald";
}) {
  const toneClass =
    tone === "rose"
      ? "text-rose-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "emerald"
          ? "text-emerald-700"
          : "text-foreground";
  return (
    <Card className="kpi-tile border-border/60 transition-shadow hover:shadow-md">
      <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
        <div className="min-w-0">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </div>
          <div className={`mt-2 text-2xl font-bold tracking-tight ${toneClass}`}>
            {value}
          </div>
          {sub && (
            <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
          )}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-foreground/80 ring-1 ring-inset ring-accent/15">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function ServiceList({
  title,
  items,
  icon: Icon,
  tone,
  emptyText,
  testid,
}: {
  title: string;
  items: Array<{
    kind: string;
    id: number;
    slug: string;
    name: string;
    usageUntilDue: number;
    usageUnit: "MILES" | "HOURS";
  }>;
  icon: React.ComponentType<{ className?: string }>;
  tone: "rose" | "amber";
  emptyText: string;
  testid: string;
}) {
  const toneClass = tone === "rose" ? "text-rose-600" : "text-amber-600";
  return (
    <Card className="border-border/60" data-testid={testid}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className={`h-4 w-4 ${toneClass}`} />
          {title}
          <Badge variant="outline" className="ml-1">
            {items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            {emptyText}
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((m) => (
              <li key={`${m.kind}-${m.id}`} className="px-6 py-3">
                <Link
                  href={`/assets/${m.slug}`}
                  className="flex items-center justify-between gap-3 hover:underline"
                >
                  <span className="truncate text-sm font-medium">{m.name}</span>
                  <span className="flex items-center gap-2">
                    <span className={`font-mono text-xs ${toneClass}`}>
                      {m.usageUntilDue >= 0
                        ? `${num(m.usageUntilDue)} ${m.usageUnit.toLowerCase()}`
                        : `−${num(Math.abs(m.usageUntilDue))} ${m.usageUnit.toLowerCase()}`}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// Compact KPI tile that doubles as a period selector — clicking a chip
// swaps the headline figure to MTD / YTD / All-time without leaving the
// dashboard. The three subtotals stay visible underneath so the
// comparison is always one glance away.
function PeriodKpiCard({
  period,
  onPeriodChange,
  value,
  label,
  totals,
}: {
  period: PeriodKey;
  onPeriodChange: (p: PeriodKey) => void;
  value: string;
  label: string;
  totals: { mtdCents: number; ytdCents: number; lifetimeCents: number };
}) {
  return (
    <Card className="border-border/60" data-testid="period-kpi">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            Spend · {label}
          </div>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        <div className="mt-2 inline-flex overflow-hidden rounded-md border">
          {(["MTD", "YTD", "LIFETIME"] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`px-2 py-0.5 text-[10px] font-semibold ${period === p ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
              onClick={() => onPeriodChange(p)}
              data-testid={`period-${p.toLowerCase()}`}
            >
              {p === "MTD" ? "Month" : p === "YTD" ? "Year" : "All time"}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
          <div>
            <div className="font-mono">{usd(totals.mtdCents)}</div>
            <div>month</div>
          </div>
          <div>
            <div className="font-mono">{usd(totals.ytdCents)}</div>
            <div>year</div>
          </div>
          <div>
            <div className="font-mono">{usd(totals.lifetimeCents)}</div>
            <div>all-time</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
