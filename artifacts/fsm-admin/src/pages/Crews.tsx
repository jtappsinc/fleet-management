import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useListDepartments, useGetMe } from "@workspace/api-client-react";
import {
  useListCrews,
  useCrewDetail,
  useCreateCrew,
  useUpdateCrew,
  useDeleteCrew,
  useListCrewLeadCandidates,
  getCrewDetailKey,
  DELETE_REQUESTS_PENDING_COUNT_KEY,
  type Crew,
  type CrewMember,
  type CrewLeadCandidate,
  type CreateCrewBody,
} from "@/lib/extra-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Spinner } from "@/components/ui/spinner";
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
import { HardHat, Truck, Wrench, Users, ChevronRight, Plus, UserCog, Search, Building2, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  IN_SHOP: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  RETIRED: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function StatusBadge({ status }: { status: string }) {
  const label = status === "RETIRED" ? "Out of Service" : status.replace("_", " ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_COLORS[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

// Compact summary card used in the responsive crew grid. Keeps the page
// scannable: at typical zoom you can fit 12+ crews above the fold on
// desktop and 4–6 on a phone without horizontal scrolling.
function CrewCard({
  crew,
  selected,
  onSelect,
}: {
  crew: Crew;
  selected: boolean;
  onSelect: () => void;
}) {
  const memberCount = crew.memberCount ?? 0;
  const truckCount = crew.truckCount ?? 0;
  const equipCount = crew.equipmentCount ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full flex-col gap-2 rounded-lg border bg-card px-3 py-3 text-left transition-all",
        "hover:border-primary/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-primary bg-primary/5 shadow-sm" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <HardHat className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-semibold">{crew.name}</span>
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            "group-hover:translate-x-0.5 group-hover:text-primary",
          )}
        />
      </div>
      {(crew.leadName || crew.departmentLabel) && (
        <div className="space-y-0.5 text-xs">
          {crew.leadName && (
            <div className="truncate text-muted-foreground">
              <span className="font-medium text-foreground/80">Lead:</span> {crew.leadName}
            </div>
          )}
          {crew.departmentLabel && (
            <div className="truncate text-muted-foreground">
              <span className="font-medium text-foreground/80">Dept:</span> {crew.departmentLabel}
            </div>
          )}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          <Users className="h-3 w-3" />
          {memberCount}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          <Truck className="h-3 w-3" />
          {truckCount}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
          <Wrench className="h-3 w-3" />
          {equipCount}
        </span>
      </div>
    </button>
  );
}

function CrewDetailPanel({
  crewId,
  canEdit,
  onDeleted,
}: {
  crewId: number;
  canEdit: boolean;
  onDeleted?: () => void;
}) {
  const { data, isLoading, error } = useCrewDetail(crewId);
  const { data: deptsData } = useListDepartments();
  const depts = deptsData?.departments ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (error || !data?.crew) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Unable to load crew details.
      </div>
    );
  }

  const { crew } = data;
  const leadMember = crew.members.find((m) => m.userId === crew.leadUserId);
  const currentDept = depts.find(
    (d: { id: number; key: string; label: string }) => d.id === crew.departmentId,
  );

  return (
    <div className="space-y-5">
      <section className="rounded-md border bg-muted/20 px-3 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Crew Lead
            </div>
            <div className="mt-1 truncate text-sm font-semibold">
              {leadMember?.fullName ?? "Unassigned"}
            </div>
            {leadMember?.department && (
              <div className="truncate text-xs text-muted-foreground">
                {leadMember.department}
              </div>
            )}
          </div>
          {canEdit && (
            <ChangeCrewLeadDialog
              crewId={crew.id}
              currentLeadUserId={crew.leadUserId}
            />
          )}
        </div>
      </section>

      {/* Department section. Crews are filtered by the active department
          switcher elsewhere in the app, so making this editable here is
          how a foreman re-pegs a crew when a team moves between divisions
          (e.g., a tree crew picking up lawn work in winter). */}
      <section className="rounded-md border bg-muted/20 px-3 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Department
            </div>
            <div className="mt-1 truncate text-sm font-semibold">
              {currentDept?.label ?? (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </div>
          </div>
          {canEdit && (
            <ChangeCrewDepartmentDialog
              crewId={crew.id}
              currentDepartmentId={crew.departmentId}
            />
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Members ({crew.members.length})
        </div>
        {crew.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members assigned.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {crew.members.map((m: CrewMember) => (
              <div key={m.userId} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.department}</p>
                </div>
                <Badge variant="secondary" className="shrink-0 text-xs">
                  {m.role}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
          <Truck className="h-3.5 w-3.5" />
          Assigned Trucks ({crew.trucks.length})
        </div>
        {crew.trucks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trucks assigned.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {crew.trucks.map((t: { id: number; name: string; status: string; slug: string | null }) => (
              <div key={t.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <span className="min-w-0 truncate text-sm font-medium">{t.name}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={t.status} />
                  {t.slug && (
                    <Link
                      href={`/assets/${t.slug}`}
                      className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                    >
                      View <ChevronRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" />
          Assigned Equipment ({crew.equipment.length})
        </div>
        {crew.equipment.length === 0 ? (
          <p className="text-sm text-muted-foreground">No equipment assigned.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {crew.equipment.map((e: { id: number; name: string; type: string; status: string; slug: string | null }) => (
              <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{e.type}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge status={e.status} />
                  {e.slug && (
                    <Link
                      href={`/assets/${e.slug}`}
                      className="flex items-center gap-0.5 text-xs text-primary hover:underline"
                    >
                      View <ChevronRight className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {canEdit && (
        <section className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-mono uppercase tracking-widest text-destructive/80">
                Danger zone
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Deleting a crew unassigns its trucks, equipment and jobs — it
                doesn't delete them.
              </p>
            </div>
            <DeleteCrewButton crewId={crew.id} name={crew.name} onDeleted={onDeleted} />
          </div>
        </section>
      )}
    </div>
  );
}

function DeleteCrewButton({
  crewId,
  name,
  onDeleted,
}: {
  crewId: number;
  name: string;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteCrew = useDeleteCrew();

  function handleDelete() {
    deleteCrew.mutate(crewId, {
      onSuccess: (result) => {
        queryClient.invalidateQueries({ queryKey: ["crews"] });
        queryClient.invalidateQueries({ queryKey: getCrewDetailKey(crewId) });
        queryClient.invalidateQueries({ queryKey: DELETE_REQUESTS_PENDING_COUNT_KEY });
        // Assets referencing this crew now show "Unassigned".
        queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
        toast(deleteOutcomeToast(result, `${name} deleted`));
        onDeleted?.();
      },
      onError: () =>
        toast({
          title: "Error deleting crew",
          description: `Couldn't delete ${name}. Please try again.`,
          variant: "destructive",
        }),
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          data-testid={`crew-delete-${crewId}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete crew
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this crew?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove <span className="font-semibold">{name}</span>. Members,
            trucks, equipment and jobs attached to it will be unassigned, not
            deleted. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteCrew.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={deleteCrew.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleteCrew.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Re-assigns a crew to a different department (or clears it). Uses the
// existing PATCH /api/crews/:id endpoint which already accepts a
// nullable departmentId — no new server work needed.
function ChangeCrewDepartmentDialog({
  crewId,
  currentDepartmentId,
}: {
  crewId: number;
  currentDepartmentId: number | null;
}) {
  // "" = no selection yet, "NONE" = explicit clear, otherwise dept id as string.
  const initial =
    currentDepartmentId == null ? "NONE" : String(currentDepartmentId);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(initial);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const updateCrew = useUpdateCrew(crewId);
  const { data: deptsData } = useListDepartments();
  const depts = deptsData?.departments ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const next: number | null = value === "NONE" ? null : Number(value);
    if (next === currentDepartmentId) {
      setOpen(false);
      return;
    }
    try {
      await updateCrew.mutateAsync({ departmentId: next });
      queryClient.invalidateQueries({ queryKey: getCrewDetailKey(crewId) });
      queryClient.invalidateQueries({ queryKey: ["crews"] });
      setOpen(false);
    } catch {
      setError("Failed to change department. Please try again.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(initial);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          Change Department
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Department</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div>
            <Label htmlFor="change-crew-dept">Department</Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger id="change-crew-dept" className="mt-1">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">— Unassigned —</SelectItem>
                {depts.map((d: { id: number; key: string; label: string }) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateCrew.isPending}>
              {updateCrew.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeCrewLeadDialog({
  crewId,
  currentLeadUserId,
}: {
  crewId: number;
  currentLeadUserId: number;
}) {
  const [open, setOpen] = useState(false);
  const [leadUserId, setLeadUserId] = useState(String(currentLeadUserId));
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const updateCrew = useUpdateCrew(crewId);
  const { data: candidatesData } = useListCrewLeadCandidates();
  const candidates: CrewLeadCandidate[] = candidatesData?.users ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const newLeadId = Number(leadUserId);
    if (!newLeadId) {
      setError("Please select a crew lead.");
      return;
    }
    if (newLeadId === currentLeadUserId) {
      setOpen(false);
      return;
    }
    try {
      await updateCrew.mutateAsync({ leadUserId: newLeadId });
      queryClient.invalidateQueries({ queryKey: getCrewDetailKey(crewId) });
      queryClient.invalidateQueries({ queryKey: ["crews"] });
      setOpen(false);
    } catch {
      setError("Failed to update crew lead. Please try again.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setLeadUserId(String(currentLeadUserId));
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <UserCog className="h-3.5 w-3.5" />
          Change Lead
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Crew Lead</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div>
            <Label htmlFor="change-crew-lead">Crew Lead *</Label>
            <Select value={leadUserId} onValueChange={setLeadUserId}>
              <SelectTrigger id="change-crew-lead" className="mt-1">
                <SelectValue placeholder="Select a lead" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateCrew.isPending}>
              {updateCrew.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewCrewDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [leadUserId, setLeadUserId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createCrew = useCreateCrew();
  const { data: candidatesData } = useListCrewLeadCandidates();
  const { data: deptsData } = useListDepartments();
  const candidates: CrewLeadCandidate[] = candidatesData?.users ?? [];
  const depts = deptsData?.departments ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Crew name is required."); return; }
    const leadId = Number(leadUserId);
    if (!leadId) { setError("Please select a crew lead."); return; }
    const deptId = Number(departmentId) || undefined;
    try {
      const body: CreateCrewBody = { name: name.trim(), leadUserId: leadId, departmentId: deptId };
      await createCrew.mutateAsync(body);
      onCreated();
      setOpen(false);
      setName("");
      setLeadUserId("");
      setDepartmentId("");
    } catch {
      setError("Failed to create crew. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Crew
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Create New Crew</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div>
            <Label htmlFor="crew-name">Crew Name *</Label>
            <Input
              id="crew-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Crew Delta"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="crew-dept">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger id="crew-dept" className="mt-1">
                <SelectValue placeholder="Select department (optional)" />
              </SelectTrigger>
              <SelectContent>
                {depts.map((d: { id: number; key: string; label: string }) => (
                  <SelectItem key={d.id} value={String(d.id)}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="crew-lead">Crew Lead *</Label>
            <Select value={leadUserId} onValueChange={setLeadUserId}>
              <SelectTrigger id="crew-lead" className="mt-1">
                <SelectValue placeholder="Select a lead" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={createCrew.isPending}>
              {createCrew.isPending ? "Creating…" : "Create Crew"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Crews() {
  const { data, isLoading, error, refetch } = useListCrews();
  const queryClient = useQueryClient();
  const [selectedCrewId, setSelectedCrewId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const { data: meData } = useGetMe();
  const canCreateCrew =
    (meData?.user?.permissions?.["fleet.trucks"]?.canEdit ?? false) ||
    (meData?.user?.permissions?.["admin.users"]?.canEdit ?? false);
  const crews = (data?.crews ?? []) as Crew[];

  // Cheap client-side filter — useful when the team grows past a screenful
  // of crews. Matches name, lead, and department.
  const filteredCrews = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return crews;
    return crews.filter((c) => {
      return (
        c.name.toLowerCase().includes(q) ||
        (c.leadName ?? "").toLowerCase().includes(q) ||
        (c.departmentLabel ?? "").toLowerCase().includes(q)
      );
    });
  }, [crews, query]);

  const selectedCrew = crews.find((c) => c.id === selectedCrewId) ?? null;

  function handleCrewCreated() {
    queryClient.invalidateQueries({ queryKey: ["crews"] });
    refetch();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-24 text-destructive text-sm">
        Failed to load crews.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Fleet & Shop"
        title="Crews"
        icon={<HardHat className="h-5 w-5" />}
        description="Field crews with their assigned members, trucks, and equipment."
        actions={canCreateCrew ? <NewCrewDialog onCreated={handleCrewCreated} /> : undefined}
      />

      {crews.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No crews yet. Create your first crew with the button above.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Filter bar — visible whenever there are crews. On mobile the
              search input stretches full-width; the result count anchors
              to the right at sm+. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search crews, leads, departments…"
                className="pl-8"
                aria-label="Search crews"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              Showing {filteredCrews.length} of {crews.length}{" "}
              {crews.length === 1 ? "crew" : "crews"}
            </div>
          </div>

          {/* Responsive grid — 1 col on phones, 2 on small tablets,
              3 on laptops, 4 on full-width desktops. The xl breakpoint
              keeps cards from getting absurdly wide on big monitors. */}
          {filteredCrews.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No crews match “{query}”.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredCrews.map((crew) => (
                <CrewCard
                  key={crew.id}
                  crew={crew}
                  selected={selectedCrewId === crew.id}
                  onSelect={() => setSelectedCrewId(crew.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Detail dialog. We use a modal here (rather than an inline panel)
          so the crew grid stays visible context — close the dialog and
          you're right back where you were. Sized to comfortably hold the
          three rosters (members / trucks / equipment) on tablets+; on
          phones it stretches near-full-width with internal scroll. */}
      <Dialog
        open={selectedCrewId !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedCrewId(null);
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <HardHat className="h-5 w-5 text-primary" />
              {selectedCrew?.name ?? "Crew"}
            </DialogTitle>
          </DialogHeader>
          {selectedCrewId !== null && (
            <CrewDetailPanel
              crewId={selectedCrewId}
              canEdit={canCreateCrew}
              onDeleted={() => setSelectedCrewId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
