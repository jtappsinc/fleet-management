import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAssets,
  useListDepartments,
  useGetMe,
  useUpdateTruck,
  useUpdateEquipment,
  useDeleteTruck,
  useDeleteEquipment,
  getListAssetsQueryKey,
  getGetFleetPulseQueryKey,
  type Asset,
} from "@workspace/api-client-react";
import {
  useListCrews,
  useCreateTruck,
  useCreateEquipment,
  useAssetImage,
  type AssetExt,
  type Crew,
  type CreateTruckBody,
  type CreateEquipmentBody,
} from "@/lib/extra-api";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useDepartmentFilter } from "@/context/DepartmentContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Truck,
  Package,
  AlertTriangle,
  Clock,
  CheckCircle2,
  ArrowRight,
  QrCode,
  DollarSign,
  Building2,
  Users as UsersIcon,
  Caravan,
  Hammer,
  Boxes,
  Plus,
  Construction,
  MapPin,
  Trash2,
} from "lucide-react";
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
import { deleteOutcomeToast } from "@/lib/delete-outcome";
import { DELETE_REQUESTS_PENDING_COUNT_KEY } from "@/lib/extra-api";
import { EditAssetButton } from "@/components/EditAssetDialog";

const usd = (cents: number | null | undefined) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents ?? 0) / 100);

const num = (n: number) => new Intl.NumberFormat("en-US").format(n);

function statusLabel(status: string) {
  if (status === "ACTIVE") return "Active";
  if (status === "IN_SHOP") return "In Shop";
  return "Out of Service";
}

function statusBadgeClass(status: string) {
  if (status === "ACTIVE") return "bg-emerald-100 text-emerald-900 border-emerald-200";
  if (status === "IN_SHOP") return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-rose-100 text-rose-900 border-rose-300";
}

function ServiceBadge({ state }: { state: "OK" | "DUE_SOON" | "OVERDUE" }) {
  if (state === "OVERDUE") {
    return (
      <Badge className="border-rose-200 bg-rose-100 text-rose-900 hover:bg-rose-100">
        <AlertTriangle className="mr-1 h-3 w-3" />
        Overdue
      </Badge>
    );
  }
  if (state === "DUE_SOON") {
    return (
      <Badge className="border-amber-200 bg-amber-100 text-amber-900 hover:bg-amber-100">
        <Clock className="mr-1 h-3 w-3" />
        Due Soon
      </Badge>
    );
  }
  return (
    <Badge className="border-emerald-200 bg-emerald-100 text-emerald-900 hover:bg-emerald-100">
      <CheckCircle2 className="mr-1 h-3 w-3" />
      OK
    </Badge>
  );
}

type SortKey = "NAME" | "STATUS" | "SERVICE_DUE" | "YTD_SPEND" | "LIFETIME_SPEND";
type CategoryFilter = "ALL" | "TRUCK" | "TRAILER" | "HANDHELD" | "COMPACT" | "CUSTOM";

const SERVICE_RANK = { OVERDUE: 0, DUE_SOON: 1, OK: 2 };

type RegistryAsset = Omit<Asset, "usageUnit"> & AssetExt;

function categoryIcon(a: Pick<RegistryAsset, "category" | "customCategoryLabel">) {
  if (a.category === "TRUCK") return Truck;
  if (a.category === "TRAILER") return Caravan;
  if (a.category === "HANDHELD") return Hammer;
  if (a.category === "CUSTOM" && a.customCategoryLabel === "Compact Equipment") return Construction;
  return Boxes;
}

function categoryLabel(a: RegistryAsset) {
  if (a.category === "CUSTOM") return a.customCategoryLabel || "Custom";
  if (a.category === "HANDHELD") return "Handheld";
  if (a.category === "TRAILER") return "Trailer";
  return "Truck";
}

type AssetKind = "truck" | "equipment";

function AddAssetDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AssetKind>("truck");
  const [error, setError] = useState<string | null>(null);

  const { data: deptsData } = useListDepartments();
  const depts = deptsData?.departments ?? [];

  const createTruck = useCreateTruck();
  const createEquipment = useCreateEquipment();
  const isPending = createTruck.isPending || createEquipment.isPending;

  const [form, setForm] = useState({
    name: "",
    departmentId: "",
    vehicleType: "TRUCK" as "TRUCK" | "TRAILER",
    brand: "",
    model: "",
    vin: "",
    plate: "",
    serial: "",
    type: "CHAINSAW",
    category: "HANDHELD" as "HANDHELD" | "CUSTOM",
    customCategoryLabel: "",
    purchasePrice: "",
    purchaseDate: "",
    mileage: "",
    serviceIntervalMiles: "",
    hours: "",
    serviceIntervalHours: "",
  });

  function field(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const deptId = Number(form.departmentId);
    if (!form.name.trim()) { setError("Name is required."); return; }
    if (!deptId) { setError("Department is required."); return; }

    try {
      if (kind === "truck") {
        const body: CreateTruckBody = {
          name: form.name.trim(),
          vehicleType: form.vehicleType,
          departmentId: deptId,
          brand: form.brand.trim() || undefined,
          model: form.model.trim() || undefined,
          vin: form.vin.trim() || undefined,
          plate: form.plate.trim() || undefined,
          purchasePriceCents: form.purchasePrice ? Math.round(parseFloat(form.purchasePrice) * 100) : undefined,
          purchaseDate: form.purchaseDate || undefined,
          currentMileage: form.mileage ? Number(form.mileage) : undefined,
          serviceIntervalMiles: form.serviceIntervalMiles ? Number(form.serviceIntervalMiles) : undefined,
        };
        await createTruck.mutateAsync(body);
      } else {
        if (!form.type.trim()) { setError("Equipment type is required."); return; }
        const body: CreateEquipmentBody = {
          name: form.name.trim(),
          type: form.type.trim(),
          category: form.category,
          customCategoryLabel: form.category === "CUSTOM" ? form.customCategoryLabel.trim() : undefined,
          departmentId: deptId,
          brand: form.brand.trim() || undefined,
          model: form.model.trim() || undefined,
          serial: form.serial.trim() || undefined,
          purchasePriceCents: form.purchasePrice ? Math.round(parseFloat(form.purchasePrice) * 100) : undefined,
          purchaseDate: form.purchaseDate || undefined,
          currentHours: form.hours ? Number(form.hours) : undefined,
          serviceIntervalHours: form.serviceIntervalHours ? Number(form.serviceIntervalHours) : undefined,
        };
        await createEquipment.mutateAsync(body);
      }
      onCreated();
      setOpen(false);
      setForm({ name: "", departmentId: "", vehicleType: "TRUCK", brand: "", model: "", vin: "", plate: "", serial: "", type: "CHAINSAW", category: "HANDHELD", customCategoryLabel: "", purchasePrice: "", purchaseDate: "", mileage: "", serviceIntervalMiles: "", hours: "", serviceIntervalHours: "" });
    } catch {
      setError("Failed to create asset. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add Asset
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add New Asset</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind("truck")}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors ${kind === "truck" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent"}`}
            >
              <Truck className="h-4 w-4" /> Truck / Trailer
            </button>
            <button
              type="button"
              onClick={() => setKind("equipment")}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors ${kind === "equipment" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent"}`}
            >
              <Hammer className="h-4 w-4" /> Equipment
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <Label htmlFor="asset-name">Name *</Label>
              <Input id="asset-name" value={form.name} onChange={e => field("name", e.target.value)} placeholder={kind === "truck" ? "T-06 Service Truck" : "Husqvarna Chainsaw"} className="mt-1" />
            </div>

            <div>
              <Label htmlFor="asset-dept">Department *</Label>
              <Select value={form.departmentId} onValueChange={v => field("departmentId", v)}>
                <SelectTrigger id="asset-dept" className="mt-1">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {depts.map((d: { id: number; key: string; label: string }) => (
                    <SelectItem key={d.id} value={String(d.id)}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {kind === "truck" ? (
              <>
                <div>
                  <Label>Type</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {(["TRUCK", "TRAILER"] as const).map(vt => (
                      <button key={vt} type="button" onClick={() => field("vehicleType", vt)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${form.vehicleType === vt ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent"}`}>
                        {vt === "TRUCK" ? "Truck" : "Trailer"}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="asset-brand">Brand</Label>
                    <Input id="asset-brand" value={form.brand} onChange={e => field("brand", e.target.value)} placeholder="Ford" className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="asset-model">Model</Label>
                    <Input id="asset-model" value={form.model} onChange={e => field("model", e.target.value)} placeholder="F-550" className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="asset-vin">VIN</Label>
                    <Input id="asset-vin" value={form.vin} onChange={e => field("vin", e.target.value)} placeholder="1FDXX000..." className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="asset-plate">Plate</Label>
                    <Input id="asset-plate" value={form.plate} onChange={e => field("plate", e.target.value)} placeholder="ABC-1234" className="mt-1" />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="asset-mileage">Current Mileage</Label>
                    <Input id="asset-mileage" type="number" min="0" value={form.mileage} onChange={e => field("mileage", e.target.value)} placeholder="0" className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="asset-interval-mi">Service Interval (mi)</Label>
                    <Input id="asset-interval-mi" type="number" min="0" value={form.serviceIntervalMiles} onChange={e => field("serviceIntervalMiles", e.target.value)} placeholder="5000" className="mt-1" />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="asset-type">Equipment Type *</Label>
                  <Input id="asset-type" value={form.type} onChange={e => field("type", e.target.value)} placeholder="CHAINSAW" className="mt-1" />
                </div>
                <div>
                  <Label>Category</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {(["HANDHELD", "CUSTOM"] as const).map(cat => (
                      <button key={cat} type="button" onClick={() => field("category", cat)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${form.category === cat ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent"}`}>
                        {cat === "HANDHELD" ? "Handheld" : "Custom"}
                      </button>
                    ))}
                  </div>
                </div>
                {form.category === "CUSTOM" && (
                  <div>
                    <Label htmlFor="asset-custom-label">Custom Category Label *</Label>
                    <Input id="asset-custom-label" value={form.customCategoryLabel} onChange={e => field("customCategoryLabel", e.target.value)} placeholder="e.g. Sprayer" className="mt-1" />
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="asset-brand-eq">Brand</Label>
                    <Input id="asset-brand-eq" value={form.brand} onChange={e => field("brand", e.target.value)} placeholder="Husqvarna" className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="asset-model-eq">Model</Label>
                    <Input id="asset-model-eq" value={form.model} onChange={e => field("model", e.target.value)} placeholder="455 Rancher" className="mt-1" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="asset-serial">Serial Number</Label>
                  <Input id="asset-serial" value={form.serial} onChange={e => field("serial", e.target.value)} placeholder="SN-123456" className="mt-1" />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="asset-hours">Current Hours</Label>
                    <Input id="asset-hours" type="number" min="0" value={form.hours} onChange={e => field("hours", e.target.value)} placeholder="0" className="mt-1" />
                  </div>
                  <div>
                    <Label htmlFor="asset-interval-hr">Service Interval (hrs)</Label>
                    <Input id="asset-interval-hr" type="number" min="0" value={form.serviceIntervalHours} onChange={e => field("serviceIntervalHours", e.target.value)} placeholder="50" className="mt-1" />
                  </div>
                </div>
              </>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="asset-price">Purchase Price ($)</Label>
                <Input id="asset-price" type="number" min="0" step="0.01" value={form.purchasePrice} onChange={e => field("purchasePrice", e.target.value)} placeholder="0.00" className="mt-1" />
              </div>
              <div>
                <Label htmlFor="asset-date">Purchase Date</Label>
                <Input id="asset-date" type="date" value={form.purchaseDate} onChange={e => field("purchaseDate", e.target.value)} className="mt-1" />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : `Add ${kind === "truck" ? "Vehicle" : "Equipment"}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AssetRegistry() {
  const { activeDeptId } = useDepartmentFilter();
  const { data, isLoading, refetch } = useListAssets(activeDeptId != null ? { departmentId: activeDeptId } : {});
  const { data: crewsData } = useListCrews();
  const { data: meData } = useGetMe();
  const { data: deptsData } = useListDepartments();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canEditFleet =
    (meData?.user?.permissions?.["fleet.trucks"]?.canEdit ?? false) ||
    (meData?.user?.permissions?.["fleet.equipment"]?.canEdit ?? false);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");
  const [crewFilter, setCrewFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "ACTIVE" | "IN_SHOP" | "RETIRED"
  >("ALL");
  const [dueFilter, setDueFilter] = useState<
    "ALL" | "OVERDUE" | "DUE_SOON" | "OK"
  >("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("SERVICE_DUE");
  // Cost-period view: drives the rightmost spend column + the spend KPI.
  // Defaults to YTD since it's the most actionable period for ops.
  const [costPeriod, setCostPeriod] = useState<
    "MTD" | "YTD" | "LIFETIME"
  >("YTD");
  // Department filter: "ALL" | "UNASSIGNED" | "<deptId>". Driven by
  // the in-page filter, not the org-level activeDeptId (which scopes
  // the entire console).
  const [deptFilterValue, setDeptFilterValue] = useState<string>("ALL");
  // Row selection for bulk assign. Keyed by `${kind}-${id}` to match
  // the table row keys.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const assets = (data?.assets ?? []) as RegistryAsset[];
  const crews = crewsData?.crews ?? [];

  function handleAssetCreated() {
    queryClient.invalidateQueries();
    refetch();
  }

  const filtered = useMemo(() => {
    const list = assets.filter((a) => {
      if (categoryFilter === "COMPACT") {
        if (!(a.category === "CUSTOM" && a.customCategoryLabel === "Compact Equipment")) return false;
      } else if (categoryFilter !== "ALL" && a.category !== categoryFilter) return false;
      if (statusFilter !== "ALL" && a.status !== statusFilter) return false;
      if (dueFilter !== "ALL" && a.serviceState !== dueFilter) return false;
      if (deptFilterValue !== "ALL") {
        if (deptFilterValue === "UNASSIGNED") {
          if (a.departmentId != null) return false;
        } else if (String(a.departmentId ?? "") !== deptFilterValue) {
          return false;
        }
      }
      if (crewFilter !== "ALL") {
        if (crewFilter === "UNASSIGNED") {
          if (a.assignedCrewId != null) return false;
        } else if (String(a.assignedCrewId ?? "") !== crewFilter) {
          return false;
        }
      }
      if (query) {
        const q = query.toLowerCase();
        const haystack = [
          a.name,
          a.brand ?? "",
          a.model ?? "",
          a.identifier ?? "",
          a.customCategoryLabel ?? "",
          a.assignedCrewName ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      if (sortKey === "NAME") return a.name.localeCompare(b.name);
      if (sortKey === "STATUS") return a.status.localeCompare(b.status);
      if (sortKey === "SERVICE_DUE")
        return (
          SERVICE_RANK[a.serviceState as keyof typeof SERVICE_RANK] -
          SERVICE_RANK[b.serviceState as keyof typeof SERVICE_RANK]
        );
      if (sortKey === "YTD_SPEND") return (b.ytdSpendCents ?? 0) - (a.ytdSpendCents ?? 0);
      if (sortKey === "LIFETIME_SPEND") return b.lifeToDateSpendCents - a.lifeToDateSpendCents;
      return 0;
    });
    return list;
  }, [assets, query, categoryFilter, crewFilter, deptFilterValue, statusFilter, dueFilter, sortKey]);

  const totals = useMemo(() => {
    const trackedAssets = assets.filter((a) => a.usageUnit !== "NONE");
    const overdue = trackedAssets.filter((a) => a.serviceState === "OVERDUE").length;
    const dueSoon = trackedAssets.filter((a) => a.serviceState === "DUE_SOON").length;
    const lifetime = assets.reduce((s, a) => s + a.lifeToDateSpendCents, 0);
    const ytd = assets.reduce((s, a) => s + (a.ytdSpendCents ?? 0), 0);
    const mtd = assets.reduce((s, a) => s + (a.mtdSpendCents ?? 0), 0);
    const checkedOut = assets.filter((a) => a.currentHolderUserId != null).length;
    const unassigned = assets.filter((a) => a.departmentId == null).length;
    return { overdue, dueSoon, lifetime, ytd, mtd, count: assets.length, checkedOut, unassigned };
  }, [assets]);

  const periodLabel =
    costPeriod === "MTD" ? "This month" : costPeriod === "YTD" ? "This year" : "All time";
  const periodTotal =
    costPeriod === "MTD" ? totals.mtd : costPeriod === "YTD" ? totals.ytd : totals.lifetime;

  const periodValue = (a: RegistryAsset) =>
    costPeriod === "MTD"
      ? a.mtdSpendCents ?? 0
      : costPeriod === "YTD"
        ? a.ytdSpendCents ?? 0
        : a.lifeToDateSpendCents;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Smart Asset Registry</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every truck and piece of equipment in one place. Scan a QR code or click in to log work.
          </p>
        </div>
        {canEditFleet && <AddAssetDialog onCreated={handleAssetCreated} />}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total Assets" value={isLoading ? "—" : num(totals.count)} icon={Package} />
        <button
          type="button"
          className="text-left transition focus:outline-none focus:ring-2 focus:ring-ring rounded-md"
          onClick={() => setDeptFilterValue("UNASSIGNED")}
          data-testid="kpi-unassigned"
          title="Click to filter to unassigned assets"
        >
          <KpiCard
            label="Needs Department"
            value={isLoading ? "—" : num(totals.unassigned)}
            tone={totals.unassigned > 0 ? "amber" : "neutral"}
            icon={Building2}
          />
        </button>
        <KpiCard
          label="Overdue Service"
          value={isLoading ? "—" : num(totals.overdue)}
          tone={totals.overdue > 0 ? "rose" : "neutral"}
          icon={AlertTriangle}
        />
        <KpiCard
          label="Due Soon"
          value={isLoading ? "—" : num(totals.dueSoon)}
          tone={totals.dueSoon > 0 ? "amber" : "neutral"}
          icon={Clock}
        />
        <KpiCard
          label="Checked Out"
          value={isLoading ? "—" : num(totals.checkedOut)}
          tone={totals.checkedOut > 0 ? "amber" : "neutral"}
          icon={UsersIcon}
        />
        <KpiCard
          label={`Spend · ${periodLabel}`}
          value={isLoading ? "—" : usd(periodTotal)}
          icon={DollarSign}
        />
      </div>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Input
            placeholder="Search by name, brand, model, VIN/serial…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:max-w-sm"
          />
          <Select
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v as CategoryFilter)}
          >
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              <SelectItem value="TRUCK">Trucks</SelectItem>
              <SelectItem value="TRAILER">Trailers</SelectItem>
              <SelectItem value="HANDHELD">Handheld</SelectItem>
              <SelectItem value="COMPACT">Compact Equipment</SelectItem>
              <SelectItem value="CUSTOM">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Select value={crewFilter} onValueChange={(v) => setCrewFilter(v)}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All crews</SelectItem>
              <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              {crews.map((c: Crew) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={deptFilterValue} onValueChange={setDeptFilterValue}>
            <SelectTrigger className="w-full sm:w-[200px]" data-testid="dept-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All departments</SelectItem>
              <SelectItem value="UNASSIGNED">
                Needs Department ({totals.unassigned})
              </SelectItem>
              {(deptsData?.departments ?? []).map((d) => (
                <SelectItem key={d.id} value={String(d.id)}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) =>
              setStatusFilter(v as "ALL" | "ACTIVE" | "IN_SHOP" | "RETIRED")
            }
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="IN_SHOP">In Shop</SelectItem>
              <SelectItem value="RETIRED">Out of Service</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={dueFilter}
            onValueChange={(v) =>
              setDueFilter(v as "ALL" | "OVERDUE" | "DUE_SOON" | "OK")
            }
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All due statuses</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
              <SelectItem value="DUE_SOON">Due soon</SelectItem>
              <SelectItem value="OK">OK</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sortKey}
            onValueChange={(v) => setSortKey(v as SortKey)}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SERVICE_DUE">Sort: Service due</SelectItem>
              <SelectItem value="NAME">Sort: Name A–Z</SelectItem>
              <SelectItem value="STATUS">Sort: Status</SelectItem>
              <SelectItem value="YTD_SPEND">Sort: YTD Spend</SelectItem>
              <SelectItem value="LIFETIME_SPEND">Sort: Lifetime Spend</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={costPeriod}
            onValueChange={(v) => setCostPeriod(v as "MTD" | "YTD" | "LIFETIME")}
          >
            <SelectTrigger className="w-[160px]" data-testid="cost-period-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MTD">Costs: Month</SelectItem>
              <SelectItem value="YTD">Costs: Year</SelectItem>
              <SelectItem value="LIFETIME">Costs: All time</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-3">
            {selectedKeys.size > 0 && canEditFleet && (
              <Button
                size="sm"
                variant="default"
                onClick={() => setBulkOpen(true)}
                data-testid="bulk-assign-trigger"
              >
                <Building2 className="mr-1.5 h-3.5 w-3.5" />
                Assign department ({selectedKeys.size})
              </Button>
            )}
            <div className="text-xs text-muted-foreground">
              Showing <span className="font-mono">{filtered.length}</span> of{" "}
              <span className="font-mono">{assets.length}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {bulkOpen && (
        <BulkAssignDepartmentDialog
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          selected={Array.from(selectedKeys)
            .map((k) => assets.find((a) => `${a.kind}-${a.id}` === k))
            .filter((a): a is RegistryAsset => !!a)}
          departments={deptsData?.departments ?? []}
          onDone={() => {
            setSelectedKeys(new Set());
            setBulkOpen(false);
            queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
            toast({ title: "Departments updated" });
          }}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border bg-card py-12 text-center text-muted-foreground">
          No assets match your filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {canEditFleet && (
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={
                        filtered.length > 0 &&
                        filtered.every((a) => selectedKeys.has(`${a.kind}-${a.id}`))
                      }
                      onCheckedChange={(v) => {
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (v) {
                            for (const a of filtered) next.add(`${a.kind}-${a.id}`);
                          } else {
                            for (const a of filtered) next.delete(`${a.kind}-${a.id}`);
                          }
                          return next;
                        });
                      }}
                      aria-label="Select all visible"
                      data-testid="select-all"
                    />
                  </TableHead>
                )}
                <TableHead className="w-[28%]">Asset</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Crew / Holder</TableHead>
                <TableHead>Status</TableHead>
                {!activeDeptId && <TableHead>Department</TableHead>}
                <TableHead>Service</TableHead>
                <TableHead className="text-right">Usage</TableHead>
                <TableHead className="text-right">
                  Spend · {periodLabel}
                </TableHead>
                <TableHead className="w-[150px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a) => {
                const Icon = categoryIcon(a);
                const tracksUsage = a.usageUnit !== "NONE";
                const usageWord = a.usageUnit === "MILES" ? "miles" : "hours";
                return (
                  <TableRow
                    key={`${a.kind}-${a.id}`}
                    data-testid={`asset-row-${a.slug}`}
                    className={a.departmentId == null ? "bg-amber-50/40" : undefined}
                  >
                    {canEditFleet && (
                      <TableCell>
                        <Checkbox
                          checked={selectedKeys.has(`${a.kind}-${a.id}`)}
                          onCheckedChange={(v) => {
                            const key = `${a.kind}-${a.id}`;
                            setSelectedKeys((prev) => {
                              const next = new Set(prev);
                              if (v) next.add(key);
                              else next.delete(key);
                              return next;
                            });
                          }}
                          aria-label={`Select ${a.name}`}
                          data-testid={`select-${a.slug}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-start gap-3">
                        <AssetThumb
                          slug={a.slug}
                          hasImage={a.hasImage}
                          Icon={Icon}
                        />
                        <div>
                          <Link
                            href={`/assets/${a.slug}`}
                            className="font-semibold hover:underline"
                          >
                            {a.name}
                          </Link>
                          <div className="text-xs text-muted-foreground">
                            {[a.brand, a.model].filter(Boolean).join(" · ") ||
                              "No make/model"}
                          </div>
                          {a.identifier && (
                            <div className="font-mono text-[11px] text-muted-foreground/80">
                              {a.kind === "TRUCK" ? "VIN" : "S/N"} {a.identifier}
                            </div>
                          )}
                          {a.category === "HANDHELD" && a.location && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground/70">
                              <MapPin className="h-3 w-3 shrink-0" />
                              {a.location}
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm">{categoryLabel(a)}</span>
                        {a.quantity > 1 && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            qty {num(a.quantity)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {a.assignedCrewName ? (
                          <span className="flex items-center gap-1 text-sm">
                            <UsersIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                            {a.assignedCrewName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            Unassigned crew
                          </span>
                        )}
                        {a.currentHolderName ? (
                          <span
                            className="flex items-center gap-1 text-[11px] font-medium text-amber-900"
                            data-testid={`asset-holder-${a.slug}`}
                            title={
                              a.currentCheckoutSince
                                ? `Out since ${new Date(a.currentCheckoutSince).toLocaleString()}`
                                : undefined
                            }
                          >
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
                            With {a.currentHolderName}
                          </span>
                        ) : a.lastHolderName ? (
                          <span
                            className="text-[11px] text-muted-foreground"
                            title={
                              a.lastCheckedOutAt
                                ? `Last out ${new Date(a.lastCheckedOutAt).toLocaleDateString()}`
                                : undefined
                            }
                          >
                            Last: {a.lastHolderName}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusBadgeClass(a.status)}>
                        {statusLabel(a.status)}
                      </Badge>
                    </TableCell>
                    {!activeDeptId && (
                      <TableCell>
                        {a.departmentName ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Building2 className="h-3 w-3 shrink-0" />
                            {a.departmentName}
                          </span>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-300 bg-amber-100 text-amber-900 text-[10px]"
                          >
                            Needs Department
                          </Badge>
                        )}
                      </TableCell>
                    )}
                    <TableCell>
                      {tracksUsage ? (
                        <div className="space-y-1">
                          <ServiceBadge state={a.serviceState} />
                          <div className="text-xs text-muted-foreground">
                            {a.usageUntilDue >= 0
                              ? `${num(a.usageUntilDue)} ${usageWord} until due`
                              : `${num(Math.abs(a.usageUntilDue))} ${usageWord} overdue`}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">N/A</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {tracksUsage ? (
                        <>
                          {num(a.currentUsage)}
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {a.usageUnit === "MILES" ? "miles" : "hours"}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      {usd(periodValue(a))}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="gap-1"
                          data-testid={`asset-open-${a.slug}`}
                        >
                          <Link href={`/assets/${a.slug}`}>
                            <QrCode className="h-3.5 w-3.5" />
                            Open
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                        {canEditFleet && (
                          <>
                            <EditAssetButton asset={a} />
                            <DeleteAssetButton
                              kind={a.kind}
                              id={a.id}
                              name={a.name}
                            />
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// Per-row delete control for an asset. Trucks and equipment live in
// different tables, so we pick the right mutation by `kind` and let the
// existing delete-guard server flow handle "in use" cases — if the asset
// is referenced (maintenance logs, open checkouts, etc.) the server
// turns it into a pending delete request instead of a hard delete, and
// deleteOutcomeToast surfaces that to the user.
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
  const deleteTruck = useDeleteTruck();
  const deleteEquipment = useDeleteEquipment();
  const isPending = deleteTruck.isPending || deleteEquipment.isPending;

  function handleDelete() {
    const onSuccess = (result: unknown) => {
      queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
      queryClient.invalidateQueries({ queryKey: DELETE_REQUESTS_PENDING_COUNT_KEY });
      toast(deleteOutcomeToast(result, `${name} deleted`));
    };
    const onError = () =>
      toast({
        title: "Error deleting asset",
        description: `Couldn't delete ${name}. Please try again.`,
        variant: "destructive",
      });
    if (kind === "TRUCK") {
      deleteTruck.mutate({ id }, { onSuccess, onError });
    } else {
      deleteEquipment.mutate({ id }, { onSuccess, onError });
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Delete ${name}`}
          data-testid={`asset-delete-${id}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this asset?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove <span className="font-semibold">{name}</span> from the
            registry. If the asset has maintenance logs or open checkouts,
            this will create a deletion request for an admin to approve
            instead of removing it immediately.
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

function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "rose" | "amber";
}) {
  const toneClass =
    tone === "rose"
      ? "text-rose-700"
      : tone === "amber"
        ? "text-amber-700"
        : "text-foreground";
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

// Tiny thumbnail used in the registry table. Lazily fetches the full
// data-URL only when `hasImage` is true so rows without photos cost
// nothing extra.
function AssetThumb({
  slug,
  hasImage,
  Icon,
}: {
  slug: string;
  hasImage: boolean;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const { data } = useAssetImage(slug, hasImage);
  return (
    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground">
      {hasImage && data?.imageDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={data.imageDataUrl}
          alt=""
          className="h-full w-full object-cover"
        />
      ) : (
        <Icon className="h-4 w-4" />
      )}
    </div>
  );
}

// Bulk-assign-department dialog: takes the selected rows and PATCHes
// each truck/equipment with the chosen departmentId. Falls back to a
// per-row mutation loop because the existing PATCH endpoints only take
// one id at a time — for the 250-row asset-3.xlsx import this is still
// fast enough (one request per row, completes in a few seconds).
function BulkAssignDepartmentDialog({
  open,
  onClose,
  selected,
  departments,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  selected: RegistryAsset[];
  departments: Array<{ id: number; label: string }>;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<string>("");
  const [running, setRunning] = useState(false);
  const updateTruck = useUpdateTruck();
  const updateEquipment = useUpdateEquipment();

  const onSubmit = async () => {
    const deptId = target === "UNASSIGN" ? null : Number(target);
    if (target !== "UNASSIGN" && !Number.isFinite(deptId as number)) return;
    setRunning(true);
    try {
      // Run sequentially to keep request volume bounded and so a single
      // failed row doesn't take down the whole batch silently.
      for (const a of selected) {
        if (a.kind === "TRUCK") {
          await updateTruck.mutateAsync({
            id: a.id,
            data: { departmentId: deptId as number | null },
          });
        } else {
          await updateEquipment.mutateAsync({
            id: a.id,
            data: { departmentId: deptId as number | null },
          });
        }
      }
      onDone();
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign department to {selected.length} asset{selected.length === 1 ? "" : "s"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Pick a department to assign every selected asset to. Use{" "}
            <strong>Unassign</strong> to send them back to the Needs
            Department bucket.
          </p>
          <div className="space-y-2">
            <Label htmlFor="bulk-dept-select">Department</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="bulk-dept-select" data-testid="bulk-dept-select">
                <SelectValue placeholder="Pick a department…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="UNASSIGN">— Unassign (clear) —</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 text-xs">
            {selected.slice(0, 25).map((a) => (
              <div key={`${a.kind}-${a.id}`} className="truncate text-muted-foreground">
                · {a.name}
              </div>
            ))}
            {selected.length > 25 && (
              <div className="mt-1 text-muted-foreground/70">
                …and {selected.length - 25} more
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={running}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onSubmit}
              disabled={!target || running}
              data-testid="bulk-dept-submit"
            >
              {running ? `Updating ${selected.length}…` : "Apply"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
