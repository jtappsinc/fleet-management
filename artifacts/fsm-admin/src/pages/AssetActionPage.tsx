import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMe,
  useGetAssetBySlug,
  getGetAssetBySlugQueryKey,
  useCreateUsageReading,
  useCreateMaintenanceLog,
  useSetAssetStatus,
  useGetAssetStatusHistory,
  getGetAssetStatusHistoryQueryKey,
  getListMaintenanceLogsQueryKey,
  getListAssetsQueryKey,
  getGetFleetPulseQueryKey,
  useListDepartments,
  useUpdateTruck,
  useUpdateEquipment,
  useDeleteTruck,
  useDeleteEquipment,
} from "@workspace/api-client-react";
import {
  useListCrews,
  useAssignAsset,
  useAssignmentHistory,
  getAssignmentHistoryKey,
  useAssetImage,
  useUpdateAssetImage,
  useCheckoutHistory,
  useCheckOutAsset,
  useCheckInAsset,
  useListCrewLeadCandidates,
  useUpdateEquipmentExt,
  useEquipmentItems,
  useCreateEquipmentItem,
  useUpdateEquipmentItem,
  useDeleteEquipmentItem,
  getEquipmentItemsKey,
  useUpdateUsageReading,
  useDeleteUsageReading,
  DELETE_REQUESTS_PENDING_COUNT_KEY,
  type AssetExt,
  type EquipmentItem,
} from "@/lib/extra-api";
import { EditAssetButton } from "@/components/EditAssetDialog";
import { deleteOutcomeToast } from "@/lib/delete-outcome";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDepartmentFilter } from "@/context/DepartmentContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Truck,
  ArrowLeft,
  Wrench,
  Gauge,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Calendar,
  DollarSign,
  Tag,
  Printer,
  ShieldAlert,
  TrendingUp,
  History,
  User,
  Building2,
  Users as UsersIcon,
  Caravan,
  Hammer,
  Boxes,
  Hash,
  Camera,
  Upload,
  LogIn,
  LogOut,
  UserCheck,
  X,
  Pencil,
  Trash2,
  Package,
  Check,
} from "lucide-react";

const usd = (cents: number | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents ?? 0) / 100);

const num = (n: number) => new Intl.NumberFormat("en-US").format(n);

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Active";
  if (status === "IN_SHOP") return "In Shop";
  return "Out of Service";
}

function printQrLabel(name: string, slug: string, url: string) {
  // Serialize the QR SVG already rendered on the page so we don't pull
  // a remote QR generator (works offline, no extra deps).
  const svgEl = document.querySelector<SVGSVGElement>(
    "[data-testid='asset-qr-code']",
  );
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", "240");
  clone.setAttribute("height", "240");
  const svgMarkup = new XMLSerializer().serializeToString(clone);
  const win = window.open("", "qr-label", "width=420,height=520");
  if (!win) return;
  win.document.write(
    `<!doctype html><html><head><title>${escapeHtml(name)} — QR label</title>
    <style>
      body { font-family: 'Inter Tight', system-ui, sans-serif; padding: 16px; text-align: center; margin: 0; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .meta { font-family: ui-monospace, monospace; color: #555; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 12px; }
      .url { font-family: ui-monospace, monospace; font-size: 10px; color: #777; margin-top: 8px; word-break: break-all; }
      svg { display: block; margin: 0 auto; }
      @page { margin: 12mm; }
    </style></head><body>
      <h1>${escapeHtml(name)}</h1>
      <div class="meta">${escapeHtml(slug)}</div>
      ${svgMarkup}
      <div class="url">${escapeHtml(url)}</div>
      <script>setTimeout(function(){ window.print(); }, 50);</script>
    </body></html>`,
  );
  win.document.close();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function AssetActionPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { data, isLoading } = useGetAssetBySlug(slug);
  const { data: meData } = useGetMe();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!data?.asset) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/assets">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to registry
          </Link>
        </Button>
        <div className="rounded-md border bg-card py-16 text-center text-muted-foreground">
          Asset not found.
        </div>
      </div>
    );
  }

  // Widen the orval-generated asset type with our new fields, and drop
  // the narrower usageUnit so the AssetExt override (which knows about
  // "NONE") wins.
  const asset = data.asset as Omit<typeof data.asset, "usageUnit"> & AssetExt;
  const logs = data.logs ?? [];
  const recentReadings = data.recentReadings ?? [];
  const canEditAsset =
    meData?.user?.permissions?.[asset.kind === "TRUCK" ? "fleet.trucks" : "fleet.equipment"]?.canEdit ?? false;
  const canEditMaintenance = meData?.user?.permissions?.["fleet.maintenance"]?.canEdit ?? false;
  const qrUrl = `${window.location.origin}${window.location.pathname.replace(/\/assets\/.*/, "")}/assets/${asset.slug}`;
  const tracksUsage = asset.usageUnit !== "NONE";
  const CategoryIcon =
    asset.category === "TRUCK"
      ? Truck
      : asset.category === "TRAILER"
        ? Caravan
        : asset.category === "HANDHELD"
          ? Hammer
          : Boxes;
  const categoryDisplayLabel =
    asset.category === "CUSTOM"
      ? asset.customCategoryLabel || "Custom"
      : asset.category === "HANDHELD"
        ? "Handheld"
        : asset.category === "TRAILER"
          ? "Trailer"
          : "Truck";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/assets">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to registry
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="hidden font-mono text-[10px] uppercase tracking-wider sm:inline-flex"
          >
            {categoryDisplayLabel} · {asset.slug}
          </Badge>
          {canEditAsset && (
            <>
              <EditAssetButton asset={asset} variant="button" />
              <DeleteAssetButton kind={asset.kind} id={asset.id} name={asset.name} />
            </>
          )}
        </div>
      </div>

      <Card className="border-border/60">
        <CardContent className="grid gap-6 p-6 md:grid-cols-[auto_1fr_auto]">
          <AssetImageHero slug={asset.slug} hasImage={asset.hasImage} CategoryIcon={CategoryIcon} />
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-accent-foreground md:hidden">
                <CategoryIcon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{asset.name}</h1>
                <div className="text-sm text-muted-foreground">
                  {[asset.brand, asset.model].filter(Boolean).join(" · ") ||
                    "Make / model not set"}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[11px]">
                    {categoryDisplayLabel}
                  </Badge>
                  {asset.quantity > 1 && (
                    <Badge
                      variant="outline"
                      className="text-[11px] font-mono"
                      data-testid="asset-quantity-badge"
                    >
                      <Hash className="mr-1 h-3 w-3" />
                      qty {asset.quantity}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            {tracksUsage && (
              <ServiceStateBanner
                asset={
                  asset as Parameters<typeof ServiceStateBanner>[0]["asset"]
                }
              />
            )}
            {asset.departmentName && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span>{asset.departmentName}</span>
              </div>
            )}
            {asset.assignedCrewName ? (
              <div
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                data-testid="asset-current-crew"
              >
                <UsersIcon className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Assigned to{" "}
                  <span className="font-semibold text-foreground">
                    {asset.assignedCrewName}
                  </span>
                  {asset.lastAssignedByName && (
                    <>
                      {" "}
                      <span className="text-muted-foreground">
                        by {asset.lastAssignedByName}
                      </span>
                    </>
                  )}
                  {asset.lastAssignedAt && (
                    <>
                      {" "}
                      <span className="text-muted-foreground">
                        · {new Date(asset.lastAssignedAt).toLocaleDateString()}
                      </span>
                    </>
                  )}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                <UsersIcon className="h-3.5 w-3.5 shrink-0" />
                <span>Not assigned to any crew</span>
              </div>
            )}
            <HolderRibbon asset={asset} />
            <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-5">
              <Stat label="Status" value={statusLabel(asset.status)} icon={Tag} />
              {tracksUsage ? (
                <>
                  <Stat
                    label={asset.usageUnit === "MILES" ? "Odometer" : "Engine hours"}
                    value={`${num(asset.currentUsage)} ${asset.usageUnit === "MILES" ? "mi" : "hrs"}`}
                    icon={Gauge}
                  />
                  <Stat
                    label="Life-to-date"
                    value={usd(asset.lifeToDateSpendCents)}
                    icon={DollarSign}
                  />
                  <Stat
                    label={asset.usageUnit === "MILES" ? "Cost / mile" : "Cost / hour"}
                    value={
                      asset.costPerUsageCents != null
                        ? `${usd(asset.costPerUsageCents)}/${asset.usageUnit === "MILES" ? "mi" : "hr"}`
                        : "—"
                    }
                    icon={TrendingUp}
                  />
                </>
              ) : (
                <>
                  <Stat label="Quantity" value={num(asset.quantity)} icon={Hash} />
                  <Stat
                    label="Life-to-date"
                    value={usd(asset.lifeToDateSpendCents)}
                    icon={DollarSign}
                  />
                  <Stat
                    label="Crew"
                    value={asset.assignedCrewName ?? "Unassigned"}
                    icon={UsersIcon}
                  />
                </>
              )}
              <Stat
                label="Purchased"
                value={
                  asset.purchaseDate
                    ? new Date(asset.purchaseDate).toLocaleDateString()
                    : "—"
                }
                icon={Calendar}
              />
            </div>
            <EditablePurchasePrice asset={asset} />
            <EditableIdentifier asset={asset} />
            {asset.kind === "EQUIPMENT" && <EditableLocation asset={asset} />}
            {asset.kind === "TRUCK" && <InsuranceInfoStrip asset={asset} />}
            <PeriodSpendStrip
              mtdCents={asset.mtdSpendCents ?? 0}
              ytdCents={asset.ytdSpendCents ?? 0}
              lifetimeCents={asset.lifeToDateSpendCents}
            />
          </div>

          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/40 p-4">
            <QRCodeSVG
              value={qrUrl}
              size={130}
              data-testid="asset-qr-code"
              level="M"
            />
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Scan to open
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 gap-1.5"
              onClick={() => printQrLabel(asset.name, asset.slug, qrUrl)}
              data-testid="print-qr-button"
            >
              <Printer className="h-3.5 w-3.5" /> Print label
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="actions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="actions">Quick Actions</TabsTrigger>
          <TabsTrigger value="checkout" data-testid="tab-checkout">
            Checkout
          </TabsTrigger>
          <TabsTrigger value="photo" data-testid="tab-photo">
            Photo
          </TabsTrigger>
          <TabsTrigger value="ledger">
            Maintenance Ledger ({logs.length})
          </TabsTrigger>
          <TabsTrigger value="assignments" data-testid="tab-assignments">
            Assignment History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="space-y-4">
          {tracksUsage ? (
            <div className="grid gap-4 md:grid-cols-2">
              <UsageReadingForm
                asset={asset as Parameters<typeof UsageReadingForm>[0]["asset"]}
              />
              <QuickServiceForm
                asset={asset as Parameters<typeof QuickServiceForm>[0]["asset"]}
              />
            </div>
          ) : (
            <div className="rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
              Usage and scheduled service don't apply to {categoryDisplayLabel.toLowerCase()} items.
              Use the assignment and status controls below.
            </div>
          )}
          {tracksUsage && (
            <UsageReadingsCard
              slug={asset.slug}
              usageUnit={asset.usageUnit as "MILES" | "HOURS"}
              readings={recentReadings}
              canEdit={canEditMaintenance}
            />
          )}
          {asset.kind === "EQUIPMENT" && (
            <EquipmentItemsCard equipmentId={asset.id} canEdit={canEditAsset} />
          )}
          <AssignCrewCard asset={asset} />
          <ChangeStatusCard asset={asset} />
          <ChangeDepartmentCard asset={asset} />
          <StatusHistoryCard slug={asset.slug} />
        </TabsContent>

        <TabsContent value="checkout" className="space-y-4">
          <CheckoutPanel asset={asset} />
          <CheckoutHistoryCard slug={asset.slug} />
        </TabsContent>

        <TabsContent value="photo">
          <PhotoUploadCard slug={asset.slug} hasImage={asset.hasImage} />
        </TabsContent>

        <TabsContent value="assignments">
          <AssignmentHistoryCard slug={asset.slug} />
        </TabsContent>

        <TabsContent value="ledger">
          <Card className="border-border/60">
            <CardContent className="p-0">
              {logs.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  No maintenance recorded yet.
                </div>
              ) : (
                <ul className="divide-y">
                  {logs.map((log) => (
                    <li key={log.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto]">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {log.kind}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(log.performedAt).toLocaleDateString()}
                          </span>
                          {(log.mileageAtService ?? log.hoursAtService) != null && (
                            <span className="font-mono text-[11px] text-muted-foreground">
                              @ {num(log.mileageAtService ?? log.hoursAtService ?? 0)}{" "}
                              {asset.usageUnit === "MILES" ? "mi" : "hrs"}
                            </span>
                          )}
                          {log.loggedByName && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <User className="h-3 w-3" />
                              {log.loggedByName}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-sm font-medium">{log.description}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm font-semibold">
                          {usd(log.costCents)}
                        </div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {usd(log.laborCostCents)} labor · {usd(log.partsCostCents)} parts
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ServiceStateBanner({
  asset,
}: {
  asset: { serviceState: "OK" | "DUE_SOON" | "OVERDUE"; usageUntilDue: number; usageUnit: "MILES" | "HOURS"; serviceIntervalUsage: number };
}) {
  const unit = asset.usageUnit === "MILES" ? "miles" : "hours";
  if (asset.serviceState === "OVERDUE") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
        <AlertTriangle className="h-4 w-4" />
        <span>
          <strong>Overdue</strong> by {num(Math.abs(asset.usageUntilDue))} {unit}.
          Service interval is every {num(asset.serviceIntervalUsage)} {unit}.
        </span>
      </div>
    );
  }
  if (asset.serviceState === "DUE_SOON") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <Clock className="h-4 w-4" />
        <span>
          Due soon — only {num(asset.usageUntilDue)} {unit} remaining before next service.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      <CheckCircle2 className="h-4 w-4" />
      <span>
        On schedule — {num(asset.usageUntilDue)} {unit} until next service.
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

function EditableIdentifier({
  asset,
}: {
  asset: { kind: "TRUCK" | "EQUIPMENT"; id: number; slug: string; identifier?: string | null };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(asset.identifier ?? "");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateTruck = useUpdateTruck();
  const updateEquipment = useUpdateEquipment();
  const label = asset.kind === "TRUCK" ? "VIN" : "Serial";
  const isPending = updateTruck.isPending || updateEquipment.isPending;

  function startEdit() {
    setDraft(asset.identifier ?? "");
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(asset.identifier ?? "");
  }

  function save() {
    const val: string | null = draft.trim() || null;
    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAssetBySlugQueryKey(asset.slug) });
        queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
        toast({ title: `${label} updated` });
        setEditing(false);
      },
      onError: () => toast({ title: `Could not update ${label}`, variant: "destructive" }),
    };
    if (asset.kind === "TRUCK") {
      updateTruck.mutate({ id: asset.id, data: { vin: val } }, opts);
    } else {
      updateEquipment.mutate({ id: asset.id, data: { serial: val } }, opts);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Input
          className="h-7 w-52 font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={label === "VIN" ? "1FDXX…" : "SN-123456"}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
        />
        <Button size="sm" className="h-7 px-2 text-xs" onClick={save} disabled={isPending}>
          {isPending ? "…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-mono text-[10px] uppercase tracking-wider">{label}</span>
      {asset.identifier ? (
        <span className="font-mono text-foreground">{asset.identifier}</span>
      ) : (
        <span className="italic opacity-50">not set</span>
      )}
      <button
        type="button"
        onClick={startEdit}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title={`Edit ${label}`}
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function EditablePurchasePrice({
  asset,
}: {
  asset: { kind: "TRUCK" | "EQUIPMENT"; id: number; slug: string; purchasePriceCents?: number | null };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateTruck = useUpdateTruck();
  const updateEquipment = useUpdateEquipment();
  const isPending = updateTruck.isPending || updateEquipment.isPending;
  const priceCents = asset.purchasePriceCents ?? null;

  function startEdit() {
    setDraft(priceCents != null ? (priceCents / 100).toFixed(2) : "");
    setEditing(true);
  }
  function cancel() { setEditing(false); }
  function save() {
    const raw = draft.trim().replace(/[$,]/g, "");
    const dollars = parseFloat(raw);
    const val = raw === "" ? null : Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAssetBySlugQueryKey(asset.slug) });
        queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
        toast({ title: "Purchase price updated" });
        setEditing(false);
      },
      onError: () => toast({ title: "Could not update purchase price", variant: "destructive" }),
    };
    if (asset.kind === "TRUCK") {
      updateTruck.mutate({ id: asset.id, data: { purchasePriceCents: val } }, opts);
    } else {
      updateEquipment.mutate({ id: asset.id, data: { purchasePriceCents: val } }, opts);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Price
        </span>
        <Input
          className="h-7 w-36 font-mono text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="0.00"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
        />
        <Button size="sm" className="h-7 px-2 text-xs" onClick={save} disabled={isPending}>
          {isPending ? "…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancel} disabled={isPending}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-mono text-[10px] uppercase tracking-wider">Price</span>
      {priceCents != null ? (
        <span className="font-mono text-foreground">{usd(priceCents)}</span>
      ) : (
        <span className="italic opacity-50">not set</span>
      )}
      <button
        type="button"
        onClick={startEdit}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title="Edit purchase price"
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function EditableLocation({
  asset,
}: {
  asset: { id: number; slug: string; location?: string | null };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(asset.location ?? "");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateEquipmentExt();

  function startEdit() {
    setDraft(asset.location ?? "");
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(asset.location ?? "");
  }
  function save() {
    const val: string | null = draft.trim() || null;
    update.mutate(
      { id: asset.id, data: { location: val } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAssetBySlugQueryKey(asset.slug) });
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
          toast({ title: "Location updated" });
          setEditing(false);
        },
        onError: () => toast({ title: "Could not update location", variant: "destructive" }),
      },
    );
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="w-10 shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Loc
        </span>
        <Input
          className="h-7 w-40 text-xs"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. Tree Yard"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
        />
        <Button size="sm" className="h-7 px-2 text-xs" onClick={save} disabled={update.isPending}>
          {update.isPending ? "…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cancel} disabled={update.isPending}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-mono text-[10px] uppercase tracking-wider">Loc</span>
      {asset.location ? (
        <span className="text-foreground">{asset.location}</span>
      ) : (
        <span className="italic opacity-50">not set</span>
      )}
      <button
        type="button"
        onClick={startEdit}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        title="Edit location"
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function UsageReadingForm({
  asset,
}: {
  asset: {
    kind: "TRUCK" | "EQUIPMENT";
    id: number;
    slug: string;
    usageUnit: "MILES" | "HOURS";
    currentUsage: number;
  };
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useCreateUsageReading();
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) {
      toast({ title: "Enter a positive reading", variant: "destructive" });
      return;
    }
    if (n < asset.currentUsage) {
      toast({
        title: "Reading lower than current",
        description: `Current is ${num(asset.currentUsage)}. Saving anyway will not roll back the asset.`,
      });
    }
    const payload = {
      truckId: asset.kind === "TRUCK" ? asset.id : null,
      equipmentId: asset.kind === "EQUIPMENT" ? asset.id : null,
      mileage: asset.usageUnit === "MILES" ? n : null,
      hours: asset.usageUnit === "HOURS" ? n : null,
      notes: notes || null,
    };
    mutation.mutate(
      { data: payload },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetAssetBySlugQueryKey(asset.slug),
          });
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
          toast({ title: "Reading recorded" });
          setValue("");
          setNotes("");
        },
        onError: () =>
          toast({ title: "Could not save reading", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" /> Log Usage Reading
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="usage-reading">
              {asset.usageUnit === "MILES" ? "Odometer (miles)" : "Engine hours"}
            </Label>
            <Input
              id="usage-reading"
              type="number"
              min="0"
              value={value}
              placeholder={String(asset.currentUsage)}
              onChange={(e) => setValue(e.target.value)}
              data-testid="usage-reading-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="usage-notes">Notes (optional)</Label>
            <Textarea
              id="usage-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={mutation.isPending}
            data-testid="usage-reading-submit"
          >
            Save Reading
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function QuickServiceForm({
  asset,
}: {
  asset: {
    kind: "TRUCK" | "EQUIPMENT";
    id: number;
    slug: string;
    usageUnit: "MILES" | "HOURS";
    currentUsage: number;
  };
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useCreateMaintenanceLog();
  const [kind, setKind] = useState("REPAIR");
  const [description, setDescription] = useState("");
  const [labor, setLabor] = useState("");
  const [parts, setParts] = useState("");
  const [usageAt, setUsageAt] = useState(String(asset.currentUsage));

  const total =
    (parseFloat(labor || "0") || 0) + (parseFloat(parts || "0") || 0);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      toast({ title: "Description required", variant: "destructive" });
      return;
    }
    const usageNum = parseInt(usageAt, 10);
    const payload = {
      truckId: asset.kind === "TRUCK" ? asset.id : null,
      equipmentId: asset.kind === "EQUIPMENT" ? asset.id : null,
      kind,
      description: description.trim(),
      performedAt: new Date().toISOString(),
      laborCostCents: Math.round((parseFloat(labor || "0") || 0) * 100),
      partsCostCents: Math.round((parseFloat(parts || "0") || 0) * 100),
      mileageAtService:
        asset.usageUnit === "MILES" && Number.isFinite(usageNum) ? usageNum : null,
      hoursAtService:
        asset.usageUnit === "HOURS" && Number.isFinite(usageNum) ? usageNum : null,
    };
    mutation.mutate(
      { data: payload },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetAssetBySlugQueryKey(asset.slug),
          });
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMaintenanceLogsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
          toast({ title: "Service logged" });
          setDescription("");
          setLabor("");
          setParts("");
        },
        onError: () =>
          toast({ title: "Could not log service", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4" /> Log Service
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger data-testid="service-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                  <SelectItem value="REPAIR">Repair</SelectItem>
                  <SelectItem value="INSPECTION">Inspection</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="usage-at">
                {asset.usageUnit === "MILES" ? "Odometer at service" : "Hours at service"}
              </Label>
              <Input
                id="usage-at"
                type="number"
                value={usageAt}
                onChange={(e) => setUsageAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="service-desc">Description</Label>
            <Textarea
              id="service-desc"
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="service-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="labor-cost">Labor ($)</Label>
              <Input
                id="labor-cost"
                type="number"
                step="0.01"
                min="0"
                value={labor}
                onChange={(e) => setLabor(e.target.value)}
                data-testid="labor-cost"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="parts-cost">Parts ($)</Label>
              <Input
                id="parts-cost"
                type="number"
                step="0.01"
                min="0"
                value={parts}
                onChange={(e) => setParts(e.target.value)}
                data-testid="parts-cost"
              />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total auto-calculated</span>
            <span className="font-mono text-base font-semibold" data-testid="service-total">
              {usd(Math.round(total * 100))}
            </span>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={mutation.isPending}
            data-testid="service-submit"
          >
            Save Service Entry
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ChangeDepartmentCard({
  asset,
}: {
  asset: { slug: string; kind: string; id: number; departmentId?: number | null };
}) {
  const { isAdmin } = useDepartmentFilter();
  if (!isAdmin) return null;
  return <ChangeDepartmentCardInner asset={asset} />;
}

function ChangeDepartmentCardInner({
  asset,
}: {
  asset: { slug: string; kind: string; id: number; departmentId?: number | null };
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: deptData } = useListDepartments();
  const departments = deptData?.departments ?? [];
  const updateTruck = useUpdateTruck();
  const updateEquipment = useUpdateEquipment();

  const [selectedDeptId, setSelectedDeptId] = useState<string>(
    asset.departmentId != null ? String(asset.departmentId) : "UNASSIGN",
  );
  const [touched, setTouched] = useState(false);

  if (departments.length === 0) return null;

  const currentVal = asset.departmentId != null ? String(asset.departmentId) : "UNASSIGN";
  const dirty = touched && selectedDeptId !== currentVal && selectedDeptId !== "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || selectedDeptId === "") return;
    // "UNASSIGN" sentinel clears departmentId back to null so the
    // asset returns to the "Needs Department" bucket on the registry.
    const deptId: number | null =
      selectedDeptId === "UNASSIGN" ? null : Number(selectedDeptId);
    const opts = {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAssetBySlugQueryKey(asset.slug) });
        queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
        toast({ title: deptId == null ? "Department cleared" : "Department updated" });
        setTouched(false);
      },
      onError: () => toast({ title: "Could not update department", variant: "destructive" }),
    };
    if (asset.kind === "TRUCK") {
      updateTruck.mutate({ id: asset.id, data: { departmentId: deptId } }, opts);
    } else {
      updateEquipment.mutate({ id: asset.id, data: { departmentId: deptId } }, opts);
    }
  };

  const isPending = updateTruck.isPending || updateEquipment.isPending;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4" /> Assign Department
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="asset-dept">Department</Label>
            <Select
              value={selectedDeptId}
              onValueChange={(v) => {
                setSelectedDeptId(v);
                setTouched(true);
              }}
            >
              <SelectTrigger id="asset-dept" className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UNASSIGN">— Unassigned —</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={!dirty || isPending}>
            Save department
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StatusHistoryCard({ slug }: { slug: string }) {
  const { data } = useGetAssetStatusHistory(slug);
  const history = data?.history ?? [];

  function statusLabel(s: string) {
    if (s === "ACTIVE") return "Active";
    if (s === "IN_SHOP") return "In Shop";
    return "Out of Service";
  }

  if (history.length === 0) return null;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Status History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {history.slice(0, 5).map((entry) => (
            <li key={entry.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{statusLabel(entry.oldStatus)}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium">{statusLabel(entry.newStatus)}</span>
                {entry.changedByName && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3 w-3" /> {entry.changedByName}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {new Date(entry.changedAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function AssignCrewCard({
  asset,
}: {
  asset: { slug: string; assignedCrewId: number | null };
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: crewsData } = useListCrews();
  const mutation = useAssignAsset(asset.slug);
  const crews = crewsData?.crews ?? [];
  const initialValue = asset.assignedCrewId != null ? String(asset.assignedCrewId) : "NONE";
  const [selected, setSelected] = useState<string>(initialValue);
  const [touched, setTouched] = useState(false);

  const dirty = touched && selected !== initialValue;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    const crewId = selected === "NONE" ? null : Number(selected);
    mutation.mutate(
      { crewId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetAssetBySlugQueryKey(asset.slug),
          });
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
          queryClient.invalidateQueries({
            queryKey: getAssignmentHistoryKey(asset.slug),
          });
          toast({
            title:
              crewId == null
                ? "Returned from crew"
                : `Assigned to ${crews.find((c) => c.id === crewId)?.name ?? "crew"}`,
          });
          setTouched(false);
        },
        onError: () =>
          toast({ title: "Could not update assignment", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/60" data-testid="assign-crew-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersIcon className="h-4 w-4" /> Assign to Crew
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="crew-select">Crew</Label>
            <Select
              value={selected}
              onValueChange={(v) => {
                setSelected(v);
                setTouched(true);
              }}
            >
              <SelectTrigger id="crew-select" className="w-56" data-testid="crew-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">Unassigned</SelectItem>
                {crews.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={!dirty || mutation.isPending}
            data-testid="assign-crew-submit"
          >
            Save assignment
          </Button>
          <p className="basis-full text-xs text-muted-foreground">
            Reassigning records the change to the assignment log so you can
            trace who handed the asset off, and when.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function AssignmentHistoryCard({ slug }: { slug: string }) {
  const { data, isLoading } = useAssignmentHistory(slug);
  const history = data?.history ?? [];

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Assignment History
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : history.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No crew assignments recorded yet.
          </div>
        ) : (
          <ul className="divide-y">
            {history.map((entry) => {
              const verb =
                entry.oldCrewId == null
                  ? "Assigned"
                  : entry.newCrewId == null
                    ? "Returned"
                    : "Reassigned";
              return (
                <li
                  key={entry.id}
                  className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto]"
                  data-testid={`assignment-entry-${entry.id}`}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {verb}
                      </Badge>
                      {entry.oldCrewName && (
                        <>
                          <span className="text-muted-foreground">
                            {entry.oldCrewName}
                          </span>
                          <span className="text-muted-foreground">→</span>
                        </>
                      )}
                      <span className="font-medium">
                        {entry.newCrewName ?? "Unassigned"}
                      </span>
                      {entry.changedByName && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <User className="h-3 w-3" />
                          {entry.changedByName}
                        </span>
                      )}
                    </div>
                    {entry.note && (
                      <div className="mt-1 text-xs text-muted-foreground">{entry.note}</div>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground sm:text-right">
                    {new Date(entry.changedAt).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ChangeStatusCard({
  asset,
}: {
  asset: { slug: string; status: string };
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useSetAssetStatus();
  const [status, setStatus] = useState(asset.status);
  const [touched, setTouched] = useState(false);

  const dirty = touched && status !== asset.status;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    mutation.mutate(
      { slug: asset.slug, data: { status: status as "ACTIVE" | "IN_SHOP" | "RETIRED" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetAssetBySlugQueryKey(asset.slug),
          });
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetAssetStatusHistoryQueryKey(asset.slug) });
          toast({ title: `Status changed to ${statusLabel(status)}` });
          setTouched(false);
        },
        onError: () =>
          toast({ title: "Could not change status", variant: "destructive" }),
      },
    );
  };

  return (
    <Card className="border-border/60" data-testid="change-status-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" /> Change Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={submit}
          className="flex flex-wrap items-end gap-3"
        >
          <div className="space-y-2">
            <Label htmlFor="asset-status">Service state</Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v);
                setTouched(true);
              }}
            >
              <SelectTrigger
                id="asset-status"
                className="w-56"
                data-testid="status-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="IN_SHOP">In Shop</SelectItem>
                <SelectItem value="RETIRED">Out of Service</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="submit"
            disabled={!dirty || mutation.isPending}
            data-testid="status-submit"
          >
            Save status
          </Button>
          <p className="basis-full text-xs text-muted-foreground">
            Use <strong>In Shop</strong> for temporary downtime and{" "}
            <strong>Out of Service</strong> when the asset is permanently retired
            or unsafe to operate.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------
// New components — hero photo, holder badge, period rollups,
// checkout panel + history, photo upload.
// ----------------------------------------------------------------------

function AssetImageHero({
  slug,
  hasImage,
  CategoryIcon,
}: {
  slug: string;
  hasImage: boolean;
  CategoryIcon: React.ComponentType<{ className?: string }>;
}) {
  const { data } = useAssetImage(slug, hasImage);
  return (
    <div
      className="hidden h-32 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 md:flex"
      data-testid="asset-hero-image"
    >
      {hasImage && data?.imageDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.imageDataUrl}
          alt="Asset"
          className="h-full w-full object-cover"
        />
      ) : (
        <CategoryIcon className="h-12 w-12 text-muted-foreground/60" />
      )}
    </div>
  );
}

function HolderRibbon({ asset }: { asset: AssetExt & { slug: string } }) {
  if (asset.currentHolderName) {
    return (
      <div
        className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
        data-testid="asset-current-holder"
      >
        <UserCheck className="h-3.5 w-3.5 shrink-0" />
        <span>
          Currently checked out to{" "}
          <span className="font-semibold">{asset.currentHolderName}</span>
          {asset.currentCheckoutSince && (
            <>
              {" "}
              <span className="text-amber-700/80">
                · since {new Date(asset.currentCheckoutSince).toLocaleString()}
              </span>
            </>
          )}
        </span>
      </div>
    );
  }
  if (asset.lastHolderName) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <LogIn className="h-3.5 w-3.5 shrink-0" />
        <span>
          Last out with{" "}
          <span className="font-semibold text-foreground">
            {asset.lastHolderName}
          </span>
          {asset.lastCheckedOutAt && (
            <>
              {" "}
              <span className="text-muted-foreground">
                · {new Date(asset.lastCheckedOutAt).toLocaleDateString()}
              </span>
            </>
          )}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
      <LogIn className="h-3.5 w-3.5 shrink-0" />
      <span>Available — no checkout history yet</span>
    </div>
  );
}

const BODY_TYPE_LABELS: Record<string, string> = {
  TK: "Truck",
  PU: "Pickup",
  CRGVN: "Cargo Van",
  SRVT: "Service Trailer",
  OT: "Other",
  SUV: "SUV",
  DMPTK: "Dump Truck",
  OTHB: "Other Bus/Van",
  T: "Flatbed Trailer",
};

function InsuranceInfoStrip({
  asset,
}: {
  asset: {
    id: number;
    slug: string;
    year: number | null;
    insuranceVehNumber: number | null;
    bodyTypeCode: string | null;
    statedValueCents: number | null;
    gvwGcwLbs: number | null;
    garagingState: string | null;
    operatingRadiusMiles: number | null;
  };
}) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateTruck = useUpdateTruck();
  const isPending = updateTruck.isPending;

  function startEdit(field: string, currentDraft: string) {
    setEditingField(field);
    setDraft(currentDraft);
  }

  function cancel() {
    setEditingField(null);
    setDraft("");
  }

  function save(field: string) {
    let data: Record<string, unknown> = {};
    const trimmed = draft.trim();
    if (field === "year") {
      const n = parseInt(trimmed);
      data = { year: trimmed === "" ? null : Number.isFinite(n) ? n : null };
    } else if (field === "insuranceVehNumber") {
      const n = parseInt(trimmed);
      data = { insuranceVehNumber: trimmed === "" ? null : Number.isFinite(n) ? n : null };
    } else if (field === "statedValueCents") {
      const dollars = parseFloat(trimmed.replace(/[$,]/g, ""));
      data = { statedValueCents: trimmed === "" ? null : Number.isFinite(dollars) ? Math.round(dollars * 100) : null };
    } else if (field === "gvwGcwLbs") {
      const n = parseInt(trimmed.replace(/,/g, ""));
      data = { gvwGcwLbs: trimmed === "" ? null : Number.isFinite(n) ? n : null };
    } else if (field === "garagingState") {
      data = { garagingState: trimmed === "" ? null : trimmed.toUpperCase().slice(0, 2) };
    } else if (field === "bodyTypeCode") {
      data = { bodyTypeCode: trimmed === "" ? null : trimmed };
    } else if (field === "operatingRadiusMiles") {
      const n = parseInt(trimmed.replace(/,/g, ""));
      data = { operatingRadiusMiles: trimmed === "" ? null : Number.isFinite(n) ? n : null };
    }
    updateTruck.mutate(
      { id: asset.id, data: data as Parameters<typeof updateTruck.mutate>[0]["data"] },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAssetBySlugQueryKey(asset.slug) });
          queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
          toast({ title: "Updated" });
          setEditingField(null);
        },
        onError: () => toast({ title: "Could not update", variant: "destructive" }),
      },
    );
  }

  type FieldDef = {
    key: string;
    label: string;
    displayValue: string | null;
    draftValue: string;
    isSelect?: boolean;
    inputType?: string;
    placeholder?: string;
  };

  const fields: FieldDef[] = [
    {
      key: "year",
      label: "Year",
      displayValue: asset.year != null ? String(asset.year) : null,
      draftValue: asset.year != null ? String(asset.year) : "",
      inputType: "number",
      placeholder: "2020",
    },
    {
      key: "insuranceVehNumber",
      label: "Ins. Veh #",
      displayValue: asset.insuranceVehNumber != null ? String(asset.insuranceVehNumber) : null,
      draftValue: asset.insuranceVehNumber != null ? String(asset.insuranceVehNumber) : "",
      inputType: "number",
      placeholder: "12345",
    },
    {
      key: "bodyTypeCode",
      label: "Body type",
      displayValue: asset.bodyTypeCode != null ? (BODY_TYPE_LABELS[asset.bodyTypeCode] ?? asset.bodyTypeCode) : null,
      draftValue: asset.bodyTypeCode ?? "",
      isSelect: true,
    },
    {
      key: "statedValueCents",
      label: "Stated value",
      displayValue: asset.statedValueCents != null
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(asset.statedValueCents / 100)
        : null,
      draftValue: asset.statedValueCents != null ? String(Math.round(asset.statedValueCents / 100)) : "",
      inputType: "number",
      placeholder: "0",
    },
    {
      key: "gvwGcwLbs",
      label: "GVW/GCW",
      displayValue: asset.gvwGcwLbs != null ? `${new Intl.NumberFormat("en-US").format(asset.gvwGcwLbs)} lbs` : null,
      draftValue: asset.gvwGcwLbs != null ? String(asset.gvwGcwLbs) : "",
      inputType: "number",
      placeholder: "0",
    },
    {
      key: "garagingState",
      label: "Garaged",
      displayValue: asset.garagingState,
      draftValue: asset.garagingState ?? "",
      inputType: "text",
      placeholder: "FL",
    },
    {
      key: "operatingRadiusMiles",
      label: "Radius",
      displayValue: asset.operatingRadiusMiles != null ? `${asset.operatingRadiusMiles} mi` : null,
      draftValue: asset.operatingRadiusMiles != null ? String(asset.operatingRadiusMiles) : "",
      inputType: "number",
      placeholder: "0",
    },
  ];

  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-2.5">
      <div className="mb-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Insurance Schedule
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {fields.map((f) =>
          editingField === f.key ? (
            <div key={f.key} className="flex items-center gap-1.5">
              <span className="shrink-0 text-[10px] text-muted-foreground">{f.label}:</span>
              {f.isSelect ? (
                <Select value={draft} onValueChange={(v) => setDraft(v)}>
                  <SelectTrigger className="h-6 w-36 text-xs">
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(BODY_TYPE_LABELS).map(([code, label]) => (
                      <SelectItem key={code} value={code}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="h-6 w-24 text-xs"
                  type={f.inputType}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={f.placeholder}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save(f.key);
                    if (e.key === "Escape") cancel();
                  }}
                />
              )}
              <Button size="sm" className="h-6 px-1.5 text-xs" onClick={() => save(f.key)} disabled={isPending}>
                {isPending ? "…" : "✓"}
              </Button>
              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={cancel} disabled={isPending}>
                ✕
              </Button>
            </div>
          ) : (
            <div key={f.key} className="group/ins flex items-baseline gap-1 text-xs">
              <span className="text-muted-foreground">{f.label}:</span>
              {f.displayValue != null ? (
                <span className="font-medium text-foreground">{f.displayValue}</span>
              ) : (
                <span className="italic text-muted-foreground/50">—</span>
              )}
              <button
                type="button"
                onClick={() => startEdit(f.key, f.draftValue)}
                className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover/ins:opacity-100"
                title={`Edit ${f.label}`}
              >
                <Pencil className="h-2 w-2" />
              </button>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function PeriodSpendStrip({
  mtdCents,
  ytdCents,
  lifetimeCents,
}: {
  mtdCents: number;
  ytdCents: number;
  lifetimeCents: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 pt-1">
      <PeriodCell label="This month" value={usd(mtdCents)} />
      <PeriodCell label="This year" value={usd(ytdCents)} />
      <PeriodCell label="All time" value={usd(lifetimeCents)} />
    </div>
  );
}

function PeriodCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card/60 p-2.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function CheckoutPanel({ asset }: { asset: AssetExt & { slug: string } }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const checkOut = useCheckOutAsset(asset.slug);
  const checkIn = useCheckInAsset(asset.slug);
  const { data: candidates } = useListCrewLeadCandidates();
  const [userId, setUserId] = useState<string>("");
  const [notes, setNotes] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getGetAssetBySlugQueryKey(asset.slug),
    });
    queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["asset-checkouts", asset.slug] });
  };

  const isOut = asset.currentHolderUserId != null;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="h-4 w-4" />
          {isOut ? "Currently checked out" : "Check out this asset"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isOut ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <div className="font-semibold text-amber-900">
                {asset.currentHolderName ?? "Unknown user"}
              </div>
              {asset.currentCheckoutSince && (
                <div className="text-xs text-amber-800/80">
                  Out since{" "}
                  {new Date(asset.currentCheckoutSince).toLocaleString()}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkin-notes">Check-in notes (optional)</Label>
              <Textarea
                id="checkin-notes"
                placeholder="Any damage, fuel level, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                data-testid="checkin-notes"
              />
            </div>
            <Button
              type="button"
              variant="default"
              disabled={checkIn.isPending}
              onClick={() => {
                checkIn.mutate(
                  { notes: notes || null },
                  {
                    onSuccess: () => {
                      toast({ title: "Checked in" });
                      setNotes("");
                      invalidate();
                    },
                    onError: () =>
                      toast({
                        title: "Could not check in",
                        variant: "destructive",
                      }),
                  },
                );
              }}
              data-testid="checkin-submit"
            >
              <LogIn className="mr-1.5 h-4 w-4" /> Check in
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="checkout-user">Hand off to</Label>
              <Select value={userId} onValueChange={setUserId}>
                <SelectTrigger id="checkout-user" data-testid="checkout-user-select">
                  <SelectValue placeholder="Pick a person…" />
                </SelectTrigger>
                <SelectContent>
                  {(candidates?.users ?? []).map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="checkout-notes">Notes (optional)</Label>
              <Textarea
                id="checkout-notes"
                placeholder="Job site, expected return, etc."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                data-testid="checkout-notes"
              />
            </div>
            <Button
              type="button"
              disabled={!userId || checkOut.isPending}
              onClick={() => {
                const id = parseInt(userId, 10);
                if (!Number.isFinite(id)) return;
                checkOut.mutate(
                  { userId: id, notes: notes || null },
                  {
                    onSuccess: () => {
                      toast({ title: "Checked out" });
                      setNotes("");
                      setUserId("");
                      invalidate();
                    },
                    onError: (err) =>
                      toast({
                        title: "Could not check out",
                        description: (err as Error)?.message,
                        variant: "destructive",
                      }),
                  },
                );
              }}
              data-testid="checkout-submit"
            >
              <LogOut className="mr-1.5 h-4 w-4" /> Check out
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CheckoutHistoryCard({ slug }: { slug: string }) {
  const { data, isLoading } = useCheckoutHistory(slug);
  if (isLoading) {
    return <Skeleton className="h-24 w-full" />;
  }
  const history = data?.history ?? [];
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Checkout history
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {history.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No one has checked this asset out yet.
          </div>
        ) : (
          <ul className="divide-y" data-testid="checkout-history-list">
            {history.map((row) => {
              const out = new Date(row.checkedOutAt);
              const inAt = row.checkedInAt ? new Date(row.checkedInAt) : null;
              const open = !inAt;
              return (
                <li key={row.id} className="grid gap-1 p-4 sm:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">
                        {row.userName ?? `User #${row.userId}`}
                      </span>
                      {open && (
                        <Badge variant="outline" className="text-[10px]">
                          OPEN
                        </Badge>
                      )}
                      {row.checkedOutByName && (
                        <span className="text-[11px] text-muted-foreground">
                          (handed off by {row.checkedOutByName})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {out.toLocaleString()}
                      {inAt && <> → {inAt.toLocaleString()}</>}
                    </div>
                    {row.notes && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.notes}
                      </div>
                    )}
                  </div>
                  {inAt ? (
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{Math.max(1, Math.round((inAt.getTime() - out.getTime()) / 3600000))} hrs out</div>
                      {row.checkedInByName && (
                        <div className="text-[11px]">
                          checked in by {row.checkedInByName}
                        </div>
                      )}
                    </div>
                  ) : (
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] text-amber-900"
                    >
                      OUT
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PhotoUploadCard({
  slug,
  hasImage,
}: {
  slug: string;
  hasImage: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAssetImage(slug, hasImage);
  const upload = useUpdateAssetImage(slug);
  const fileInputId = `asset-photo-${slug}`;
  const MAX_BYTES = 5 * 1024 * 1024;

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getGetAssetBySlugQueryKey(slug),
    });
    queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ["asset-image", slug] });
  };

  const onPick = (file: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      toast({ title: "Only PNG, JPG, GIF, or WEBP images", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "Image must be under 5 MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      upload.mutate(dataUrl, {
        onSuccess: () => {
          toast({ title: "Photo saved" });
          invalidate();
        },
        onError: () =>
          toast({ title: "Upload failed", variant: "destructive" }),
      });
    };
    reader.readAsDataURL(file);
  };

  const onRemove = () => {
    upload.mutate(null, {
      onSuccess: () => {
        toast({ title: "Photo removed" });
        invalidate();
      },
      onError: () =>
        toast({ title: "Could not remove photo", variant: "destructive" }),
    });
  };

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-4 w-4" />
          Asset photo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-center overflow-hidden rounded-lg border bg-muted/30">
          {hasImage && data?.imageDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.imageDataUrl}
              alt="Asset photo"
              className="max-h-80 w-auto object-contain"
              data-testid="asset-photo-preview"
            />
          ) : (
            <div className="flex h-48 w-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <Camera className="h-10 w-10 opacity-50" />
              <span className="text-sm">No photo yet</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            id={fileInputId}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="sr-only"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            data-testid="asset-photo-input"
          />
          <Button asChild variant="default" disabled={upload.isPending}>
            <label htmlFor={fileInputId} className="cursor-pointer">
              <Upload className="mr-1.5 h-4 w-4" />
              {hasImage ? "Replace photo" : "Upload photo"}
            </label>
          </Button>
          {hasImage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={upload.isPending}
              onClick={onRemove}
              data-testid="asset-photo-remove"
            >
              <X className="mr-1.5 h-4 w-4" /> Remove
            </Button>
          )}
          {isLoading && <span className="text-xs text-muted-foreground">Loading…</span>}
        </div>
        <p className="text-xs text-muted-foreground">
          PNG, JPG, GIF, or WEBP. Max 5 MB. The photo helps the team
          identify the asset visually from the registry, QR scan, and
          checkout flow.
        </p>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------
// Record editing — delete the asset from its own page, correct / remove
// usage readings, and manage the consumables attached to equipment.
// ----------------------------------------------------------------------

function DeleteAssetButton({
  kind,
  id,
  name,
}: {
  kind: "TRUCK" | "EQUIPMENT";
  id: number;
  name: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const deleteTruck = useDeleteTruck();
  const deleteEquipment = useDeleteEquipment();
  const isPending = deleteTruck.isPending || deleteEquipment.isPending;

  function handleDelete() {
    const onSuccess = (result: unknown) => {
      queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
      queryClient.invalidateQueries({ queryKey: DELETE_REQUESTS_PENDING_COUNT_KEY });
      toast(deleteOutcomeToast(result, `${name} deleted`));
      // Only leave the page when the row is actually gone; a queued
      // request means the asset still exists until an admin approves.
      const queued = !!(result && typeof result === "object" && (result as { queued?: boolean }).queued);
      if (!queued) navigate("/assets");
    };
    const onError = () =>
      toast({
        title: "Error deleting asset",
        description: `Couldn't delete ${name}. Please try again.`,
        variant: "destructive",
      });
    if (kind === "TRUCK") deleteTruck.mutate({ id }, { onSuccess, onError });
    else deleteEquipment.mutate({ id }, { onSuccess, onError });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          data-testid="asset-delete-button"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove <span className="font-semibold">{name}</span> and its
            maintenance ledger, usage readings and checkout history from the
            registry. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type ReadingRow = {
  id: number;
  mileage?: number | null;
  hours?: number | null;
  recordedAt: string | Date;
  notes?: string | null;
};

function UsageReadingsCard({
  slug,
  usageUnit,
  readings,
  canEdit,
}: {
  slug: string;
  usageUnit: "MILES" | "HOURS";
  readings: ReadingRow[];
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateUsageReading();
  const remove = useDeleteUsageReading();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const unit = usageUnit === "MILES" ? "mi" : "hrs";

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetAssetBySlugQueryKey(slug) });
    queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
  };

  function startEdit(r: ReadingRow) {
    setEditingId(r.id);
    setDraftValue(String((usageUnit === "MILES" ? r.mileage : r.hours) ?? ""));
    setDraftNotes(r.notes ?? "");
  }

  function save(r: ReadingRow) {
    const n = parseInt(draftValue, 10);
    if (!Number.isFinite(n) || n < 0) {
      toast({ title: "Enter a whole number ≥ 0", variant: "destructive" });
      return;
    }
    update.mutate(
      {
        id: r.id,
        data: {
          ...(usageUnit === "MILES" ? { mileage: n } : { hours: n }),
          notes: draftNotes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Reading updated" });
          setEditingId(null);
        },
        onError: () => toast({ title: "Could not update reading", variant: "destructive" }),
      },
    );
  }

  function del(r: ReadingRow) {
    remove.mutate(r.id, {
      onSuccess: (result) => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: DELETE_REQUESTS_PENDING_COUNT_KEY });
        toast(deleteOutcomeToast(result, "Reading deleted"));
      },
      onError: () => toast({ title: "Could not delete reading", variant: "destructive" }),
    });
  }

  return (
    <Card className="border-border/60" data-testid="usage-readings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" /> Recent readings
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {readings.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No readings logged yet.
          </div>
        ) : (
          <ul className="divide-y">
            {readings.map((r) => {
              const value = (usageUnit === "MILES" ? r.mileage : r.hours) ?? 0;
              const editing = editingId === r.id;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5" data-testid={`reading-${r.id}`}>
                  {editing ? (
                    <>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        className="h-8 w-32 font-mono text-sm"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") save(r);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <span className="text-xs text-muted-foreground">{unit}</span>
                      <Input
                        className="h-8 min-w-[10rem] flex-1 text-sm"
                        placeholder="Notes"
                        value={draftNotes}
                        onChange={(e) => setDraftNotes(e.target.value)}
                      />
                      <Button size="sm" className="h-8" onClick={() => save(r)} disabled={update.isPending}>
                        <Check className="mr-1 h-3.5 w-3.5" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)} disabled={update.isPending}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="font-mono text-sm font-semibold">
                        {num(value)} <span className="font-normal text-muted-foreground">{unit}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.recordedAt).toLocaleString()}
                      </span>
                      {r.notes && (
                        <span className="truncate text-xs text-muted-foreground/80">— {r.notes}</span>
                      )}
                      {canEdit && (
                        <span className="ml-auto flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Edit reading"
                            aria-label="Edit reading"
                            onClick={() => startEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                title="Delete reading"
                                aria-label="Delete reading"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this reading?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Removes the {num(value)} {unit} entry. If it was the
                                  highest reading, the asset's current {usageUnit === "MILES" ? "odometer" : "hours"} is
                                  recalculated from what's left.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => del(r)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EquipmentItemsCard({
  equipmentId,
  canEdit,
}: {
  equipmentId: number;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useEquipmentItems(equipmentId);
  const create = useCreateEquipmentItem(equipmentId);
  const update = useUpdateEquipmentItem(equipmentId);
  const remove = useDeleteEquipmentItem(equipmentId);
  const items = data?.items ?? [];

  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newUnit, setNewUnit] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", quantity: "1", unit: "", notes: "" });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getEquipmentItemsKey(equipmentId) });

  function add(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const qty = parseInt(newQty, 10);
    if (!name) {
      toast({ title: "Item name is required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(qty) || qty < 1) {
      toast({ title: "Quantity must be at least 1", variant: "destructive" });
      return;
    }
    create.mutate(
      { name, quantity: qty, unit: newUnit.trim() || undefined },
      {
        onSuccess: () => {
          invalidate();
          setNewName("");
          setNewQty("1");
          setNewUnit("");
          toast({ title: `${name} added` });
        },
        onError: () => toast({ title: "Could not add item", variant: "destructive" }),
      },
    );
  }

  function startEdit(it: EquipmentItem) {
    setEditingId(it.id);
    setDraft({
      name: it.name,
      quantity: String(it.quantity),
      unit: it.unit ?? "",
      notes: it.notes ?? "",
    });
  }

  function save(it: EquipmentItem) {
    const name = draft.name.trim();
    const qty = parseInt(draft.quantity, 10);
    if (!name) {
      toast({ title: "Item name is required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(qty) || qty < 0) {
      toast({ title: "Quantity must be a whole number ≥ 0", variant: "destructive" });
      return;
    }
    update.mutate(
      {
        itemId: it.id,
        data: {
          name,
          quantity: qty,
          unit: draft.unit.trim() || null,
          notes: draft.notes.trim() || null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setEditingId(null);
          toast({ title: "Item updated" });
        },
        onError: () => toast({ title: "Could not update item", variant: "destructive" }),
      },
    );
  }

  function del(it: EquipmentItem) {
    remove.mutate(it.id, {
      onSuccess: (result) => {
        invalidate();
        queryClient.invalidateQueries({ queryKey: DELETE_REQUESTS_PENDING_COUNT_KEY });
        toast(deleteOutcomeToast(result, `${it.name} removed`));
      },
      onError: () => toast({ title: "Could not remove item", variant: "destructive" }),
    });
  }

  return (
    <Card className="border-border/60" data-testid="equipment-items-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-4 w-4" /> Attached items & consumables
          <span className="font-mono text-xs font-normal text-muted-foreground">({items.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing attached yet — track chains, bars, blades, spare parts and other
            accessories that travel with this equipment.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((it) => {
              const editing = editingId === it.id;
              return (
                <li key={it.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid={`equipment-item-${it.id}`}>
                  {editing ? (
                    <>
                      <Input
                        className="h-8 min-w-[8rem] flex-1 text-sm"
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        autoFocus
                      />
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        className="h-8 w-20 font-mono text-sm"
                        value={draft.quantity}
                        onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
                      />
                      <Input
                        className="h-8 w-20 text-sm"
                        placeholder="unit"
                        value={draft.unit}
                        onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
                      />
                      <Input
                        className="h-8 min-w-[8rem] flex-1 text-sm"
                        placeholder="Notes"
                        value={draft.notes}
                        onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                      />
                      <Button size="sm" className="h-8" onClick={() => save(it)} disabled={update.isPending}>
                        <Check className="mr-1 h-3.5 w-3.5" /> Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)} disabled={update.isPending}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium">{it.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        × {num(it.quantity)}{it.unit ? ` ${it.unit}` : ""}
                      </span>
                      {it.notes && (
                        <span className="truncate text-xs text-muted-foreground/80">— {it.notes}</span>
                      )}
                      {canEdit && (
                        <span className="ml-auto flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Edit item"
                            aria-label={`Edit ${it.name}`}
                            onClick={() => startEdit(it)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            title="Remove item"
                            aria-label={`Remove ${it.name}`}
                            onClick={() => del(it)}
                            disabled={remove.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && (
          <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="min-w-[10rem] flex-1">
              <Label htmlFor={`eq-item-name-${equipmentId}`} className="text-xs">Add item</Label>
              <Input
                id={`eq-item-name-${equipmentId}`}
                className="mt-1 h-8 text-sm"
                placeholder="e.g. 20in saw chain"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="w-20">
              <Label htmlFor={`eq-item-qty-${equipmentId}`} className="text-xs">Qty</Label>
              <Input
                id={`eq-item-qty-${equipmentId}`}
                type="number"
                min="1"
                step="1"
                className="mt-1 h-8 font-mono text-sm"
                value={newQty}
                onChange={(e) => setNewQty(e.target.value)}
              />
            </div>
            <div className="w-24">
              <Label htmlFor={`eq-item-unit-${equipmentId}`} className="text-xs">Unit</Label>
              <Input
                id={`eq-item-unit-${equipmentId}`}
                className="mt-1 h-8 text-sm"
                placeholder="pcs"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" className="h-8" disabled={create.isPending} data-testid="equipment-item-add">
              {create.isPending ? "Adding…" : "Add"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
