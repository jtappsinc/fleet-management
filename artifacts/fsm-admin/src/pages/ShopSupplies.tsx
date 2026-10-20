import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import {
  useListShopSupplies,
  useCreateShopSupply,
  useUpdateShopSupply,
  useDeleteShopSupply,
  SHOP_SUPPLIES_KEY,
  DELETE_REQUESTS_PENDING_COUNT_KEY,
  type ShopSupply,
  type ShopSupplyWriteBody,
} from "@/lib/extra-api";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import { deleteOutcomeToast } from "@/lib/delete-outcome";
import { rowsToCsv, downloadCsv } from "@/lib/csv";
import {
  Boxes,
  Plus,
  Search,
  Pencil,
  Trash2,
  Download,
  DollarSign,
  AlertTriangle,
  Minus,
  Package,
} from "lucide-react";

const usd = (cents: number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (cents ?? 0) / 100,
  );

// Suggested units. Free text is still allowed in the dialog — these are
// just the quick picks.
const UNIT_OPTIONS = ["each", "gal", "qt", "oz", "lb", "ft", "box", "case", "roll", "pack"];

function isLow(s: ShopSupply): boolean {
  return s.reorderLevel != null && s.quantityOnHand <= s.reorderLevel;
}

export function ShopSupplies() {
  const { data, isLoading } = useListShopSupplies();
  const { data: meData } = useGetMe();
  const canEdit = meData?.user?.permissions?.["fleet.maintenance"]?.canEdit ?? false;
  const supplies = data?.supplies ?? [];

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [stockFilter, setStockFilter] = useState<"ALL" | "LOW" | "OUT">("ALL");

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of supplies) if (s.category?.trim()) set.add(s.category.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [supplies]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return supplies.filter((s) => {
      if (categoryFilter !== "ALL") {
        if (categoryFilter === "NONE" && s.category) return false;
        if (categoryFilter !== "NONE" && s.category !== categoryFilter) return false;
      }
      if (stockFilter === "LOW" && !isLow(s)) return false;
      if (stockFilter === "OUT" && s.quantityOnHand > 0) return false;
      if (q) {
        const hay = [s.name, s.category ?? "", s.sku ?? "", s.vendor ?? "", s.notes ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [supplies, search, categoryFilter, stockFilter]);

  const stats = useMemo(() => {
    let valueCents = 0;
    let low = 0;
    let out = 0;
    for (const s of filtered) {
      valueCents += s.unitPriceCents * s.quantityOnHand;
      if (s.quantityOnHand <= 0) out += 1;
      else if (isLow(s)) low += 1;
    }
    return { count: filtered.length, valueCents, low, out };
  }, [filtered]);

  function handleExport() {
    const csv = rowsToCsv(filtered, [
      { header: "Name", value: (s) => s.name },
      { header: "Category", value: (s) => s.category ?? "" },
      { header: "SKU / Part #", value: (s) => s.sku ?? "" },
      { header: "Vendor", value: (s) => s.vendor ?? "" },
      { header: "Unit", value: (s) => s.unit },
      { header: "Qty on hand", value: (s) => s.quantityOnHand },
      { header: "Reorder level", value: (s) => s.reorderLevel ?? "" },
      { header: "Unit price (USD)", value: (s) => (s.unitPriceCents / 100).toFixed(2) },
      { header: "Stock value (USD)", value: (s) => ((s.unitPriceCents * s.quantityOnHand) / 100).toFixed(2) },
      { header: "Last purchased", value: (s) => (s.lastPurchasedAt ? s.lastPurchasedAt.slice(0, 10) : "") },
      { header: "Notes", value: (s) => s.notes ?? "" },
    ]);
    downloadCsv(`shop-supplies-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const filtersActive = search.trim() !== "" || categoryFilter !== "ALL" || stockFilter !== "ALL";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fleet & Shop"
        title="Shop Supplies"
        icon={<Boxes className="h-5 w-5" />}
        description="Everything the shop keeps on the shelf — oil, filters, blades, hardware — with what it costs and how much is left."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            {canEdit && (
              <SupplyFormDialog
                categories={categories}
                trigger={
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" /> Add Supply
                  </Button>
                }
              />
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Package} label="Items" value={stats.count.toLocaleString()} sub={filtersActive ? `of ${supplies.length.toLocaleString()} total` : "on the shelf"} />
        <StatCard icon={DollarSign} label="Stock value" value={usd(stats.valueCents)} sub="qty × unit price" />
        <StatCard icon={AlertTriangle} label="Low stock" value={stats.low.toLocaleString()} sub="at or below reorder level" tone={stats.low > 0 ? "amber" : "neutral"} />
        <StatCard icon={Minus} label="Out of stock" value={stats.out.toLocaleString()} sub="quantity is zero" tone={stats.out > 0 ? "rose" : "neutral"} />
      </div>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative w-full min-w-[220px] sm:flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, SKU, vendor, notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              aria-label="Search shop supplies"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              <SelectItem value="NONE">Uncategorized</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as typeof stockFilter)}>
            <SelectTrigger className="w-full sm:w-[160px]">
              <SelectValue placeholder="Stock" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All stock levels</SelectItem>
              <SelectItem value="LOW">Low stock</SelectItem>
              <SelectItem value="OUT">Out of stock</SelectItem>
            </SelectContent>
          </Select>
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setCategoryFilter("ALL"); setStockFilter("ALL"); }}>
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
      ) : filtered.length === 0 ? (
        <div className="rounded-md border bg-card py-12 text-center text-muted-foreground">
          {supplies.length === 0
            ? canEdit
              ? "No supplies yet. Click “Add Supply” to start tracking what's on the shelf."
              : "No supplies have been added yet."
            : "No supplies match the current filters."}
        </div>
      ) : (
        <div className="rounded-md border bg-card overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[28%]">Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right whitespace-nowrap">On hand</TableHead>
                <TableHead className="text-right whitespace-nowrap">Unit price</TableHead>
                <TableHead className="text-right whitespace-nowrap">Stock value</TableHead>
                <TableHead className="whitespace-nowrap">Last purchased</TableHead>
                {canEdit && <TableHead className="w-[150px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((s) => (
                <SupplyRow key={s.id} supply={s} canEdit={canEdit} categories={categories} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function StatCard({
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
  tone?: "neutral" | "amber" | "rose";
}) {
  const toneClass = tone === "amber" ? "text-amber-700" : tone === "rose" ? "text-rose-700" : "text-foreground";
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-center justify-between p-5">
        <div className="min-w-0">
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={`mt-2 text-2xl font-bold ${toneClass}`}>{value}</div>
          {sub && <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      </CardContent>
    </Card>
  );
}

function SupplyRow({
  supply: s,
  canEdit,
  categories,
}: {
  supply: ShopSupply;
  canEdit: boolean;
  categories: string[];
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const update = useUpdateShopSupply();
  const low = isLow(s);
  const out = s.quantityOnHand <= 0;

  // One-click ±1 so a mechanic can keep the count honest without
  // opening the dialog. Clamped at zero.
  function adjust(delta: number) {
    const next = Math.max(0, s.quantityOnHand + delta);
    if (next === s.quantityOnHand) return;
    update.mutate(
      { id: s.id, data: { quantityOnHand: next } },
      {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: SHOP_SUPPLIES_KEY }),
        onError: () => toast({ title: "Couldn't update quantity", variant: "destructive" }),
      },
    );
  }

  return (
    <TableRow className={out ? "bg-rose-50/40" : low ? "bg-amber-50/40" : undefined} data-testid={`supply-row-${s.id}`}>
      <TableCell>
        <div className="min-w-0">
          <div className="font-semibold">{s.name}</div>
          {s.sku && <div className="font-mono text-[11px] text-muted-foreground/80">SKU {s.sku}</div>}
          {s.notes && <div className="truncate text-xs text-muted-foreground" title={s.notes}>{s.notes}</div>}
        </div>
      </TableCell>
      <TableCell>
        {s.category ? (
          <Badge variant="secondary" className="text-xs font-normal">{s.category}</Badge>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm">{s.vendor ?? <span className="text-xs text-muted-foreground/40">—</span>}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1.5">
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Decrease quantity" onClick={() => adjust(-1)} disabled={update.isPending || s.quantityOnHand <= 0}>
              <Minus className="h-3 w-3" />
            </Button>
          )}
          <span className="font-mono text-sm font-semibold tabular-nums">
            {s.quantityOnHand.toLocaleString()} <span className="text-xs font-normal text-muted-foreground">{s.unit}</span>
          </span>
          {canEdit && (
            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Increase quantity" onClick={() => adjust(1)} disabled={update.isPending}>
              <Plus className="h-3 w-3" />
            </Button>
          )}
        </div>
        {out ? (
          <Badge className="mt-1 border-rose-200 bg-rose-100 text-[10px] text-rose-900 hover:bg-rose-100">Out of stock</Badge>
        ) : low ? (
          <Badge className="mt-1 border-amber-200 bg-amber-100 text-[10px] text-amber-900 hover:bg-amber-100">
            Low · reorder at {s.reorderLevel}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">{usd(s.unitPriceCents)}<span className="text-xs text-muted-foreground">/{s.unit}</span></TableCell>
      <TableCell className="text-right font-mono text-sm font-semibold">{usd(s.unitPriceCents * s.quantityOnHand)}</TableCell>
      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
        {s.lastPurchasedAt ? new Date(s.lastPurchasedAt).toLocaleDateString() : <span className="text-xs text-muted-foreground/40">—</span>}
      </TableCell>
      {canEdit && (
        <TableCell>
          <div className="flex items-center justify-end gap-1">
            <SupplyFormDialog
              supply={s}
              categories={categories}
              trigger={
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${s.name}`} data-testid={`supply-edit-${s.id}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
              }
            />
            <DeleteSupplyButton supply={s} />
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function SupplyFormDialog({
  supply,
  trigger,
  categories,
}: {
  supply?: ShopSupply;
  trigger: React.ReactNode;
  categories: string[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useCreateShopSupply();
  const update = useUpdateShopSupply();
  const isPending = create.isPending || update.isPending;

  const initial = () => ({
    name: supply?.name ?? "",
    category: supply?.category ?? "",
    sku: supply?.sku ?? "",
    vendor: supply?.vendor ?? "",
    unit: supply?.unit ?? "each",
    quantityOnHand: supply ? String(supply.quantityOnHand) : "0",
    reorderLevel: supply?.reorderLevel != null ? String(supply.reorderLevel) : "",
    unitPrice: supply ? (supply.unitPriceCents / 100).toFixed(2) : "",
    lastPurchasedAt: supply?.lastPurchasedAt ? supply.lastPurchasedAt.slice(0, 10) : "",
    notes: supply?.notes ?? "",
  });
  const [form, setForm] = useState(initial);
  const field = (k: keyof ReturnType<typeof initial>, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = form.name.trim();
    if (!name) { setError("Name is required."); return; }
    const qty = parseInt(form.quantityOnHand || "0", 10);
    if (!Number.isFinite(qty) || qty < 0) { setError("Quantity must be a whole number ≥ 0."); return; }
    const reorder = form.reorderLevel.trim() === "" ? null : parseInt(form.reorderLevel, 10);
    if (reorder !== null && (!Number.isFinite(reorder) || reorder < 0)) { setError("Reorder level must be a whole number ≥ 0."); return; }
    const price = form.unitPrice.trim() === "" ? 0 : parseFloat(form.unitPrice);
    if (!Number.isFinite(price) || price < 0) { setError("Unit price must be a positive amount."); return; }
    const unit = form.unit.trim() || "each";

    const body: ShopSupplyWriteBody = {
      name,
      category: form.category.trim() || null,
      sku: form.sku.trim() || null,
      vendor: form.vendor.trim() || null,
      unit,
      quantityOnHand: qty,
      reorderLevel: reorder,
      unitPriceCents: Math.round(price * 100),
      lastPurchasedAt: form.lastPurchasedAt ? new Date(`${form.lastPurchasedAt}T12:00:00`).toISOString() : null,
      notes: form.notes.trim() || null,
    };

    const done = (title: string) => {
      queryClient.invalidateQueries({ queryKey: SHOP_SUPPLIES_KEY });
      toast({ title });
      setOpen(false);
    };
    if (supply) {
      update.mutate(
        { id: supply.id, data: body },
        { onSuccess: () => done("Supply updated"), onError: () => setError("Couldn't save. Please try again.") },
      );
    } else {
      create.mutate(body, {
        onSuccess: () => done("Supply added"),
        onError: () => setError("Couldn't add the supply. Please try again."),
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) { setForm(initial()); setError(null); }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supply ? "Edit Supply" : "Add Shop Supply"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          )}
          <div>
            <Label htmlFor="sup-name">Name *</Label>
            <Input id="sup-name" value={form.name} onChange={(e) => field("name", e.target.value)} placeholder="15W-40 Diesel Oil" className="mt-1" autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="sup-category">Category</Label>
              <Input id="sup-category" value={form.category} onChange={(e) => field("category", e.target.value)} placeholder="Oil & Lubricants" className="mt-1" list="sup-category-options" />
              <datalist id="sup-category-options">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <Label htmlFor="sup-sku">SKU / Part #</Label>
              <Input id="sup-sku" value={form.sku} onChange={(e) => field("sku", e.target.value)} placeholder="NAPA 1515" className="mt-1 font-mono" />
            </div>
          </div>
          <div>
            <Label htmlFor="sup-vendor">Vendor</Label>
            <Input id="sup-vendor" value={form.vendor} onChange={(e) => field("vendor", e.target.value)} placeholder="NAPA Auto Parts" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor="sup-qty">On hand</Label>
              <Input id="sup-qty" type="number" min="0" step="1" value={form.quantityOnHand} onChange={(e) => field("quantityOnHand", e.target.value)} className="mt-1 font-mono" />
            </div>
            <div>
              <Label htmlFor="sup-unit">Unit</Label>
              <Input id="sup-unit" value={form.unit} onChange={(e) => field("unit", e.target.value)} placeholder="each" className="mt-1" list="sup-unit-options" />
              <datalist id="sup-unit-options">
                {UNIT_OPTIONS.map((u) => <option key={u} value={u} />)}
              </datalist>
            </div>
            <div>
              <Label htmlFor="sup-price">Unit price ($)</Label>
              <Input id="sup-price" type="number" min="0" step="0.01" value={form.unitPrice} onChange={(e) => field("unitPrice", e.target.value)} placeholder="0.00" className="mt-1 font-mono" />
            </div>
            <div>
              <Label htmlFor="sup-reorder">Reorder at</Label>
              <Input id="sup-reorder" type="number" min="0" step="1" value={form.reorderLevel} onChange={(e) => field("reorderLevel", e.target.value)} placeholder="optional" className="mt-1 font-mono" />
            </div>
          </div>
          <div>
            <Label htmlFor="sup-date">Last purchased</Label>
            <Input id="sup-date" type="date" value={form.lastPurchasedAt} onChange={(e) => field("lastPurchasedAt", e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="sup-notes">Notes</Label>
            <Textarea id="sup-notes" rows={2} value={form.notes} onChange={(e) => field("notes", e.target.value)} placeholder="Where it's stored, what it fits, anything the next person needs to know" className="mt-1" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : supply ? "Save changes" : "Add supply"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteSupplyButton({ supply }: { supply: ShopSupply }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const del = useDeleteShopSupply();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${supply.name}`} data-testid={`supply-delete-${supply.id}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this supply?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove <span className="font-semibold">{supply.name}</span> from the shop supplies list. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={del.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() =>
              del.mutate(supply.id, {
                onSuccess: (result) => {
                  queryClient.invalidateQueries({ queryKey: SHOP_SUPPLIES_KEY });
                  queryClient.invalidateQueries({ queryKey: DELETE_REQUESTS_PENDING_COUNT_KEY });
                  toast(deleteOutcomeToast(result, "Supply deleted"));
                },
                onError: () => toast({ title: "Couldn't delete supply", variant: "destructive" }),
              })
            }
          >
            {del.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
