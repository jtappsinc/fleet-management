import { useMemo, useRef, useState } from "react";
import {
  useListMaintenanceLogs, useCreateMaintenanceLog, useUpdateMaintenanceLog, useDeleteMaintenanceLog, getListMaintenanceLogsQueryKey,
  useListTrucks, useListEquipment, useListDepartments,
  type MaintenanceLog,
} from "@workspace/api-client-react";
import {
  useUpdateMaintenanceReceipt,
  useMaintenanceReceipt,
  type MaintenanceReceiptCategory,
} from "@/lib/extra-api";
import { useDepartmentFilter } from "@/context/DepartmentContext";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Edit,
  Trash2,
  Plus,
  Paperclip,
  Upload,
  Download,
  X,
  Search,
  Wrench,
  DollarSign,
  Receipt,
  Filter,
} from "lucide-react";
import { rowsToCsv, downloadCsv } from "@/lib/csv";
import { PageHeader } from "@/components/layout/PageHeader";
import { deleteOutcomeToast } from "@/lib/delete-outcome";
import { DELETE_REQUESTS_PENDING_COUNT_KEY } from "@/lib/extra-api";

const usd = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100);

// Server widens MaintenanceLog with hasReceipt + accountant-facing
// fields. The orval-generated type doesn't know about them yet, so we
// intersect at the call site like the rest of extra-api does.
export type MaintenanceLogExt = MaintenanceLog & {
  vendor?: string | null;
  category?: MaintenanceReceiptCategory | null;
  notes?: string | null;
  hasReceipt?: boolean;
  // Free-text performer (new) and the resolved name for the legacy
  // performedByUserId link (older rows). See performerName().
  performedByName?: string | null;
  performedByUserName?: string | null;
};

/** Who did the work: the typed name wins; older rows fall back to the linked user. */
export function performerName(log: MaintenanceLogExt): string | null {
  const typed = log.performedByName?.trim();
  if (typed) return typed;
  return log.performedByUserName?.trim() || null;
}

const RECEIPT_CATEGORIES: { value: MaintenanceReceiptCategory; label: string }[] = [
  { value: "LABOR", label: "Labor" },
  { value: "PARTS", label: "Parts" },
  { value: "FUEL", label: "Fuel" },
  { value: "OUTSOURCED", label: "Outsourced" },
  { value: "OTHER", label: "Other" },
];

// Server returns these fields on every truck/equipment row but the
// orval-generated `Truck` / `Equipment` types don't surface them. We
// widen at the call site so we can resolve a maintenance log's
// department through its asset without a schema change.
type WithDept = { id: number; name: string; departmentId?: number | null };

export function Maintenance() {
  const { activeDeptId } = useDepartmentFilter();
  const deptParams = activeDeptId != null ? { departmentId: activeDeptId } : {};
  const { data, isLoading } = useListMaintenanceLogs(deptParams);
  const { data: trucksData } = useListTrucks(deptParams);
  const { data: equipmentData } = useListEquipment(deptParams);
  const { data: deptsData } = useListDepartments();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [previewLogId, setPreviewLogId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [receiptFilter, setReceiptFilter] = useState<string>("ALL");

  // Build asset → { name, departmentId } lookups. Maintenance logs
  // inherit their department from the underlying truck/equipment, so
  // these maps power both the table's Department column and the
  // form's read-only department display.
  const truckById = useMemo(
    () =>
      new Map(
        ((trucksData?.trucks ?? []) as unknown as WithDept[]).map(
          (t) => [t.id, t] as const,
        ),
      ),
    [trucksData],
  );
  const equipmentById = useMemo(
    () =>
      new Map(
        ((equipmentData?.equipment ?? []) as unknown as WithDept[]).map(
          (e) => [e.id, e] as const,
        ),
      ),
    [equipmentData],
  );
  const deptLabelById = useMemo(
    () =>
      new Map(
        (deptsData?.departments ?? []).map(
          (d: { id: number; label: string }) => [d.id, d.label] as const,
        ),
      ),
    [deptsData],
  );

  function assetName(log: MaintenanceLogExt): string {
    if (log.truckId) return truckById.get(log.truckId)?.name ?? `Truck #${log.truckId}`;
    if (log.equipmentId)
      return equipmentById.get(log.equipmentId)?.name ?? `Equipment #${log.equipmentId}`;
    return "Unknown";
  }

  function logDepartmentId(log: MaintenanceLogExt): number | null {
    if (log.truckId) return truckById.get(log.truckId)?.departmentId ?? null;
    if (log.equipmentId)
      return equipmentById.get(log.equipmentId)?.departmentId ?? null;
    return null;
  }

  function logDepartmentLabel(log: MaintenanceLogExt): string | null {
    const id = logDepartmentId(log);
    if (id == null) return null;
    return deptLabelById.get(id) ?? null;
  }

  const allLogs = useMemo(
    () => ((data?.logs ?? []) as MaintenanceLogExt[]),
    [data],
  );

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allLogs.filter((log) => {
      if (kindFilter !== "ALL" && log.kind !== kindFilter) return false;
      if (categoryFilter !== "ALL") {
        if (categoryFilter === "NONE" && log.category) return false;
        if (categoryFilter !== "NONE" && log.category !== categoryFilter)
          return false;
      }
      if (receiptFilter === "WITH" && !log.hasReceipt) return false;
      if (receiptFilter === "WITHOUT" && log.hasReceipt) return false;
      if (q) {
        const haystack = [
          assetName(log),
          log.description,
          log.vendor ?? "",
          log.notes ?? "",
          log.loggedByName ?? "",
          performerName(log) ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // assetName is derived from in-memory maps that change with deptParams,
    // and the filters are local — no need to memo across the asset name fn
    // separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLogs, search, kindFilter, categoryFilter, receiptFilter, truckById, equipmentById]);

  // Summary stats reflect the *filtered* set so the numbers always
  // match what the table is showing — the accountant can scope by
  // dept + filter and instantly read the totals.
  const stats = useMemo(() => {
    let totalCents = 0;
    let laborCents = 0;
    let partsCents = 0;
    let withReceipt = 0;
    const byCategory: Record<string, { count: number; cents: number }> = {};
    for (const log of filteredLogs) {
      totalCents += log.costCents ?? 0;
      laborCents += log.laborCostCents ?? 0;
      partsCents += log.partsCostCents ?? 0;
      if (log.hasReceipt) withReceipt += 1;
      const key = log.category ?? "UNCATEGORIZED";
      const bucket = (byCategory[key] ??= { count: 0, cents: 0 });
      bucket.count += 1;
      bucket.cents += log.costCents ?? 0;
    }
    return {
      count: filteredLogs.length,
      totalCents,
      laborCents,
      partsCents,
      withReceipt,
      byCategory,
    };
  }, [filteredLogs]);

  function handleExport() {
    const csv = rowsToCsv(filteredLogs, [
      { header: "Date", value: (l) => new Date(l.performedAt).toISOString().slice(0, 10) },
      { header: "Asset", value: (l) => assetName(l) },
      { header: "Department", value: (l) => logDepartmentLabel(l) ?? "" },
      { header: "Kind", value: (l) => l.kind },
      { header: "Category", value: (l) => l.category ?? "" },
      { header: "Vendor", value: (l) => l.vendor ?? "" },
      { header: "Description", value: (l) => l.description },
      { header: "Performed by", value: (l) => performerName(l) ?? "" },
      { header: "Labor (USD)", value: (l) => ((l.laborCostCents ?? 0) / 100).toFixed(2) },
      { header: "Parts (USD)", value: (l) => ((l.partsCostCents ?? 0) / 100).toFixed(2) },
      { header: "Total (USD)", value: (l) => ((l.costCents ?? 0) / 100).toFixed(2) },
      { header: "Mileage at service", value: (l) => l.mileageAtService ?? "" },
      { header: "Hours at service", value: (l) => l.hoursAtService ?? "" },
      { header: "Logged by", value: (l) => l.loggedByName ?? "" },
      { header: "Receipt attached", value: (l) => (l.hasReceipt ? "yes" : "no") },
      { header: "Notes", value: (l) => l.notes ?? "" },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`maintenance-logs-${stamp}.csv`, csv);
  }

  const filtersActive =
    search.trim() !== "" ||
    kindFilter !== "ALL" ||
    categoryFilter !== "ALL" ||
    receiptFilter !== "ALL";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fleet & Shop"
        title="Maintenance Log"
        icon={<Wrench className="h-5 w-5" />}
        description="Every wrench-turn, vendor receipt, and dollar spent — searchable and exportable for your accountant."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={filteredLogs.length === 0}
            >
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <MaintenanceFormDialog
              isOpen={isCreateOpen}
              setIsOpen={setIsCreateOpen}
              trigger={
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  New Log
                </Button>
              }
            />
          </>
        }
      />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <SummaryCard
          icon={Wrench}
          label="Logs"
          value={stats.count.toLocaleString()}
          sub={
            filtersActive
              ? `of ${allLogs.length.toLocaleString()} total`
              : "in current view"
          }
        />
        <SummaryCard
          icon={DollarSign}
          label="Total spend"
          value={usd(stats.totalCents)}
          sub={`${usd(stats.laborCents)} labor · ${usd(stats.partsCents)} parts`}
          tone="rose"
        />
        <SummaryCard
          icon={Receipt}
          label="Receipts"
          value={`${stats.withReceipt.toLocaleString()} / ${stats.count.toLocaleString()}`}
          sub={
            stats.count > 0
              ? `${Math.round((stats.withReceipt / stats.count) * 100)}% have a receipt attached`
              : "—"
          }
        />
        <SummaryCard
          icon={Filter}
          label="Top category"
          value={
            (() => {
              const entries = Object.entries(stats.byCategory);
              if (entries.length === 0) return "—";
              entries.sort((a, b) => b[1].cents - a[1].cents);
              return entries[0]![0] === "UNCATEGORIZED"
                ? "Uncategorized"
                : entries[0]![0];
            })()
          }
          sub={
            (() => {
              const entries = Object.entries(stats.byCategory);
              if (entries.length === 0) return "no spend yet";
              entries.sort((a, b) => b[1].cents - a[1].cents);
              return `${usd(entries[0]![1].cents)} this view`;
            })()
          }
          tone="amber"
        />
      </div>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search asset, vendor, description, notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Kind" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All kinds</SelectItem>
              <SelectItem value="SCHEDULED">Scheduled</SelectItem>
              <SelectItem value="REPAIR">Repair</SelectItem>
              <SelectItem value="INSPECTION">Inspection</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {RECEIPT_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
              <SelectItem value="NONE">Uncategorized</SelectItem>
            </SelectContent>
          </Select>
          <Select value={receiptFilter} onValueChange={setReceiptFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Receipt" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Any receipt</SelectItem>
              <SelectItem value="WITH">With receipt</SelectItem>
              <SelectItem value="WITHOUT">No receipt</SelectItem>
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setKindFilter("ALL");
                setCategoryFilter("ALL");
                setReceiptFilter("ALL");
              }}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filteredLogs.length > 0 ? (
        <div className="rounded-md border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/40 backdrop-blur">
                <TableRow>
                  <TableHead className="whitespace-nowrap">Asset</TableHead>
                  <TableHead className="whitespace-nowrap">Department</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="whitespace-nowrap">Performed At</TableHead>
                  <TableHead className="whitespace-nowrap">Performed By</TableHead>
                  <TableHead className="text-right">Labor</TableHead>
                  <TableHead className="text-right">Parts</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Receipt</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-muted/40">
                    <TableCell className="text-sm font-medium whitespace-nowrap">{assetName(log)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {(() => {
                        const label = logDepartmentLabel(log);
                        return label ? (
                          <Badge variant="outline" className="text-xs font-normal">
                            {label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">—</span>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          log.kind === "REPAIR"
                            ? "border-rose-300 bg-rose-50 text-rose-700"
                            : log.kind === "INSPECTION"
                              ? "border-blue-300 bg-blue-50 text-blue-700"
                              : "border-emerald-300 bg-emerald-50 text-emerald-700"
                        }
                      >
                        {log.kind}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {log.category ? (
                        <Badge variant="secondary" className="text-xs">
                          {log.category}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {log.vendor ?? <span className="text-xs text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate" title={log.description}>{log.description}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{new Date(log.performedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {performerName(log) ?? <span className="text-xs text-muted-foreground/40">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{usd(log.laborCostCents ?? 0)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{usd(log.partsCostCents ?? 0)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{usd(log.costCents)}</TableCell>
                    <TableCell>
                      {log.hasReceipt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 text-primary"
                          onClick={() => setPreviewLogId(log.id)}
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          View
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <MaintenanceFormDialog
                          log={log}
                          trigger={
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Edit className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DeleteMaintenance id={log.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground border rounded-md bg-card">
          {filtersActive
            ? "No logs match the current filters."
            : "No maintenance logs found."}
        </div>
      )}

      {previewLogId != null && (
        <ReceiptPreviewDialog
          logId={previewLogId}
          onClose={() => setPreviewLogId(null)}
        />
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
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
          {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-foreground/80 ring-1 ring-inset ring-accent/15">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiptPreviewDialog({
  logId,
  onClose,
}: {
  logId: number;
  onClose: () => void;
}) {
  const { data, isLoading } = useMaintenanceReceipt(logId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receipt</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center py-2">
          {isLoading ? (
            <Skeleton className="h-72 w-full" />
          ) : data?.receiptDataUrl ? (
            <img
              src={data.receiptDataUrl}
              alt="Receipt"
              className="max-h-[70vh] w-auto rounded-md border"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No receipt attached.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Cap upload at ~3MB so we never POST something the server will
// reject (server limit matches). Browsers handle this client-side
// via FileReader.readAsDataURL.
const RECEIPT_SIZE_LIMIT_BYTES = 3 * 1024 * 1024;

/**
 * Create / edit dialog for a maintenance log. Exported so the asset
 * detail page can edit a log from its Maintenance Ledger with the exact
 * same form. `onSaved` lets that caller refresh its own queries.
 */
export function MaintenanceFormDialog({ log, trigger, isOpen: controlledIsOpen, setIsOpen: controlledSetIsOpen, onSaved }: { log?: MaintenanceLogExt, trigger?: React.ReactNode, isOpen?: boolean, setIsOpen?: (v: boolean) => void, onSaved?: () => void }) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = controlledSetIsOpen || setInternalIsOpen;

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { activeDeptId } = useDepartmentFilter();
  const createMutation = useCreateMaintenanceLog();
  const updateMutation = useUpdateMaintenanceLog();
  // Receipt updates target a specific log id, so we build the hook
  // around the existing log's id (or 0 for create — we only fire it
  // after the create succeeds and we know the new id).
  const updateReceiptOnExisting = useUpdateMaintenanceReceipt(log?.id ?? 0);

  const deptParams = activeDeptId != null ? { departmentId: activeDeptId } : {};
  const { data: trucksData } = useListTrucks(deptParams);
  const { data: equipmentData } = useListEquipment(deptParams);
  const { data: deptsData } = useListDepartments();

  const [formData, setFormData] = useState({
    assetType: log?.truckId ? "truck" : (log?.equipmentId ? "equipment" : "truck"),
    truckId: log?.truckId?.toString() || "none",
    equipmentId: log?.equipmentId?.toString() || "none",
    kind: log?.kind || "SCHEDULED",
    description: log?.description || "",
    // Free text. Pre-filled from the typed name, else the legacy linked
    // user's name so older logs show who did the work when editing.
    performedBy: log ? (performerName(log) ?? "") : "",
    performedAt: log?.performedAt ? new Date(log.performedAt).toISOString().slice(0, 16) : "",
    laborDollars: log ? ((log.laborCostCents ?? 0) / 100).toString() : "0",
    partsDollars: log ? ((log.partsCostCents ?? 0) / 100).toString() : "0",
    usageAt: log
      ? (log.mileageAtService ?? log.hoursAtService ?? "").toString()
      : "",
    vendor: log?.vendor ?? "",
    category: (log?.category ?? "") as MaintenanceReceiptCategory | "",
    notes: log?.notes ?? "",
  });
  const [receiptDataUrl, setReceiptDataUrl] = useState<string | null>(null);
  const [hasExistingReceipt, setHasExistingReceipt] = useState<boolean>(
    log?.hasReceipt ?? false,
  );
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const labor = parseFloat(formData.laborDollars || "0") || 0;
  const parts = parseFloat(formData.partsDollars || "0") || 0;
  const total = labor + parts;

  function handleReceiptFile(file: File) {
    setReceiptError(null);
    if (!file.type.startsWith("image/")) {
      setReceiptError("Receipt must be an image file.");
      return;
    }
    if (file.size > RECEIPT_SIZE_LIMIT_BYTES) {
      setReceiptError("Receipt is too large (max 3 MB). Please compress and try again.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setReceiptDataUrl(result);
        setHasExistingReceipt(true);
      }
    };
    reader.onerror = () => setReceiptError("Failed to read the file.");
    reader.readAsDataURL(file);
  }

  async function persistReceiptExtras(targetLogId: number) {
    // Build the receipt-side payload: only send fields we actually
    // collected so we don't accidentally clear unrelated columns.
    const body: {
      vendor?: string | null;
      category?: MaintenanceReceiptCategory | null;
      notes?: string | null;
      receiptDataUrl?: string | null;
    } = {};
    if (formData.vendor !== (log?.vendor ?? "")) {
      body.vendor = formData.vendor.trim() || null;
    }
    if (formData.category !== (log?.category ?? "")) {
      body.category = (formData.category || null) as
        | MaintenanceReceiptCategory
        | null;
    }
    if (formData.notes !== (log?.notes ?? "")) {
      body.notes = formData.notes.trim() || null;
    }
    if (receiptDataUrl != null) {
      body.receiptDataUrl = receiptDataUrl;
    }
    if (Object.keys(body).length === 0) return;
    // The dialog reuses the same hook for both create + edit by
    // recreating the URL with the freshly-known log id.
    if (log) {
      await updateReceiptOnExisting.mutateAsync(body);
    } else {
      // Build an ad-hoc fetch since the orval hooks don't help here
      // and we don't want a second hook constructor for the create
      // path. customFetch already inherits credentials + base URL.
      await fetch(`/api/maintenance-logs/${targetLogId}/receipt`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const isTruck = formData.assetType === "truck";
    const usageNum = formData.usageAt ? parseInt(formData.usageAt, 10) : null;
    const payload = {
      truckId: isTruck && formData.truckId !== "none" ? parseInt(formData.truckId, 10) : null,
      equipmentId: !isTruck && formData.equipmentId !== "none" ? parseInt(formData.equipmentId, 10) : null,
      kind: formData.kind,
      description: formData.description,
      // performedByUserId is intentionally NOT sent: the server leaves
      // it untouched on PATCH, so older rows keep their user link.
      performedByName: formData.performedBy.trim() || null,
      performedAt: formData.performedAt ? new Date(formData.performedAt).toISOString() : null,
      laborCostCents: Math.round(labor * 100),
      partsCostCents: Math.round(parts * 100),
      mileageAtService: isTruck && usageNum != null && Number.isFinite(usageNum) ? usageNum : null,
      hoursAtService: !isTruck && usageNum != null && Number.isFinite(usageNum) ? usageNum : null,
    };

    if (log) {
      updateMutation.mutate(
        { id: log.id, data: payload },
        {
          onSuccess: async () => {
            try {
              await persistReceiptExtras(log.id);
            } catch {
              toast({ title: "Saved log, but receipt update failed", variant: "destructive" });
            }
            queryClient.invalidateQueries({ queryKey: getListMaintenanceLogsQueryKey() });
            queryClient.invalidateQueries({ queryKey: ["maintenance-receipt", log.id] });
            onSaved?.();
            toast({ title: "Log updated" });
            setIsOpen(false);
          },
          onError: () => toast({ title: "Error updating log", variant: "destructive" })
        }
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: async (created) => {
            const newId = (created as { log?: { id: number } } | undefined)?.log?.id;
            if (newId) {
              try {
                await persistReceiptExtras(newId);
              } catch {
                toast({ title: "Created log, but receipt save failed", variant: "destructive" });
              }
            }
            queryClient.invalidateQueries({ queryKey: getListMaintenanceLogsQueryKey() });
            onSaved?.();
            toast({ title: "Log created" });
            setIsOpen(false);
          },
          onError: () => toast({ title: "Error creating log", variant: "destructive" })
        }
      );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{log ? "Edit Log" : "New Maintenance Log"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
                <Label>Asset Type</Label>
                <Select value={formData.assetType} onValueChange={(val) => setFormData({ ...formData, assetType: val, truckId: "none", equipmentId: "none" })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="truck">Truck</SelectItem>
                    <SelectItem value="equipment">Equipment</SelectItem>
                  </SelectContent>
                </Select>
             </div>
             
             {formData.assetType === "truck" ? (
               <div className="space-y-2">
                 <Label>Truck</Label>
                 <Select value={formData.truckId} onValueChange={(val) => setFormData({ ...formData, truckId: val })}>
                   <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                   <SelectContent>
                     <SelectItem value="none">None</SelectItem>
                     {trucksData?.trucks?.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}
                   </SelectContent>
                 </Select>
               </div>
             ) : (
               <div className="space-y-2">
                 <Label>Equipment</Label>
                 <Select value={formData.equipmentId} onValueChange={(val) => setFormData({ ...formData, equipmentId: val })}>
                   <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                   <SelectContent>
                     <SelectItem value="none">None</SelectItem>
                     {equipmentData?.equipment?.map(e => <SelectItem key={e.id} value={e.id.toString()}>{e.name}</SelectItem>)}
                   </SelectContent>
                 </Select>
               </div>
             )}
          </div>

          {/* Department readout — derived from whichever asset is selected.
              Maintenance logs are pinned to their asset's department; this
              chip makes that visible so the user understands where the
              log will roll up in the accounting views. If no asset is
              picked yet (or the asset has no department), we leave the
              field clearly unassigned rather than guessing. */}
          {(() => {
            const id =
              formData.assetType === "truck"
                ? formData.truckId !== "none"
                  ? Number(formData.truckId)
                  : null
                : formData.equipmentId !== "none"
                  ? Number(formData.equipmentId)
                  : null;
            if (id == null) return null;
            const rows =
              formData.assetType === "truck"
                ? ((trucksData?.trucks ?? []) as unknown as WithDept[])
                : ((equipmentData?.equipment ?? []) as unknown as WithDept[]);
            const asset = rows.find((r) => r.id === id);
            const deptId = asset?.departmentId ?? null;
            const deptLabel =
              deptId != null
                ? (
                    deptsData?.departments ?? []
                  ).find(
                    (d: { id: number; label: string }) => d.id === deptId,
                  )?.label ?? null
                : null;
            return (
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      Department
                    </div>
                    <div className="mt-0.5 text-sm font-medium">
                      {deptLabel ?? (
                        <span className="text-muted-foreground">
                          Unassigned — set department on the asset to file this log there
                        </span>
                      )}
                    </div>
                  </div>
                  {deptLabel && (
                    <Badge variant="outline" className="text-[10px]">
                      from asset
                    </Badge>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="space-y-2">
            <Label htmlFor="kind">Kind</Label>
            <Select value={formData.kind} onValueChange={(val) => setFormData({ ...formData, kind: val })}>
              <SelectTrigger>
                <SelectValue placeholder="Select kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SCHEDULED">Scheduled</SelectItem>
                <SelectItem value="REPAIR">Repair</SelectItem>
                <SelectItem value="INSPECTION">Inspection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" required value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="laborDollars">Labor ($)</Label>
              <Input
                id="laborDollars"
                type="number"
                step="0.01"
                min="0"
                value={formData.laborDollars}
                onChange={(e) => setFormData({ ...formData, laborDollars: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="partsDollars">Parts ($)</Label>
              <Input
                id="partsDollars"
                type="number"
                step="0.01"
                min="0"
                value={formData.partsDollars}
                onChange={(e) => setFormData({ ...formData, partsDollars: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Total auto-summed</span>
            <span className="font-mono font-semibold">{usd(Math.round(total * 100))}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="performedBy">Performed By</Label>
              <Input
                id="performedBy"
                value={formData.performedBy}
                onChange={(e) => setFormData({ ...formData, performedBy: e.target.value })}
                placeholder="Type a name — mechanic, shop, or crew member"
                maxLength={120}
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="usageAt">
                {formData.assetType === "truck" ? "Mileage at service" : "Hours at service"}
              </Label>
              <Input
                id="usageAt"
                type="number"
                min="0"
                placeholder="optional"
                value={formData.usageAt}
                onChange={(e) => setFormData({ ...formData, usageAt: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="performedAt">Performed At</Label>
            <Input id="performedAt" type="datetime-local" value={formData.performedAt} onChange={(e) => setFormData({ ...formData, performedAt: e.target.value })} />
          </div>

          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Receipt &amp; Accounting
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendor">Vendor</Label>
                <Input
                  id="vendor"
                  value={formData.vendor}
                  onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                  placeholder="e.g. NAPA Auto Parts"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={formData.category || "none"}
                  onValueChange={(val) =>
                    setFormData({
                      ...formData,
                      category: val === "none" ? "" : (val as MaintenanceReceiptCategory),
                    })
                  }
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {RECEIPT_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="receipt">Receipt photo</Label>
              <input
                ref={fileInputRef}
                id="receipt"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleReceiptFile(file);
                  // Reset so re-uploading the same file fires onChange.
                  e.target.value = "";
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {hasExistingReceipt ? "Replace photo" : "Upload photo"}
                </Button>
                {hasExistingReceipt && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      setReceiptDataUrl(null);
                      setHasExistingReceipt(false);
                      // Tell the server to clear by sending receiptDataUrl: null on save.
                      // We achieve that by treating null as the new value.
                      setReceiptDataUrl(null);
                    }}
                  >
                    <X className="mr-1 h-3.5 w-3.5" /> Remove
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">
                  JPG / PNG up to 3 MB. Snap a photo of the vendor receipt; you'll
                  fill in vendor + category manually for accounting.
                </span>
              </div>
              {receiptDataUrl && (
                <img
                  src={receiptDataUrl}
                  alt="Receipt preview"
                  className="mt-1 max-h-40 w-auto rounded-md border"
                />
              )}
              {receiptError && (
                <p className="text-xs text-destructive">{receiptError}</p>
              )}
              {hasExistingReceipt && !receiptDataUrl && log?.hasReceipt && (
                <p className="text-xs text-muted-foreground">
                  A receipt is already attached to this log. Upload a new one to
                  replace it.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Accountant notes</Label>
              <Textarea
                id="notes"
                rows={2}
                placeholder="GL code, PO number, anything else accounting needs"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Delete control for a log. Exported for the asset detail page's ledger. */
export function DeleteMaintenance({ id, onDeleted }: { id: number; onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteMutation = useDeleteMaintenanceLog();

  const handleDelete = () => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListMaintenanceLogsQueryKey() });
          queryClient.invalidateQueries({ queryKey: DELETE_REQUESTS_PENDING_COUNT_KEY });
          onDeleted?.();
          toast(deleteOutcomeToast(result, "Log deleted"));
        },
        onError: () => toast({ title: "Error deleting log", variant: "destructive" })
      }
    );
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the log.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
