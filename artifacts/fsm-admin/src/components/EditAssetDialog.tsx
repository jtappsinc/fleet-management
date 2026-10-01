import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDepartments,
  useSetAssetStatus,
  getGetAssetBySlugQueryKey,
  getGetAssetStatusHistoryQueryKey,
  getListAssetsQueryKey,
  getGetFleetPulseQueryKey,
} from "@workspace/api-client-react";
import {
  useListCrews,
  useAssignAsset,
  useUpdateTruckExt,
  useUpdateEquipmentExt,
  getAssignmentHistoryKey,
  type UpdateTruckExtBody,
  type UpdateEquipmentExtBody,
} from "@/lib/extra-api";
import { useDepartmentFilter } from "@/context/DepartmentContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Pencil } from "lucide-react";

// The minimum slice of an asset the dialog needs to pre-fill every field.
// Both the registry row (`/assets`) and the detail page (`/assets/:slug`)
// carry all of these, so either can open the dialog directly.
export type EditableAsset = {
  kind: "TRUCK" | "EQUIPMENT";
  id: number;
  slug: string;
  name: string;
  category: "TRUCK" | "TRAILER" | "HANDHELD" | "CUSTOM";
  customCategoryLabel?: string | null;
  quantity: number;
  brand?: string | null;
  model?: string | null;
  identifier?: string | null;
  plate?: string | null;
  equipmentType?: string | null;
  status: string;
  departmentId?: number | null;
  assignedCrewId?: number | null;
  purchasePriceCents?: number | null;
  purchaseDate?: string | null;
  location?: string | null;
  currentUsage: number;
  serviceIntervalUsage: number;
  usageUnit: "MILES" | "HOURS" | "NONE";
  year?: number | null;
  statedValueCents?: number | null;
  gvwGcwLbs?: number | null;
  garagingState?: string | null;
  operatingRadiusMiles?: number | null;
  insuranceVehNumber?: number | null;
  bodyTypeCode?: string | null;
};

type FormState = {
  name: string;
  vehicleType: "TRUCK" | "TRAILER";
  category: "HANDHELD" | "CUSTOM";
  customCategoryLabel: string;
  quantity: string;
  equipmentType: string;
  brand: string;
  model: string;
  identifier: string;
  plate: string;
  location: string;
  status: "ACTIVE" | "IN_SHOP" | "RETIRED";
  departmentId: string; // "" | "UNASSIGN" | "<id>"
  crewId: string; // "NONE" | "<id>"
  purchasePrice: string; // dollars
  purchaseDate: string; // yyyy-mm-dd
  currentUsage: string;
  serviceInterval: string;
  year: string;
  statedValue: string; // dollars
  gvwGcwLbs: string;
  garagingState: string;
  operatingRadiusMiles: string;
  insuranceVehNumber: string;
  bodyTypeCode: string;
};

const toDollars = (cents: number | null | undefined) =>
  cents != null ? (cents / 100).toFixed(2) : "";
const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const toStr = (n: number | string | null | undefined) =>
  n == null ? "" : String(n);

function buildInitial(a: EditableAsset): FormState {
  return {
    name: a.name,
    vehicleType: a.category === "TRAILER" ? "TRAILER" : "TRUCK",
    category: a.category === "CUSTOM" ? "CUSTOM" : "HANDHELD",
    customCategoryLabel: a.customCategoryLabel ?? "",
    quantity: toStr(a.quantity),
    equipmentType: a.equipmentType ?? "",
    brand: a.brand ?? "",
    model: a.model ?? "",
    identifier: a.identifier ?? "",
    plate: a.plate ?? "",
    location: a.location ?? "",
    status: (a.status as FormState["status"]) ?? "ACTIVE",
    departmentId: a.departmentId != null ? String(a.departmentId) : "UNASSIGN",
    crewId: a.assignedCrewId != null ? String(a.assignedCrewId) : "NONE",
    purchasePrice: toDollars(a.purchasePriceCents),
    purchaseDate: toDateInput(a.purchaseDate),
    currentUsage: toStr(a.currentUsage),
    serviceInterval: toStr(a.serviceIntervalUsage),
    year: toStr(a.year),
    statedValue: toDollars(a.statedValueCents),
    gvwGcwLbs: toStr(a.gvwGcwLbs),
    garagingState: a.garagingState ?? "",
    operatingRadiusMiles: toStr(a.operatingRadiusMiles),
    insuranceVehNumber: toStr(a.insuranceVehNumber),
    bodyTypeCode: a.bodyTypeCode ?? "",
  };
}

// Parse helpers: empty string → null (clear), otherwise a validated number.
// Returning `undefined` means "invalid" and blocks submit with a message.
function parseIntOrNull(raw: string, opts?: { min?: number; max?: number }) {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  if (opts?.min != null && n < opts.min) return undefined;
  if (opts?.max != null && n > opts.max) return undefined;
  return n;
}
function parseCentsOrNull(raw: string) {
  const s = raw.trim().replace(/[$,]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}
const textOrNull = (raw: string) => {
  const s = raw.trim();
  return s === "" ? null : s;
};

export function EditAssetDialog({
  asset,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: EditableAsset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const { isAdmin } = useDepartmentFilter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: deptsData } = useListDepartments();
  const { data: crewsData } = useListCrews();
  const departments = deptsData?.departments ?? [];
  const crews = crewsData?.crews ?? [];

  const updateTruck = useUpdateTruckExt();
  const updateEquipment = useUpdateEquipmentExt();
  const setStatus = useSetAssetStatus();
  const assign = useAssignAsset(asset.slug);

  // `initial` is a snapshot taken when the dialog opens. The diff on
  // submit compares against this snapshot — not the live `asset` prop —
  // so a background refetch while the form is open can neither reset
  // what the user has typed nor change which fields count as "touched".
  const [initial, setInitial] = useState<FormState>(() => buildInitial(asset));
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const snapshot = buildInitial(asset);
      setInitial(snapshot);
      setForm(snapshot);
      setError(null);
    }
    // Only re-seed on open/close transitions — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const field = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isTruck = asset.kind === "TRUCK";
  const isTrailer = isTruck && form.vehicleType === "TRAILER";
  const usageLabel = isTruck ? "Current mileage" : "Current hours";
  const intervalLabel = isTruck ? "Service interval (mi)" : "Service interval (hrs)";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }
    if (!isTruck && !form.equipmentType.trim()) {
      setError("Equipment type is required.");
      return;
    }
    if (!isTruck && form.category === "CUSTOM" && !form.customCategoryLabel.trim()) {
      setError("Custom items need a category label.");
      return;
    }

    // Numeric fields — every one is validated up front so a single bad
    // value doesn't leave the asset half-updated.
    const purchasePriceCents = parseCentsOrNull(form.purchasePrice);
    if (purchasePriceCents === undefined) { setError("Purchase price must be a positive amount."); return; }
    const currentUsage = parseIntOrNull(form.currentUsage, { min: 0 });
    if (currentUsage === undefined) { setError(`${usageLabel} must be a whole number ≥ 0.`); return; }
    const serviceInterval = parseIntOrNull(form.serviceInterval, { min: 0 });
    if (serviceInterval === undefined) { setError(`${intervalLabel} must be a whole number ≥ 0.`); return; }
    const quantity = parseIntOrNull(form.quantity, { min: 1 });
    if (!isTruck && (quantity === undefined || quantity === null)) { setError("Quantity must be a whole number ≥ 1."); return; }
    const year = parseIntOrNull(form.year, { min: 1900, max: 2100 });
    if (year === undefined) { setError("Year must be between 1900 and 2100."); return; }
    const statedValueCents = parseCentsOrNull(form.statedValue);
    if (statedValueCents === undefined) { setError("Stated value must be a positive amount."); return; }
    const gvwGcwLbs = parseIntOrNull(form.gvwGcwLbs, { min: 0 });
    if (gvwGcwLbs === undefined) { setError("GVW / GCW must be a whole number ≥ 0."); return; }
    const operatingRadiusMiles = parseIntOrNull(form.operatingRadiusMiles, { min: 0 });
    if (operatingRadiusMiles === undefined) { setError("Operating radius must be a whole number ≥ 0."); return; }
    const insuranceVehNumber = parseIntOrNull(form.insuranceVehNumber, { min: 0 });
    if (insuranceVehNumber === undefined) { setError("Insurance vehicle # must be a whole number ≥ 0."); return; }
    const garagingState = form.garagingState.trim().toUpperCase();
    if (garagingState && !/^[A-Z]{2}$/.test(garagingState)) { setError("Garaging state must be a 2-letter code (e.g. FL)."); return; }

    // Diff against the initial snapshot so we only PATCH what changed —
    // keeps the audit trail honest and avoids clobbering a column another
    // user edited in the meantime.
    const changed = <K extends keyof FormState>(k: K) => form[k] !== initial[k];
    const truckPatch: UpdateTruckExtBody = {};
    const equipPatch: UpdateEquipmentExtBody = {};
    const patch: Record<string, unknown> = isTruck ? truckPatch : equipPatch;

    if (changed("name")) patch.name = name;
    if (changed("brand")) patch.brand = textOrNull(form.brand);
    if (changed("model")) patch.model = textOrNull(form.model);
    if (changed("purchasePrice")) patch.purchasePriceCents = purchasePriceCents;
    if (changed("purchaseDate")) patch.purchaseDate = form.purchaseDate || null;
    if (isAdmin && changed("departmentId")) {
      patch.departmentId = form.departmentId === "UNASSIGN" ? null : Number(form.departmentId);
    }
    if (isTruck) {
      if (changed("vehicleType")) truckPatch.vehicleType = form.vehicleType;
      if (changed("identifier")) truckPatch.vin = textOrNull(form.identifier);
      if (changed("plate")) truckPatch.plate = textOrNull(form.plate);
      if (changed("currentUsage") && currentUsage != null) truckPatch.currentMileage = currentUsage;
      if (changed("serviceInterval") && serviceInterval != null) truckPatch.serviceIntervalMiles = serviceInterval;
      if (changed("year")) truckPatch.year = year;
      if (changed("statedValue")) truckPatch.statedValueCents = statedValueCents;
      if (changed("gvwGcwLbs")) truckPatch.gvwGcwLbs = gvwGcwLbs;
      if (changed("garagingState")) truckPatch.garagingState = garagingState || null;
      if (changed("operatingRadiusMiles")) truckPatch.operatingRadiusMiles = operatingRadiusMiles;
      if (changed("insuranceVehNumber")) truckPatch.insuranceVehNumber = insuranceVehNumber;
      if (changed("bodyTypeCode")) truckPatch.bodyTypeCode = textOrNull(form.bodyTypeCode);
    } else {
      if (changed("equipmentType")) equipPatch.type = form.equipmentType.trim();
      if (changed("category")) equipPatch.category = form.category;
      if (changed("customCategoryLabel") || (changed("category") && form.category === "CUSTOM")) {
        equipPatch.customCategoryLabel =
          form.category === "CUSTOM" ? form.customCategoryLabel.trim() : null;
      }
      if (changed("quantity") && quantity != null) equipPatch.quantity = quantity;
      if (changed("identifier")) equipPatch.serial = textOrNull(form.identifier);
      if (changed("location")) equipPatch.location = textOrNull(form.location);
      if (changed("currentUsage") && currentUsage != null) equipPatch.currentHours = currentUsage;
      if (changed("serviceInterval") && serviceInterval != null) equipPatch.serviceIntervalHours = serviceInterval;
    }

    const statusChanged = changed("status");
    const crewChanged = changed("crewId");
    const hasPatch = Object.keys(patch).length > 0;

    if (!hasPatch && !statusChanged && !crewChanged) {
      onOpenChange(false);
      return;
    }

    setSaving(true);
    // Three independent writes (field PATCH, status, crew). Track which
    // ones landed so a refusal on a later step reports exactly what did
    // and didn't save instead of a blanket "failed".
    const done: string[] = [];
    let failedStep: string | null = null;
    let failedStatus: number | null = null;
    const statusOf = (err: unknown) =>
      err && typeof err === "object" && "status" in err
        ? ((err as { status?: number }).status ?? null)
        : null;
    try {
      if (hasPatch) {
        try {
          if (isTruck) await updateTruck.mutateAsync({ id: asset.id, data: truckPatch });
          else await updateEquipment.mutateAsync({ id: asset.id, data: equipPatch });
          done.push("details");
        } catch (err) {
          failedStep = "details";
          failedStatus = statusOf(err);
          throw err;
        }
      }
      // Status + crew go through their dedicated endpoints so the status
      // log and assignment log keep recording who changed what.
      if (statusChanged) {
        try {
          await setStatus.mutateAsync({ slug: asset.slug, data: { status: form.status } });
          done.push("status");
        } catch (err) {
          failedStep = "status";
          failedStatus = statusOf(err);
          throw err;
        }
      }
      if (crewChanged) {
        try {
          await assign.mutateAsync({
            crewId: form.crewId === "NONE" ? null : Number(form.crewId),
          });
          done.push("crew assignment");
        } catch (err) {
          failedStep = "crew assignment";
          failedStatus = statusOf(err);
          throw err;
        }
      }
      toast({ title: `${name} updated` });
      onSaved?.();
      onOpenChange(false);
    } catch {
      const why =
        failedStatus === 403
          ? "you don't have permission for that change"
          : failedStatus === 400
            ? "the server rejected the values"
            : "the request failed";
      const saved = done.length > 0 ? `Saved ${done.join(" and ")}, but ` : "";
      setError(`${saved}${failedStep ?? "the update"} was not saved — ${why}. Please review and try again.`);
    } finally {
      // Invalidate regardless of outcome: a partial save has already
      // changed server state and the page should reflect it.
      if (done.length > 0) {
        queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFleetPulseQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAssetBySlugQueryKey(asset.slug) });
        queryClient.invalidateQueries({ queryKey: getGetAssetStatusHistoryQueryKey(asset.slug) });
        queryClient.invalidateQueries({ queryKey: getAssignmentHistoryKey(asset.slug) });
        queryClient.invalidateQueries({ queryKey: ["crews"] });
      }
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Edit {isTruck ? "vehicle" : "equipment"}
          </DialogTitle>
          <DialogDescription>
            Every field on this record can be changed. Only the fields you
            touch are saved.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-1" data-testid="edit-asset-form">
          {/* ---- Identity ---- */}
          <section className="space-y-3">
            <SectionLabel>Identity</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="ea-name">Name *</Label>
                <Input id="ea-name" value={form.name} onChange={(e) => field("name", e.target.value)} className="mt-1" autoFocus />
              </div>
              {isTruck ? (
                <div className="sm:col-span-2">
                  <Label>Vehicle type</Label>
                  <div className="mt-1 grid grid-cols-2 gap-2">
                    {(["TRUCK", "TRAILER"] as const).map((vt) => (
                      <button
                        key={vt}
                        type="button"
                        onClick={() => field("vehicleType", vt)}
                        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${form.vehicleType === vt ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent"}`}
                      >
                        {vt === "TRUCK" ? "Truck" : "Trailer"}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <Label htmlFor="ea-type">Equipment type *</Label>
                    <Input id="ea-type" value={form.equipmentType} onChange={(e) => field("equipmentType", e.target.value)} placeholder="CHAINSAW" className="mt-1" />
                  </div>
                  <div>
                    <Label>Category</Label>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      {(["HANDHELD", "CUSTOM"] as const).map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => field("category", cat)}
                          className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${form.category === cat ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-accent"}`}
                        >
                          {cat === "HANDHELD" ? "Handheld" : "Custom"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {form.category === "CUSTOM" && (
                    <div>
                      <Label htmlFor="ea-custom-label">Custom category label *</Label>
                      <Input id="ea-custom-label" value={form.customCategoryLabel} onChange={(e) => field("customCategoryLabel", e.target.value)} placeholder="e.g. Compact Equipment" className="mt-1" />
                    </div>
                  )}
                  <div>
                    <Label htmlFor="ea-qty">Quantity</Label>
                    <Input id="ea-qty" type="number" min="1" step="1" value={form.quantity} onChange={(e) => field("quantity", e.target.value)} className="mt-1" />
                  </div>
                </>
              )}
              <div>
                <Label htmlFor="ea-brand">Brand / make</Label>
                <Input id="ea-brand" value={form.brand} onChange={(e) => field("brand", e.target.value)} placeholder={isTruck ? "Ford" : "Husqvarna"} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ea-model">Model</Label>
                <Input id="ea-model" value={form.model} onChange={(e) => field("model", e.target.value)} placeholder={isTruck ? "F-550" : "455 Rancher"} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="ea-ident">{isTruck ? "VIN" : "Serial number"}</Label>
                <Input id="ea-ident" value={form.identifier} onChange={(e) => field("identifier", e.target.value)} placeholder={isTruck ? "1FDXX000…" : "SN-123456"} className="mt-1 font-mono" />
              </div>
              {isTruck ? (
                <div>
                  <Label htmlFor="ea-plate">License plate</Label>
                  <Input id="ea-plate" value={form.plate} onChange={(e) => field("plate", e.target.value)} placeholder="ABC-1234" className="mt-1 font-mono" />
                </div>
              ) : (
                <div>
                  <Label htmlFor="ea-location">Storage location</Label>
                  <Input id="ea-location" value={form.location} onChange={(e) => field("location", e.target.value)} placeholder="e.g. Tree Yard" className="mt-1" />
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* ---- Ownership ---- */}
          <section className="space-y-3">
            <SectionLabel>Ownership & status</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="ea-status">Status</Label>
                <Select value={form.status} onValueChange={(v) => field("status", v as FormState["status"])}>
                  <SelectTrigger id="ea-status" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="IN_SHOP">In Shop</SelectItem>
                    <SelectItem value="RETIRED">Out of Service</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ea-crew">Assigned crew</Label>
                <Select value={form.crewId} onValueChange={(v) => field("crewId", v)}>
                  <SelectTrigger id="ea-crew" className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Unassigned</SelectItem>
                    {crews.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ea-dept">Department</Label>
                <Select
                  value={form.departmentId}
                  onValueChange={(v) => field("departmentId", v)}
                  disabled={!isAdmin}
                >
                  <SelectTrigger id="ea-dept" className="mt-1"><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNASSIGN">— Unassigned —</SelectItem>
                    {departments.map((d: { id: number; label: string }) => (
                      <SelectItem key={d.id} value={String(d.id)}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isAdmin && (
                  <p className="mt-1 text-[11px] text-muted-foreground">Only admins can move assets between departments.</p>
                )}
              </div>
            </div>
          </section>

          <Separator />

          {/* ---- Usage & service ---- */}
          {!isTrailer && (
            <>
              <section className="space-y-3">
                <SectionLabel>Usage & service</SectionLabel>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="ea-usage">{usageLabel}</Label>
                    <Input id="ea-usage" type="number" min="0" step="1" value={form.currentUsage} onChange={(e) => field("currentUsage", e.target.value)} className="mt-1 font-mono" />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Sets the {isTruck ? "odometer" : "hour meter"} directly. Use this to correct a bad reading.
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="ea-interval">{intervalLabel}</Label>
                    <Input id="ea-interval" type="number" min="0" step="1" value={form.serviceInterval} onChange={(e) => field("serviceInterval", e.target.value)} className="mt-1 font-mono" />
                  </div>
                </div>
              </section>
              <Separator />
            </>
          )}

          {/* ---- Purchase ---- */}
          <section className="space-y-3">
            <SectionLabel>Purchase</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ea-price">Purchase price ($)</Label>
                <Input id="ea-price" type="number" min="0" step="0.01" value={form.purchasePrice} onChange={(e) => field("purchasePrice", e.target.value)} placeholder="0.00" className="mt-1 font-mono" />
              </div>
              <div>
                <Label htmlFor="ea-date">Purchase date</Label>
                <Input id="ea-date" type="date" value={form.purchaseDate} onChange={(e) => field("purchaseDate", e.target.value)} className="mt-1" />
              </div>
            </div>
          </section>

          {/* ---- Insurance (vehicles only) ---- */}
          {isTruck && (
            <>
              <Separator />
              <section className="space-y-3">
                <SectionLabel>Insurance schedule</SectionLabel>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <Label htmlFor="ea-year">Year</Label>
                    <Input id="ea-year" type="number" min="1900" max="2100" value={form.year} onChange={(e) => field("year", e.target.value)} className="mt-1 font-mono" />
                  </div>
                  <div>
                    <Label htmlFor="ea-veh">Ins. vehicle #</Label>
                    <Input id="ea-veh" type="number" min="0" value={form.insuranceVehNumber} onChange={(e) => field("insuranceVehNumber", e.target.value)} className="mt-1 font-mono" />
                  </div>
                  <div>
                    <Label htmlFor="ea-body">Body type code</Label>
                    <Input id="ea-body" value={form.bodyTypeCode} onChange={(e) => field("bodyTypeCode", e.target.value)} placeholder="PU / DMP / …" className="mt-1 font-mono" />
                  </div>
                  <div>
                    <Label htmlFor="ea-state">Garaging state</Label>
                    <Input id="ea-state" value={form.garagingState} onChange={(e) => field("garagingState", e.target.value)} placeholder="FL" maxLength={2} className="mt-1 font-mono uppercase" />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="ea-stated">Stated value ($)</Label>
                    <Input id="ea-stated" type="number" min="0" step="0.01" value={form.statedValue} onChange={(e) => field("statedValue", e.target.value)} className="mt-1 font-mono" />
                  </div>
                  <div>
                    <Label htmlFor="ea-gvw">GVW / GCW (lbs)</Label>
                    <Input id="ea-gvw" type="number" min="0" value={form.gvwGcwLbs} onChange={(e) => field("gvwGcwLbs", e.target.value)} className="mt-1 font-mono" />
                  </div>
                  <div>
                    <Label htmlFor="ea-radius">Op. radius (mi)</Label>
                    <Input id="ea-radius" type="number" min="0" value={form.operatingRadiusMiles} onChange={(e) => field("operatingRadiusMiles", e.target.value)} className="mt-1 font-mono" />
                  </div>
                </div>
              </section>
            </>
          )}

          {error && <p className="text-sm text-destructive" data-testid="edit-asset-error">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} data-testid="edit-asset-submit">
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
      {children}
    </div>
  );
}

/** Small pencil icon button that opens the dialog — used by the registry rows. */
export function EditAssetButton({
  asset,
  onSaved,
  variant = "icon",
}: {
  asset: EditableAsset;
  onSaved?: () => void;
  variant?: "icon" | "button";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "icon" ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={`Edit ${asset.name}`}
          title="Edit details"
          onClick={() => setOpen(true)}
          data-testid={`asset-edit-${asset.id}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setOpen(true)}
          data-testid="asset-edit-button"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit details
        </Button>
      )}
      {open && (
        <EditAssetDialog asset={asset} open={open} onOpenChange={setOpen} onSaved={onSaved} />
      )}
    </>
  );
}
