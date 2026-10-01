import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import {
  db,
  trucksTable,
  equipmentTable,
  equipmentItemsTable,
  maintenanceLogsTable,
  usageReadingsTable,
  assetStatusLogTable,
  assetAssignmentLogTable,
  assetCheckoutsTable,
  crewsTable,
  crewMembersTable,
  usersTable,
  departmentsTable,
  rolesTable,
  type MaintenanceLog,
} from "@workspace/db";
import { isNull } from "drizzle-orm";
import {
  CreateTruckBody,
  UpdateTruckBody,
  UpdateTruckParams,
  DeleteTruckParams,
  CreateEquipmentBody,
  UpdateEquipmentBody,
  UpdateEquipmentParams,
  DeleteEquipmentParams,
  CreateMaintenanceLogBody,
  UpdateMaintenanceLogBody,
  UpdateMaintenanceLogParams,
  DeleteMaintenanceLogParams,
  GetAssetBySlugParams,
  CreateUsageReadingBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSection, hasSectionAccess } from "../middlewares/requireSection";
import { requestDelete, sendDeleteOutcome } from "../lib/deleteGuard";
import { recomputeAssetUsage } from "../lib/assetUsage";

const router: IRouter = Router();

type FleetStatus = "ACTIVE" | "IN_SHOP" | "RETIRED";
type MaintenanceKind = "SCHEDULED" | "REPAIR" | "INSPECTION";

// Extension schemas for fields not yet in the OpenAPI spec. These let
// the route handlers accept the new category / quantity / vehicleType
// payloads without regenerating the orval client. The UI sends them as
// regular body fields and we layer them on top of the generated parse.
const truckExtensionSchema = z
  .object({
    vehicleType: z.enum(["TRUCK", "TRAILER"]).optional(),
    // Insurance-schedule / spec columns. All nullable so the edit form can
    // clear a value by sending null; omitted keys are left untouched.
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    statedValueCents: z.number().int().min(0).nullable().optional(),
    gvwGcwLbs: z.number().int().min(0).nullable().optional(),
    garagingState: z.string().trim().max(2).nullable().optional(),
    operatingRadiusMiles: z.number().int().min(0).nullable().optional(),
    insuranceVehNumber: z.number().int().min(0).nullable().optional(),
    bodyTypeCode: z.string().trim().max(20).nullable().optional(),
  })
  .passthrough();

// Column names shared by the POST + PATCH truck handlers for the
// extension fields above (everything except vehicleType, which has its
// own default logic on create).
const TRUCK_EXT_FIELDS = [
  "year",
  "statedValueCents",
  "gvwGcwLbs",
  "garagingState",
  "operatingRadiusMiles",
  "insuranceVehNumber",
  "bodyTypeCode",
] as const;

function pickTruckExtFields(
  ext: z.infer<typeof truckExtensionSchema>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of TRUCK_EXT_FIELDS) {
    if (ext[key] !== undefined) {
      // Empty strings become null so "clear this field" from a text
      // input doesn't persist "" into the row.
      const v = ext[key];
      out[key] = typeof v === "string" && v.length === 0 ? null : v;
    }
  }
  return out;
}

const equipmentExtensionSchema = z
  .object({
    category: z.enum(["HANDHELD", "CUSTOM"]).optional(),
    quantity: z.number().int().min(1).optional(),
    customCategoryLabel: z.string().min(1).max(60).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
  })
  .passthrough();

// Helper — slugify a name into a stable URL fragment.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

function makeAssetSlug(kind: "truck" | "equip", id: number, name: string) {
  const base = slugify(name) || kind;
  return `${kind}-${id}-${base}`;
}

// ---------- Trucks ----------
router.get(
  "/trucks",
  requireAuth,
  requireSection("fleet.trucks", "view"),
  async (req, res) => {
    const deptId = resolveDeptId(req);
    const rows = deptId != null
      ? await db.select().from(trucksTable).where(eq(trucksTable.departmentId, deptId)).limit(500)
      : await db.select().from(trucksTable).limit(500);
    res.json({ trucks: rows });
  },
);

router.post(
  "/trucks",
  requireAuth,
  requireSection("fleet.trucks", "edit"),
  async (req, res) => {
    const parsed = CreateTruckBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const d = parsed.data;
    // Non-admins can only create assets within their own department.
    // Admins may create with no department — the asset shows up under
    // "Unassigned" until someone uses Bulk Assign or the asset detail
    // page to set one.
    let effectiveDeptId: number | null = d.departmentId ?? null;
    if (req.user!.role !== "ADMIN") {
      const userDept = req.user!.departmentId ?? null;
      if (effectiveDeptId != null && effectiveDeptId !== userDept) {
        res.status(403).json({ error: "forbidden", detail: "cannot assign asset to another department" });
        return;
      }
      effectiveDeptId = userDept;
      if (effectiveDeptId == null) {
        res.status(400).json({ error: "department_required", detail: "non-admin users must belong to a department to create assets" });
        return;
      }
    }
    const truckExt = truckExtensionSchema.safeParse(req.body);
    const vehicleType =
      truckExt.success && truckExt.data.vehicleType ? truckExt.data.vehicleType : "TRUCK";
    const truckExtValues = truckExt.success ? pickTruckExtFields(truckExt.data) : {};
    const [row] = await db
      .insert(trucksTable)
      .values({
        ...(truckExtValues as Partial<typeof trucksTable.$inferInsert>),
        name: d.name,
        vehicleType,
        brand: d.brand ?? null,
        model: d.model ?? null,
        vin: d.vin ?? null,
        plate: d.plate ?? null,
        status: d.status as FleetStatus,
        assignedCrewId: d.assignedCrewId ?? null,
        departmentId: effectiveDeptId,
        purchasePriceCents: d.purchasePriceCents ?? null,
        purchaseDate: d.purchaseDate ? new Date(d.purchaseDate) : null,
        ...(d.currentMileage != null ? { currentMileage: d.currentMileage } : {}),
        ...(d.serviceIntervalMiles != null
          ? { serviceIntervalMiles: d.serviceIntervalMiles }
          : {}),
      })
      .returning();
    if (row) {
      const slug = makeAssetSlug("truck", row.id, row.name);
      const [updated] = await db
        .update(trucksTable)
        .set({ slug })
        .where(eq(trucksTable.id, row.id))
        .returning();
      res.status(201).json({ truck: updated ?? row });
      return;
    }
    res.status(500).json({ error: "insert_failed" });
  },
);

router.patch(
  "/trucks/:id",
  requireAuth,
  requireSection("fleet.trucks", "edit"),
  async (req, res) => {
    const params = UpdateTruckParams.safeParse({ id: Number(req.params.id) });
    const body = UpdateTruckBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const d = body.data;
    // Non-admins may not reassign a vehicle to a different department.
    if (d.departmentId !== undefined && req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "forbidden", detail: "only admins may change department assignment" });
      return;
    }
    // Verify non-admin callers can only mutate assets in their own department.
    if (!(await assertAssetInScope(req, res, { truckId: params.data.id }))) return;
    // PATCH semantics: only update fields explicitly present in the body so
    // partial updates do not unintentionally clear existing values.
    const patch: Record<string, unknown> = {};
    if (d.name !== undefined) patch.name = d.name;
    if (d.brand !== undefined) patch.brand = d.brand ?? null;
    if (d.model !== undefined) patch.model = d.model ?? null;
    if (d.vin !== undefined) patch.vin = d.vin ?? null;
    if (d.plate !== undefined) patch.plate = d.plate ?? null;
    if (d.status !== undefined) patch.status = d.status as FleetStatus;
    if (d.assignedCrewId !== undefined)
      patch.assignedCrewId = d.assignedCrewId ?? null;
    if (d.departmentId !== undefined) {
      // Admins may now clear departmentId (set to null) so an asset
      // can land back in the "Unassigned" bucket — the team uses this
      // when reorganizing crews. Re-assignment still requires admin.
      patch.departmentId = d.departmentId ?? null;
    }
    if (d.purchasePriceCents !== undefined)
      patch.purchasePriceCents = d.purchasePriceCents ?? null;
    if (d.purchaseDate !== undefined)
      patch.purchaseDate = d.purchaseDate ? new Date(d.purchaseDate) : null;
    if (d.currentMileage != null) patch.currentMileage = d.currentMileage;
    if (d.serviceIntervalMiles != null)
      patch.serviceIntervalMiles = d.serviceIntervalMiles;

    const truckExt = truckExtensionSchema.safeParse(req.body);
    if (truckExt.success) {
      if (truckExt.data.vehicleType !== undefined) {
        patch.vehicleType = truckExt.data.vehicleType;
      }
      Object.assign(patch, pickTruckExtFields(truckExt.data));
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no_fields_to_update" });
      return;
    }

    const [row] = await db
      .update(trucksTable)
      .set(patch)
      .where(eq(trucksTable.id, params.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ truck: row });
  },
);

router.delete(
  "/trucks/:id",
  requireAuth,
  requireSection("fleet.trucks", "edit"),
  async (req, res) => {
    const params = DeleteTruckParams.safeParse({ id: Number(req.params.id) });
    if (!params.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!(await assertAssetInScope(req, res, { truckId: params.data.id }))) return;

    const [existing] = await db
      .select({ name: trucksTable.name })
      .from(trucksTable)
      .where(eq(trucksTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const outcome = await requestDelete({
      req,
      kind: "truck",
      id: params.data.id,
      label: `Truck: ${existing.name}`,
      execute: async () => {
        const deleted = await db
          .delete(trucksTable)
          .where(eq(trucksTable.id, params.data.id))
          .returning({ id: trucksTable.id });
        return deleted.length > 0;
      },
    });
    sendDeleteOutcome(res, outcome);
  },
);

// ---------- Equipment ----------
router.get(
  "/equipment",
  requireAuth,
  requireSection("fleet.equipment", "view"),
  async (req, res) => {
    const deptId = resolveDeptId(req);
    const rows = deptId != null
      ? await db.select().from(equipmentTable).where(eq(equipmentTable.departmentId, deptId)).limit(500)
      : await db.select().from(equipmentTable).limit(500);
    res.json({ equipment: rows });
  },
);

router.post(
  "/equipment",
  requireAuth,
  requireSection("fleet.equipment", "edit"),
  async (req, res) => {
    const parsed = CreateEquipmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const d = parsed.data;
    // Non-admins can only create assets within their own department.
    // Admins may create with no department (asset lands in "Unassigned").
    let effectiveDeptId: number | null = d.departmentId ?? null;
    if (req.user!.role !== "ADMIN") {
      const userDept = req.user!.departmentId ?? null;
      if (effectiveDeptId != null && effectiveDeptId !== userDept) {
        res.status(403).json({ error: "forbidden", detail: "cannot assign asset to another department" });
        return;
      }
      effectiveDeptId = userDept;
      if (effectiveDeptId == null) {
        res.status(400).json({ error: "department_required", detail: "non-admin users must belong to a department to create assets" });
        return;
      }
    }
    const equipExt = equipmentExtensionSchema.safeParse(req.body);
    const category =
      equipExt.success && equipExt.data.category ? equipExt.data.category : "HANDHELD";
    const quantity =
      equipExt.success && equipExt.data.quantity != null ? equipExt.data.quantity : 1;
    // CUSTOM rows must carry a free-form label; HANDHELD rows must not.
    let customCategoryLabel: string | null = null;
    if (category === "CUSTOM") {
      const label = equipExt.success ? equipExt.data.customCategoryLabel ?? null : null;
      if (!label) {
        res
          .status(400)
          .json({ error: "custom_category_label_required", detail: "CUSTOM items require a category label" });
        return;
      }
      customCategoryLabel = label;
    }
    const [row] = await db
      .insert(equipmentTable)
      .values({
        name: d.name,
        type: d.type,
        category,
        quantity,
        customCategoryLabel,
        brand: d.brand ?? null,
        model: d.model ?? null,
        serial: d.serial ?? null,
        status: d.status as FleetStatus,
        assignedTruckId: d.assignedTruckId ?? null,
        departmentId: effectiveDeptId,
        purchasePriceCents: d.purchasePriceCents ?? null,
        purchaseDate: d.purchaseDate ? new Date(d.purchaseDate) : null,
        ...(d.currentHours != null ? { currentHours: d.currentHours } : {}),
        ...(d.serviceIntervalHours != null
          ? { serviceIntervalHours: d.serviceIntervalHours }
          : {}),
      })
      .returning();
    if (row) {
      const slug = makeAssetSlug("equip", row.id, row.name);
      const [updated] = await db
        .update(equipmentTable)
        .set({ slug })
        .where(eq(equipmentTable.id, row.id))
        .returning();
      res.status(201).json({ equipment: updated ?? row });
      return;
    }
    res.status(500).json({ error: "insert_failed" });
  },
);

router.patch(
  "/equipment/:id",
  requireAuth,
  requireSection("fleet.equipment", "edit"),
  async (req, res) => {
    const params = UpdateEquipmentParams.safeParse({ id: Number(req.params.id) });
    const body = UpdateEquipmentBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const d = body.data;
    // Non-admins may not reassign equipment to a different department.
    if (d.departmentId !== undefined && req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "forbidden", detail: "only admins may change department assignment" });
      return;
    }
    // Verify non-admin callers can only mutate assets in their own department.
    if (!(await assertAssetInScope(req, res, { equipmentId: params.data.id }))) return;
    // PATCH semantics: only update fields explicitly present in the body.
    const patch: Record<string, unknown> = {};
    if (d.name !== undefined) patch.name = d.name;
    if (d.type !== undefined) patch.type = d.type;
    if (d.brand !== undefined) patch.brand = d.brand ?? null;
    if (d.model !== undefined) patch.model = d.model ?? null;
    if (d.serial !== undefined) patch.serial = d.serial ?? null;
    if (d.status !== undefined) patch.status = d.status as FleetStatus;
    if (d.assignedTruckId !== undefined)
      patch.assignedTruckId = d.assignedTruckId ?? null;
    if (d.departmentId !== undefined) {
      // Admins may now clear departmentId (set to null) so an asset
      // can land back in the "Unassigned" bucket — the team uses this
      // when reorganizing crews. Re-assignment still requires admin.
      patch.departmentId = d.departmentId ?? null;
    }
    if (d.purchasePriceCents !== undefined)
      patch.purchasePriceCents = d.purchasePriceCents ?? null;
    if (d.purchaseDate !== undefined)
      patch.purchaseDate = d.purchaseDate ? new Date(d.purchaseDate) : null;
    if (d.currentHours != null) patch.currentHours = d.currentHours;
    if (d.serviceIntervalHours != null)
      patch.serviceIntervalHours = d.serviceIntervalHours;

    const equipExt = equipmentExtensionSchema.safeParse(req.body);
    if (equipExt.success) {
      if (equipExt.data.category !== undefined) patch.category = equipExt.data.category;
      if (equipExt.data.quantity !== undefined) patch.quantity = equipExt.data.quantity;
      if (equipExt.data.customCategoryLabel !== undefined) {
        patch.customCategoryLabel = equipExt.data.customCategoryLabel;
      }
      if (equipExt.data.location !== undefined) {
        patch.location = equipExt.data.location ?? null;
      }
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no_fields_to_update" });
      return;
    }
    // A CUSTOM row must always carry a category label. Validate against
    // the merged (existing + patch) state so switching category and
    // clearing the label in one request can't leave the row inconsistent.
    if (patch.category !== undefined || patch.customCategoryLabel !== undefined) {
      const [current] = await db
        .select({
          category: equipmentTable.category,
          customCategoryLabel: equipmentTable.customCategoryLabel,
        })
        .from(equipmentTable)
        .where(eq(equipmentTable.id, params.data.id));
      if (!current) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const nextCategory = (patch.category as string | undefined) ?? current.category;
      const nextLabel =
        patch.customCategoryLabel !== undefined
          ? (patch.customCategoryLabel as string | null)
          : current.customCategoryLabel;
      if (nextCategory === "CUSTOM" && !nextLabel) {
        res
          .status(400)
          .json({ error: "custom_category_label_required", detail: "CUSTOM items require a category label" });
        return;
      }
      if (nextCategory === "HANDHELD") patch.customCategoryLabel = null;
    }

    const [row] = await db
      .update(equipmentTable)
      .set(patch)
      .where(eq(equipmentTable.id, params.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ equipment: row });
  },
);

router.delete(
  "/equipment/:id",
  requireAuth,
  requireSection("fleet.equipment", "edit"),
  async (req, res) => {
    const params = DeleteEquipmentParams.safeParse({ id: Number(req.params.id) });
    if (!params.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!(await assertAssetInScope(req, res, { equipmentId: params.data.id }))) return;

    const [existing] = await db
      .select({ name: equipmentTable.name })
      .from(equipmentTable)
      .where(eq(equipmentTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const outcome = await requestDelete({
      req,
      kind: "equipment",
      id: params.data.id,
      label: `Equipment: ${existing.name}`,
      execute: async () => {
        const deleted = await db
          .delete(equipmentTable)
          .where(eq(equipmentTable.id, params.data.id))
          .returning({ id: equipmentTable.id });
        return deleted.length > 0;
      },
    });
    sendDeleteOutcome(res, outcome);
  },
);

// ---------- Equipment Items ----------
// Consumables / accessories attached to a piece of equipment.
// Anyone with fleet.equipment view can read; edit required to mutate.

const equipmentItemBodySchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(1).optional().default(1),
  unit: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

router.get(
  "/equipment/:id/items",
  requireAuth,
  requireSection("fleet.equipment", "view"),
  async (req, res) => {
    const equipId = Number(req.params.id);
    if (!Number.isFinite(equipId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const items = await db
      .select()
      .from(equipmentItemsTable)
      .where(eq(equipmentItemsTable.equipmentId, equipId))
      .orderBy(equipmentItemsTable.createdAt);
    res.json({ items });
  },
);

router.post(
  "/equipment/:id/items",
  requireAuth,
  requireSection("fleet.equipment", "edit"),
  async (req, res) => {
    const equipId = Number(req.params.id);
    if (!Number.isFinite(equipId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = equipmentItemBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }
    const [item] = await db
      .insert(equipmentItemsTable)
      .values({ equipmentId: equipId, ...parsed.data })
      .returning();
    res.status(201).json({ item });
  },
);

router.delete(
  "/equipment/:equipId/items/:itemId",
  requireAuth,
  requireSection("fleet.equipment", "edit"),
  async (req, res) => {
    const equipId = Number(req.params.equipId);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(equipId) || !Number.isFinite(itemId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }

    const [existing] = await db
      .select({ name: equipmentItemsTable.name })
      .from(equipmentItemsTable)
      .where(
        and(
          eq(equipmentItemsTable.id, itemId),
          eq(equipmentItemsTable.equipmentId, equipId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const outcome = await requestDelete({
      req,
      kind: "equipment_item",
      id: itemId,
      label: `Equipment item: ${existing.name}`,
      execute: async () => {
        const deleted = await db
          .delete(equipmentItemsTable)
          .where(
            and(
              eq(equipmentItemsTable.id, itemId),
              eq(equipmentItemsTable.equipmentId, equipId),
            ),
          )
          .returning({ id: equipmentItemsTable.id });
        return deleted.length > 0;
      },
    });
    sendDeleteOutcome(res, outcome);
  },
);

// PATCH /equipment/:equipId/items/:itemId — edit a consumable row in
// place. Same partial-update semantics as the asset PATCH handlers: only
// keys present in the body are written, so the UI can rename without
// resending quantity and vice-versa.
const updateEquipmentItemSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    quantity: z.number().int().min(0).optional(),
    unit: z.string().trim().max(40).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

router.patch(
  "/equipment/:equipId/items/:itemId",
  requireAuth,
  requireSection("fleet.equipment", "edit"),
  async (req, res) => {
    const equipId = Number(req.params.equipId);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(equipId) || !Number.isFinite(itemId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = updateEquipmentItemSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await assertAssetInScope(req, res, { equipmentId: equipId }))) return;
    const patch: Partial<typeof equipmentItemsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.quantity !== undefined) patch.quantity = parsed.data.quantity;
    if (parsed.data.unit !== undefined) patch.unit = parsed.data.unit || null;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes || null;
    const [item] = await db
      .update(equipmentItemsTable)
      .set(patch)
      .where(
        and(
          eq(equipmentItemsTable.id, itemId),
          eq(equipmentItemsTable.equipmentId, equipId),
        ),
      )
      .returning();
    if (!item) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ item });
  },
);

// ---------- Maintenance Logs ----------
// `mode = "create"` defaults missing labor/parts to 0 (so costCents is always
// labor+parts on insert). `mode = "patch"` only touches labor/parts when the
// caller actually provided them, so partial updates don't zero out costs.
function buildLogValues<
  T extends {
    kind?: string;
    performedAt?: string | Date | null;
    laborCostCents?: number | null;
    partsCostCents?: number | null;
  },
>(input: T, mode: "create" | "patch" = "create") {
  const { kind, performedAt, laborCostCents, partsCostCents, ...rest } = input;
  void kind;
  void performedAt;
  void laborCostCents;
  void partsCostCents;

  const out: Record<string, unknown> = { ...rest };
  if (input.kind !== undefined) {
    out.kind = input.kind as MaintenanceKind;
  }
  if (input.performedAt !== undefined && input.performedAt !== null) {
    out.performedAt =
      typeof input.performedAt === "string"
        ? new Date(input.performedAt)
        : input.performedAt;
  }

  const laborProvided = input.laborCostCents !== undefined;
  const partsProvided = input.partsCostCents !== undefined;
  if (mode === "create") {
    const labor = input.laborCostCents ?? 0;
    const parts = input.partsCostCents ?? 0;
    out.laborCostCents = labor;
    out.partsCostCents = parts;
    out.costCents = labor + parts;
  } else if (laborProvided || partsProvided) {
    // For PATCH we only recompute costCents if labor or parts is actually
    // being changed. Use the provided value, falling back to 0 only for the
    // side that isn't being touched (the SQL UPDATE will leave it as-is).
    if (laborProvided) out.laborCostCents = input.laborCostCents ?? 0;
    if (partsProvided) out.partsCostCents = input.partsCostCents ?? 0;
    // costCents recomputation requires both sides; defer to caller when
    // partial — see PATCH handler below which loads the existing row.
  }
  return out;
}

router.get(
  "/maintenance-logs",
  requireAuth,
  requireSection("fleet.maintenance", "view"),
  async (req, res) => {
    const deptId = resolveDeptId(req);
    let rows: MaintenanceLog[];
    if (deptId != null) {
      // Filter in SQL so the LIMIT applies only to matching dept rows.
      rows = await db
        .select({ log: maintenanceLogsTable })
        .from(maintenanceLogsTable)
        .leftJoin(trucksTable, eq(maintenanceLogsTable.truckId, trucksTable.id))
        .leftJoin(equipmentTable, eq(maintenanceLogsTable.equipmentId, equipmentTable.id))
        .where(
          sql`(${trucksTable.departmentId} = ${deptId} OR ${equipmentTable.departmentId} = ${deptId})`,
        )
        .orderBy(desc(maintenanceLogsTable.performedAt))
        .limit(500)
        .then((r) => r.map((x) => x.log));
    } else {
      rows = await db
        .select()
        .from(maintenanceLogsTable)
        .orderBy(desc(maintenanceLogsTable.performedAt))
        .limit(500);
    }
    const loggedByIds = [...new Set(rows.map((r) => r.loggedByUserId).filter((id): id is number => id != null))];
    let userMap: Record<number, string> = {};
    if (loggedByIds.length > 0) {
      const users = await db
        .select({ id: usersTable.id, fullName: usersTable.fullName })
        .from(usersTable)
        .where(sql`${usersTable.id} = ANY(ARRAY[${sql.raw(loggedByIds.join(","))}]::int[])`);
      userMap = Object.fromEntries(users.map((u) => [u.id, u.fullName]));
    }
    // Include vendor / category / notes / hasReceipt so the table and CSV
    // export can show them. The full receipt data URL is excluded to keep
    // the list payload small — the dedicated GET /receipt endpoint
    // returns it on demand for the receipt preview modal.
    res.json({
      logs: rows.map((r) => {
        const { receiptDataUrl, ...rest } = r as MaintenanceLog & {
          receiptDataUrl: string | null;
        };
        return {
          ...rest,
          loggedByName:
            r.loggedByUserId != null
              ? (userMap[r.loggedByUserId] ?? null)
              : null,
          hasReceipt: receiptDataUrl != null && receiptDataUrl.length > 0,
        };
      }),
    });
  },
);

router.post(
  "/maintenance-logs",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const parsed = CreateMaintenanceLogBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    // Refinement: maintenance entries must target exactly one asset.
    const hasTruck = parsed.data.truckId != null;
    const hasEquip = parsed.data.equipmentId != null;
    if (hasTruck === hasEquip) {
      res
        .status(400)
        .json({ error: "must_target_exactly_one_asset" });
      return;
    }
    // Verify non-admin callers can only log against assets in their own dept.
    if (!(await assertAssetInScope(req, res, {
      truckId: parsed.data.truckId,
      equipmentId: parsed.data.equipmentId,
    }))) return;
    const [row] = await db
      .insert(maintenanceLogsTable)
      // buildLogValues("create") always sets description/labor/parts/cost.
      .values({
        ...(buildLogValues(parsed.data, "create") as typeof maintenanceLogsTable.$inferInsert),
        loggedByUserId: req.user?.id ?? null,
      })
      .returning();

    // If the log includes a usage snapshot, advance the asset's odometer too.
    if (row) {
      if (row.truckId && row.mileageAtService != null) {
        await db
          .update(trucksTable)
          .set({ currentMileage: row.mileageAtService })
          .where(
            and(
              eq(trucksTable.id, row.truckId),
              sql`${trucksTable.currentMileage} < ${row.mileageAtService}`,
            ),
          );
      }
      if (row.equipmentId && row.hoursAtService != null) {
        await db
          .update(equipmentTable)
          .set({ currentHours: row.hoursAtService })
          .where(
            and(
              eq(equipmentTable.id, row.equipmentId),
              sql`${equipmentTable.currentHours} < ${row.hoursAtService}`,
            ),
          );
      }
    }

    res.status(201).json({ log: row });
  },
);

router.patch(
  "/maintenance-logs/:id",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const params = UpdateMaintenanceLogParams.safeParse({
      id: Number(req.params.id),
    });
    const body = UpdateMaintenanceLogBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!(await assertMaintenanceLogInScope(req, res, params.data.id))) return;
    const values = buildLogValues(body.data, "patch") as Record<
      string,
      unknown
    >;
    // If labor or parts is being touched, recompute costCents from the
    // resulting row's values (existing + provided).
    const laborTouched = "laborCostCents" in values;
    const partsTouched = "partsCostCents" in values;
    if (laborTouched || partsTouched) {
      const [existing] = await db
        .select({
          laborCostCents: maintenanceLogsTable.laborCostCents,
          partsCostCents: maintenanceLogsTable.partsCostCents,
        })
        .from(maintenanceLogsTable)
        .where(eq(maintenanceLogsTable.id, params.data.id));
      if (!existing) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const labor = laborTouched
        ? (values.laborCostCents as number)
        : (existing.laborCostCents ?? 0);
      const parts = partsTouched
        ? (values.partsCostCents as number)
        : (existing.partsCostCents ?? 0);
      values.costCents = labor + parts;
    }
    const [row] = await db
      .update(maintenanceLogsTable)
      .set(values)
      .where(eq(maintenanceLogsTable.id, params.data.id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ log: row });
  },
);

router.delete(
  "/maintenance-logs/:id",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const params = DeleteMaintenanceLogParams.safeParse({
      id: Number(req.params.id),
    });
    if (!params.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!(await assertMaintenanceLogInScope(req, res, params.data.id))) return;

    const [existing] = await db
      .select({
        description: maintenanceLogsTable.description,
        costCents: maintenanceLogsTable.costCents,
      })
      .from(maintenanceLogsTable)
      .where(eq(maintenanceLogsTable.id, params.data.id));
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const usd = `$${((existing.costCents ?? 0) / 100).toFixed(2)}`;

    const outcome = await requestDelete({
      req,
      kind: "maintenance_log",
      id: params.data.id,
      label: `Maintenance log: ${existing.description} (${usd})`,
      execute: async () => {
        const deleted = await db
          .delete(maintenanceLogsTable)
          .where(eq(maintenanceLogsTable.id, params.data.id))
          .returning({ id: maintenanceLogsTable.id });
        return deleted.length > 0;
      },
    });
    sendDeleteOutcome(res, outcome);
  },
);

// ---------- Maintenance log receipt + accountant fields ----------
// Stored as a base64 data URL so the demo doesn't need an object store.
// Capped at ~3MB to keep the row size sane; clients should compress
// before sending. Vendor / category / notes are siblings of the
// receipt because the accountant typically fills them in at the same
// time as attaching the receipt photo.
const MAX_RECEIPT_DATA_URL_BYTES = 3 * 1024 * 1024;
const RECEIPT_CATEGORY_KEYS = [
  "LABOR",
  "PARTS",
  "FUEL",
  "OUTSOURCED",
  "OTHER",
] as const;
const updateReceiptSchema = z
  .object({
    vendor: z.string().max(120).nullable().optional(),
    category: z.enum(RECEIPT_CATEGORY_KEYS).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    receiptDataUrl: z
      .string()
      .max(MAX_RECEIPT_DATA_URL_BYTES)
      .nullable()
      .optional(),
  })
  .strict();

router.put(
  "/maintenance-logs/:id/receipt",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = updateReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (!(await assertMaintenanceLogInScope(req, res, id))) return;
    if (parsed.data.receiptDataUrl) {
      // Cheap mime guard: only allow inline data URLs that look like images.
      if (!/^data:image\/(png|jpe?g|gif|webp);base64,/.test(parsed.data.receiptDataUrl)) {
        res.status(400).json({ error: "receipt_must_be_image_data_url" });
        return;
      }
    }
    const [row] = await db
      .update(maintenanceLogsTable)
      .set(parsed.data as Partial<typeof maintenanceLogsTable.$inferInsert>)
      .where(eq(maintenanceLogsTable.id, id))
      .returning({
        id: maintenanceLogsTable.id,
        vendor: maintenanceLogsTable.vendor,
        category: maintenanceLogsTable.category,
        notes: maintenanceLogsTable.notes,
        receiptDataUrl: maintenanceLogsTable.receiptDataUrl,
      });
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      log: {
        id: row.id,
        vendor: row.vendor,
        category: row.category,
        notes: row.notes,
        hasReceipt: row.receiptDataUrl != null && row.receiptDataUrl.length > 0,
      },
    });
  },
);

// Returns the full receipt data URL on demand (excluded from the list
// payload to keep that response small). Same view permissions as the
// list itself.
router.get(
  "/maintenance-logs/:id/receipt",
  requireAuth,
  requireSection("fleet.maintenance", "view"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const [row] = await db
      .select({
        receiptDataUrl: maintenanceLogsTable.receiptDataUrl,
      })
      .from(maintenanceLogsTable)
      .where(eq(maintenanceLogsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ receiptDataUrl: row.receiptDataUrl ?? null });
  },
);

// ---------- Asset Registry ----------
// Top-level taxonomy that the registry surfaces. TRUCK / TRAILER come from
// the trucks table (`vehicle_type` discriminator); HANDHELD / CUSTOM come
// from equipment.category.
type AssetCategory = "TRUCK" | "TRAILER" | "HANDHELD" | "CUSTOM";

type AssetSummary = {
  kind: "TRUCK" | "EQUIPMENT";
  category: AssetCategory;
  customCategoryLabel: string | null;
  quantity: number;
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  model: string | null;
  identifier: string | null;
  // Raw columns the Edit Asset dialog pre-fills from. `plate` is trucks
  // only, `equipmentType` is equipment only — the other side is null.
  plate: string | null;
  equipmentType: string | null;
  status: string;
  departmentId: number | null;
  departmentName: string | null;
  assignedCrewId: number | null;
  assignedCrewName: string | null;
  lastAssignedAt: string | null;
  lastAssignedByUserId: number | null;
  lastAssignedByName: string | null;
  purchasePriceCents: number | null;
  purchaseDate: string | null;
  location: string | null;
  currentUsage: number;
  usageUnit: "MILES" | "HOURS" | "NONE";
  serviceIntervalUsage: number;
  lastServiceUsage: number | null;
  usageSinceLastService: number | null;
  nextServiceDueAt: number;
  usageUntilDue: number;
  serviceState: "OK" | "DUE_SOON" | "OVERDUE";
  lifeToDateSpendCents: number;
  ytdSpendCents: number;
  mtdSpendCents: number;
  last30SpendCents: number;
  costPerUsageCents: number | null;
  lastServicePerformedAt: string | null;
  // Photo (base64 data URL — image/png|jpeg|webp).
  hasImage: boolean;
  imageDataUrl: string | null;
  // Checkout status: who currently holds the asset, and the last person
  // who took it out if it's currently checked in. Both names resolved
  // server-side so the UI can render without a second round-trip.
  currentHolderUserId: number | null;
  currentHolderName: string | null;
  currentCheckoutId: number | null;
  currentCheckoutSince: string | null;
  lastHolderUserId: number | null;
  lastHolderName: string | null;
  lastCheckedOutAt: string | null;
  // Insurance schedule fields (trucks only; null for equipment)
  year: number | null;
  statedValueCents: number | null;
  gvwGcwLbs: number | null;
  garagingState: string | null;
  operatingRadiusMiles: number | null;
  insuranceVehNumber: number | null;
  bodyTypeCode: string | null;
};

const DUE_SOON_FRACTION = 0.1; // within 10% of interval

// Sentinel value reported on usage-less assets (trailers, quantity-tracked
// handheld/custom items). JSON cannot encode Infinity, so we use a finite
// "essentially never" value the UI tests with `usageUnit === "NONE"`
// before formatting.
const USAGE_UNTIL_DUE_NA = 999_999_999;

function deriveServiceState(
  usageUntilDue: number,
  intervalUsage: number,
): "OK" | "DUE_SOON" | "OVERDUE" {
  if (usageUntilDue < 0) return "OVERDUE";
  if (usageUntilDue <= Math.max(1, Math.round(intervalUsage * DUE_SOON_FRACTION)))
    return "DUE_SOON";
  return "OK";
}

async function buildAssetList(departmentId?: number): Promise<AssetSummary[]> {
  const [trucks, equipment, logs, deptRows, crewRows, openCheckouts] = await Promise.all([
    departmentId != null
      ? db.select().from(trucksTable).where(eq(trucksTable.departmentId, departmentId))
      : db.select().from(trucksTable),
    departmentId != null
      ? db.select().from(equipmentTable).where(eq(equipmentTable.departmentId, departmentId))
      : db.select().from(equipmentTable),
    db.select().from(maintenanceLogsTable),
    db.select({ id: departmentsTable.id, label: departmentsTable.label }).from(departmentsTable),
    db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable),
    // Open checkouts (one per asset, by uniqueness convention enforced at
    // the route layer) drive the "currently held by" badge.
    db
      .select()
      .from(assetCheckoutsTable)
      .where(isNull(assetCheckoutsTable.checkedInAt)),
  ]);

  const deptMap = new Map(deptRows.map((d) => [d.id, d.label]));
  const crewMap = new Map(crewRows.map((c) => [c.id, c.name]));

  // Resolve any "last assigned by" / holder / last-holder names in one
  // batched query so every row carries printable actors without N+1
  // lookups.
  const userIdSet = new Set<number>();
  for (const t of trucks) {
    if (t.lastAssignedByUserId != null) userIdSet.add(t.lastAssignedByUserId);
    if (t.currentHolderUserId != null) userIdSet.add(t.currentHolderUserId);
  }
  for (const e of equipment) {
    if (e.lastAssignedByUserId != null) userIdSet.add(e.lastAssignedByUserId);
    if (e.currentHolderUserId != null) userIdSet.add(e.currentHolderUserId);
  }
  for (const c of openCheckouts) {
    if (c.userId != null) userIdSet.add(c.userId);
  }
  const userNameRows = userIdSet.size
    ? await db
        .select({ id: usersTable.id, fullName: usersTable.fullName })
        .from(usersTable)
        .where(inArray(usersTable.id, Array.from(userIdSet)))
    : [];
  const userNameMap = new Map(userNameRows.map((u) => [u.id, u.fullName]));

  // Resolve last-completed checkout per asset for the "last out" tooltip
  // shown when an asset is currently checked in. One query, then bucketed
  // in memory.
  const closedCheckouts = await db
    .select({
      assetType: assetCheckoutsTable.assetType,
      assetId: assetCheckoutsTable.assetId,
      userId: assetCheckoutsTable.userId,
      checkedOutAt: assetCheckoutsTable.checkedOutAt,
      checkedInAt: assetCheckoutsTable.checkedInAt,
    })
    .from(assetCheckoutsTable)
    .orderBy(desc(assetCheckoutsTable.checkedOutAt));
  const lastClosedHolder = new Map<
    string,
    { userId: number; checkedOutAt: Date }
  >();
  for (const c of closedCheckouts) {
    if (c.checkedInAt == null) continue;
    const key = `${c.assetType}-${c.assetId}`;
    if (!lastClosedHolder.has(key)) {
      lastClosedHolder.set(key, { userId: c.userId, checkedOutAt: c.checkedOutAt });
    }
  }
  const openByAsset = new Map<
    string,
    { id: number; userId: number; checkedOutAt: Date }
  >();
  for (const c of openCheckouts) {
    const key = `${c.assetType}-${c.assetId}`;
    if (!openByAsset.has(key)) {
      openByAsset.set(key, { id: c.id, userId: c.userId, checkedOutAt: c.checkedOutAt });
    }
  }
  for (const id of Array.from(userIdSet).concat(
    Array.from(lastClosedHolder.values()).map((v) => v.userId),
  )) {
    userIdSet.add(id);
  }
  // Second pass for any holders we missed from closed-checkout history.
  const extraIds = Array.from(lastClosedHolder.values())
    .map((v) => v.userId)
    .filter((id) => !userNameMap.has(id));
  if (extraIds.length) {
    const more = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName })
      .from(usersTable)
      .where(inArray(usersTable.id, extraIds));
    for (const u of more) userNameMap.set(u.id, u.fullName);
  }

  const truckLogs = new Map<number, typeof logs>();
  const equipLogs = new Map<number, typeof logs>();
  for (const log of logs) {
    if (log.truckId) {
      const list = truckLogs.get(log.truckId) ?? [];
      list.push(log);
      truckLogs.set(log.truckId, list);
    } else if (log.equipmentId) {
      const list = equipLogs.get(log.equipmentId) ?? [];
      list.push(log);
      equipLogs.set(log.equipmentId, list);
    }
  }

  const assets: AssetSummary[] = [];
  const now = new Date();
  const yearStartTs = new Date(now.getFullYear(), 0, 1).getTime();
  const monthStartTs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const since30Ts = Date.now() - 30 * 86_400_000;

  const sumPeriods = (rows: MaintenanceLog[]) => {
    let lifetime = 0;
    let ytd = 0;
    let mtd = 0;
    let last30 = 0;
    for (const l of rows) {
      const c = l.costCents ?? 0;
      const t = new Date(l.performedAt).getTime();
      lifetime += c;
      if (t >= yearStartTs) ytd += c;
      if (t >= monthStartTs) mtd += c;
      if (t >= since30Ts) last30 += c;
    }
    return { lifetime, ytd, mtd, last30 };
  };

  for (const t of trucks) {
    const myLogs = (truckLogs.get(t.id) ?? []).slice().sort((a, b) => {
      return (
        new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime()
      );
    });
    const { lifetime, ytd, mtd, last30 } = sumPeriods(myLogs);
    // Service interval is anchored on the most recent SCHEDULED service that
    // captured a usage reading — that defines the next-due baseline.
    const lastScheduled = myLogs.find(
      (l) => l.kind === "SCHEDULED" && l.mileageAtService != null,
    );
    const lastService = myLogs[0] ?? null;
    const lastServiceUsage = lastScheduled?.mileageAtService ?? null;
    const usageSinceLastService =
      lastServiceUsage != null ? Math.max(0, t.currentMileage - lastServiceUsage) : null;
    const nextDueAt = (lastServiceUsage ?? 0) + t.serviceIntervalMiles;
    const usageUntilDue = nextDueAt - t.currentMileage;
    // Trailers share the trucks table but don't track usage. The UI hides
    // the odometer column for them, and we report serviceState=OK so they
    // don't pollute the "due soon / overdue" rollups.
    const isTrailer = t.vehicleType === "TRAILER";
    const truckKey = `TRUCK-${t.id}`;
    const open = openByAsset.get(truckKey);
    const lastClosed = lastClosedHolder.get(truckKey);
    assets.push({
      kind: "TRUCK",
      category: isTrailer ? "TRAILER" : "TRUCK",
      customCategoryLabel: null,
      quantity: 1,
      id: t.id,
      slug: t.slug ?? makeAssetSlug("truck", t.id, t.name),
      name: t.name,
      brand: t.brand,
      model: t.model,
      identifier: t.vin,
      plate: t.plate,
      equipmentType: null,
      status: t.status,
      departmentId: t.departmentId ?? null,
      departmentName: t.departmentId != null ? (deptMap.get(t.departmentId) ?? null) : null,
      assignedCrewId: t.assignedCrewId ?? null,
      assignedCrewName:
        t.assignedCrewId != null ? (crewMap.get(t.assignedCrewId) ?? null) : null,
      lastAssignedAt: t.lastAssignedAt ? t.lastAssignedAt.toISOString() : null,
      lastAssignedByUserId: t.lastAssignedByUserId ?? null,
      lastAssignedByName:
        t.lastAssignedByUserId != null
          ? (userNameMap.get(t.lastAssignedByUserId) ?? null)
          : null,
      purchasePriceCents: t.purchasePriceCents,
      purchaseDate: t.purchaseDate ? t.purchaseDate.toISOString() : null,
      location: null,
      currentUsage: isTrailer ? 0 : t.currentMileage,
      usageUnit: isTrailer ? "NONE" : "MILES",
      serviceIntervalUsage: t.serviceIntervalMiles,
      lastServiceUsage,
      usageSinceLastService,
      nextServiceDueAt: nextDueAt,
      usageUntilDue: isTrailer ? USAGE_UNTIL_DUE_NA : usageUntilDue,
      serviceState: isTrailer
        ? "OK"
        : deriveServiceState(usageUntilDue, t.serviceIntervalMiles),
      lifeToDateSpendCents: lifetime,
      ytdSpendCents: ytd,
      mtdSpendCents: mtd,
      last30SpendCents: last30,
      costPerUsageCents:
        !isTrailer && t.currentMileage > 0
          ? Math.round(lifetime / t.currentMileage)
          : null,
      lastServicePerformedAt: lastService
        ? new Date(lastService.performedAt).toISOString()
        : null,
      hasImage: t.imageDataUrl != null && t.imageDataUrl.length > 0,
      imageDataUrl: null,
      currentHolderUserId: open?.userId ?? null,
      currentHolderName: open ? (userNameMap.get(open.userId) ?? null) : null,
      currentCheckoutId: open?.id ?? null,
      currentCheckoutSince: open ? new Date(open.checkedOutAt).toISOString() : null,
      lastHolderUserId: open ? null : (lastClosed?.userId ?? null),
      lastHolderName:
        open
          ? null
          : lastClosed
            ? (userNameMap.get(lastClosed.userId) ?? null)
            : null,
      lastCheckedOutAt: t.lastCheckedOutAt
        ? new Date(t.lastCheckedOutAt).toISOString()
        : open
          ? new Date(open.checkedOutAt).toISOString()
          : lastClosed
            ? new Date(lastClosed.checkedOutAt).toISOString()
            : null,
      year: t.year ?? null,
      statedValueCents: t.statedValueCents ?? null,
      gvwGcwLbs: t.gvwGcwLbs ?? null,
      garagingState: t.garagingState ?? null,
      operatingRadiusMiles: t.operatingRadiusMiles ?? null,
      insuranceVehNumber: t.insuranceVehNumber ?? null,
      bodyTypeCode: t.bodyTypeCode ?? null,
    });
  }

  for (const e of equipment) {
    const myLogs = (equipLogs.get(e.id) ?? []).slice().sort((a, b) => {
      return (
        new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime()
      );
    });
    const { lifetime, ytd, mtd, last30 } = sumPeriods(myLogs);
    const lastScheduled = myLogs.find(
      (l) => l.kind === "SCHEDULED" && l.hoursAtService != null,
    );
    const lastService = myLogs[0] ?? null;
    const lastServiceUsage = lastScheduled?.hoursAtService ?? null;
    const usageSinceLastService =
      lastServiceUsage != null ? Math.max(0, e.currentHours - lastServiceUsage) : null;
    const nextDueAt = (lastServiceUsage ?? 0) + e.serviceIntervalHours;
    const usageUntilDue = nextDueAt - e.currentHours;
    // Quantity-tracked items (typically zero or a single fixed run-time
    // engine) don't drive a service-due cadence — surface them as OK.
    const tracksHours = e.serviceIntervalHours > 0 && e.currentHours > 0;
    const equipKey = `EQUIPMENT-${e.id}`;
    const open = openByAsset.get(equipKey);
    const lastClosed = lastClosedHolder.get(equipKey);
    assets.push({
      kind: "EQUIPMENT",
      category: e.category,
      customCategoryLabel: e.customCategoryLabel ?? null,
      quantity: e.quantity ?? 1,
      id: e.id,
      slug: e.slug ?? makeAssetSlug("equip", e.id, e.name),
      name: e.name,
      brand: e.brand,
      model: e.model,
      identifier: e.serial,
      plate: null,
      equipmentType: e.type,
      status: e.status,
      departmentId: e.departmentId ?? null,
      departmentName: e.departmentId != null ? (deptMap.get(e.departmentId) ?? null) : null,
      assignedCrewId: e.assignedCrewId ?? null,
      assignedCrewName:
        e.assignedCrewId != null ? (crewMap.get(e.assignedCrewId) ?? null) : null,
      lastAssignedAt: e.lastAssignedAt ? e.lastAssignedAt.toISOString() : null,
      lastAssignedByUserId: e.lastAssignedByUserId ?? null,
      lastAssignedByName:
        e.lastAssignedByUserId != null
          ? (userNameMap.get(e.lastAssignedByUserId) ?? null)
          : null,
      purchasePriceCents: e.purchasePriceCents,
      purchaseDate: e.purchaseDate ? e.purchaseDate.toISOString() : null,
      location: e.location ?? null,
      currentUsage: tracksHours ? e.currentHours : 0,
      usageUnit: tracksHours ? "HOURS" : "NONE",
      serviceIntervalUsage: e.serviceIntervalHours,
      lastServiceUsage,
      usageSinceLastService,
      nextServiceDueAt: nextDueAt,
      usageUntilDue: tracksHours ? usageUntilDue : USAGE_UNTIL_DUE_NA,
      serviceState: tracksHours
        ? deriveServiceState(usageUntilDue, e.serviceIntervalHours)
        : "OK",
      lifeToDateSpendCents: lifetime,
      ytdSpendCents: ytd,
      mtdSpendCents: mtd,
      last30SpendCents: last30,
      costPerUsageCents:
        tracksHours ? Math.round(lifetime / e.currentHours) : null,
      lastServicePerformedAt: lastService
        ? new Date(lastService.performedAt).toISOString()
        : null,
      hasImage: e.imageDataUrl != null && e.imageDataUrl.length > 0,
      imageDataUrl: null,
      currentHolderUserId: open?.userId ?? null,
      currentHolderName: open ? (userNameMap.get(open.userId) ?? null) : null,
      currentCheckoutId: open?.id ?? null,
      currentCheckoutSince: open ? new Date(open.checkedOutAt).toISOString() : null,
      lastHolderUserId: open ? null : (lastClosed?.userId ?? null),
      lastHolderName:
        open
          ? null
          : lastClosed
            ? (userNameMap.get(lastClosed.userId) ?? null)
            : null,
      lastCheckedOutAt: e.lastCheckedOutAt
        ? new Date(e.lastCheckedOutAt).toISOString()
        : open
          ? new Date(open.checkedOutAt).toISOString()
          : lastClosed
            ? new Date(lastClosed.checkedOutAt).toISOString()
            : null,
      year: null,
      statedValueCents: null,
      gvwGcwLbs: null,
      garagingState: null,
      operatingRadiusMiles: null,
      insuranceVehNumber: null,
      bodyTypeCode: null,
    });
  }

  // Sort: overdue first, then due soon, then by life-to-date desc
  const stateRank: Record<AssetSummary["serviceState"], number> = {
    OVERDUE: 0,
    DUE_SOON: 1,
    OK: 2,
  };
  assets.sort((a, b) => {
    const r = stateRank[a.serviceState] - stateRank[b.serviceState];
    if (r !== 0) return r;
    return b.lifeToDateSpendCents - a.lifeToDateSpendCents;
  });

  return assets;
}

// Section gate: viewer of either trucks OR equipment can see the registry.
function requireFleetView(): import("express").RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    const canTrucks = hasSectionAccess(req.user, "fleet.trucks", "view");
    const canEquipment = hasSectionAccess(req.user, "fleet.equipment", "view");
    if (!canTrucks && !canEquipment) {
      res
        .status(403)
        .json({ error: "forbidden", section: "fleet", action: "view" });
      return;
    }
    next();
  };
}

// Per-kind viewer scope: filter assets to those the user is allowed to see.
function viewableKinds(
  user: NonNullable<import("express").Request["user"]>,
): Set<"TRUCK" | "EQUIPMENT"> {
  const kinds = new Set<"TRUCK" | "EQUIPMENT">();
  if (hasSectionAccess(user, "fleet.trucks", "view")) kinds.add("TRUCK");
  if (hasSectionAccess(user, "fleet.equipment", "view")) kinds.add("EQUIPMENT");
  return kinds;
}

function resolveDeptId(req: import("express").Request): number | undefined {
  const user = req.user!;
  if (user.role === "ADMIN") {
    const raw = req.query.departmentId;
    if (raw) {
      const parsed = parseInt(String(raw), 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }
  return user.departmentId;
}

/**
 * For non-admin callers, verify the target truck/equipment belongs to the same
 * department as the caller.  Returns true on success (or for admins); returns
 * false after sending a 403/404 response so the caller can immediately return.
 */
async function assertAssetInScope(
  req: import("express").Request,
  res: import("express").Response,
  opts: { truckId?: number | null; equipmentId?: number | null },
): Promise<boolean> {
  const user = req.user!;
  if (user.role === "ADMIN") return true;

  const userDept = user.departmentId;

  if (opts.truckId != null) {
    const [truck] = await db
      .select({ departmentId: trucksTable.departmentId })
      .from(trucksTable)
      .where(eq(trucksTable.id, opts.truckId));
    if (!truck) {
      res.status(404).json({ error: "not_found" });
      return false;
    }
    if (truck.departmentId !== userDept) {
      res.status(403).json({ error: "forbidden", detail: "asset belongs to a different department" });
      return false;
    }
  }

  if (opts.equipmentId != null) {
    const [equip] = await db
      .select({ departmentId: equipmentTable.departmentId })
      .from(equipmentTable)
      .where(eq(equipmentTable.id, opts.equipmentId));
    if (!equip) {
      res.status(404).json({ error: "not_found" });
      return false;
    }
    if (equip.departmentId !== userDept) {
      res.status(403).json({ error: "forbidden", detail: "asset belongs to a different department" });
      return false;
    }
  }

  return true;
}

/**
 * Same as assertAssetInScope but resolves the asset from a maintenance log id.
 */
async function assertMaintenanceLogInScope(
  req: import("express").Request,
  res: import("express").Response,
  logId: number,
): Promise<boolean> {
  const user = req.user!;
  if (user.role === "ADMIN") return true;

  const [log] = await db
    .select({ truckId: maintenanceLogsTable.truckId, equipmentId: maintenanceLogsTable.equipmentId })
    .from(maintenanceLogsTable)
    .where(eq(maintenanceLogsTable.id, logId));
  if (!log) {
    res.status(404).json({ error: "not_found" });
    return false;
  }
  return assertAssetInScope(req, res, { truckId: log.truckId, equipmentId: log.equipmentId });
}

router.get("/assets", requireAuth, requireFleetView(), async (req, res) => {
  const allowed = viewableKinds(req.user!);
  const assets = (await buildAssetList(resolveDeptId(req))).filter((a) => allowed.has(a.kind));
  res.json({ assets });
});

router.get(
  "/assets/:slug",
  requireAuth,
  requireFleetView(),
  async (req, res) => {
    const params = GetAssetBySlugParams.safeParse({ slug: req.params.slug });
    if (!params.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const allowed = viewableKinds(req.user!);
    const assets = (await buildAssetList()).filter((a) => allowed.has(a.kind));
    const asset = assets.find((a) => a.slug === params.data.slug);
    if (!asset) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rawLogs = asset.kind === "TRUCK"
      ? await db
          .select()
          .from(maintenanceLogsTable)
          .where(eq(maintenanceLogsTable.truckId, asset.id))
          .orderBy(desc(maintenanceLogsTable.performedAt))
      : await db
          .select()
          .from(maintenanceLogsTable)
          .where(eq(maintenanceLogsTable.equipmentId, asset.id))
          .orderBy(desc(maintenanceLogsTable.performedAt));

    // Resolve logged-by user names in one batch query.
    const loggedByIds = [
      ...new Set(rawLogs.map((l) => l.loggedByUserId).filter((id): id is number => id != null)),
    ];
    const loggedByUsers =
      loggedByIds.length > 0
        ? await db
            .select({ id: usersTable.id, fullName: usersTable.fullName })
            .from(usersTable)
            .where(sql`${usersTable.id} = ANY(ARRAY[${sql.raw(loggedByIds.join(","))}]::int[])`)
        : [];
    const userNameMap = new Map(loggedByUsers.map((u) => [u.id, u.fullName]));
    const logs = rawLogs.map((l) => ({
      ...l,
      loggedByName: l.loggedByUserId ? (userNameMap.get(l.loggedByUserId) ?? null) : null,
    }));

    const recentReadings = asset.kind === "TRUCK"
      ? await db
          .select()
          .from(usageReadingsTable)
          .where(eq(usageReadingsTable.truckId, asset.id))
          .orderBy(desc(usageReadingsTable.recordedAt))
          .limit(20)
      : await db
          .select()
          .from(usageReadingsTable)
          .where(eq(usageReadingsTable.equipmentId, asset.id))
          .orderBy(desc(usageReadingsTable.recordedAt))
          .limit(20);

    res.json({ asset, logs, recentReadings });
  },
);

router.post(
  "/assets/:slug/status",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const rawStatus = String((req.body ?? {}).status ?? "");
    const allowed = ["ACTIVE", "IN_SHOP", "RETIRED"] as const;
    type AllowedStatus = (typeof allowed)[number];
    if (!(allowed as readonly string[]).includes(rawStatus)) {
      res.status(400).json({ error: "invalid_status" });
      return;
    }
    const status = rawStatus as AllowedStatus;
    const allowedKinds = viewableKinds(req.user!);
    // Scope to user's department for non-admins so they cannot change status
    // of assets belonging to a different department.
    const assets = (await buildAssetList(resolveDeptId(req))).filter((a) => allowedKinds.has(a.kind));
    const asset = assets.find((a) => a.slug === slug);
    if (!asset) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (asset.kind === "TRUCK") {
      await db
        .update(trucksTable)
        .set({ status })
        .where(eq(trucksTable.id, asset.id));
    } else {
      await db
        .update(equipmentTable)
        .set({ status })
        .where(eq(equipmentTable.id, asset.id));
    }
    // Record the status transition for audit trail.
    if (asset.status !== status) {
      await db.insert(assetStatusLogTable).values({
        assetType: asset.kind,
        assetId: asset.id,
        oldStatus: asset.status,
        newStatus: status,
        changedByUserId: req.user?.id ?? null,
      });
    }
    // Re-query so we return the freshest summary, including derived fields.
    const refreshed = (await buildAssetList(resolveDeptId(req))).find((a) => a.slug === slug);
    res.json({ asset: refreshed, logs: [], recentReadings: [] });
  },
);

router.get(
  "/assets/:slug/status-history",
  requireAuth,
  requireFleetView(),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const allowedKinds = viewableKinds(req.user!);
    const assets = (await buildAssetList()).filter((a) => allowedKinds.has(a.kind));
    const asset = assets.find((a) => a.slug === slug);
    if (!asset) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const rawHistory = await db
      .select()
      .from(assetStatusLogTable)
      .where(
        and(
          eq(assetStatusLogTable.assetType, asset.kind),
          eq(assetStatusLogTable.assetId, asset.id),
        ),
      )
      .orderBy(desc(assetStatusLogTable.changedAt))
      .limit(10);

    const changedByIds = [
      ...new Set(
        rawHistory.map((h) => h.changedByUserId).filter((id): id is number => id != null),
      ),
    ];
    const changedByUsers =
      changedByIds.length > 0
        ? await db
            .select({ id: usersTable.id, fullName: usersTable.fullName })
            .from(usersTable)
            .where(sql`${usersTable.id} = ANY(ARRAY[${sql.raw(changedByIds.join(","))}]::int[])`)
        : [];
    const userNameMap = new Map(changedByUsers.map((u) => [u.id, u.fullName]));
    const history = rawHistory.map((h) => ({
      ...h,
      changedAt: new Date(h.changedAt).toISOString(),
      changedByName: h.changedByUserId
        ? (userNameMap.get(h.changedByUserId) ?? null)
        : null,
    }));
    res.json({ history });
  },
);

// ---------- Asset photo (hero image) ----------
// Stored on the trucks/equipment row as a base64 data URL. Mirrors the
// maintenance-receipt approach so we don't need an object store. 5MB
// upper bound; image-mime guard. Returned on demand to keep the registry
// list response small (the list payload only carries `hasImage`).
const MAX_ASSET_IMAGE_BYTES = 5 * 1024 * 1024;
const updateAssetImageSchema = z
  .object({
    imageDataUrl: z.string().max(MAX_ASSET_IMAGE_BYTES).nullable(),
  })
  .strict();

async function resolveAssetSlug(
  req: import("express").Request,
  res: import("express").Response,
  slug: string,
): Promise<AssetSummary | null> {
  const allowedKinds = viewableKinds(req.user!);
  const assets = (await buildAssetList()).filter((a) => allowedKinds.has(a.kind));
  const asset = assets.find((a) => a.slug === slug) ?? null;
  if (!asset) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return asset;
}

router.put(
  "/assets/:slug/image",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const parsed = updateAssetImageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const dataUrl = parsed.data.imageDataUrl;
    if (dataUrl && !/^data:image\/(png|jpe?g|gif|webp);base64,/.test(dataUrl)) {
      res.status(400).json({ error: "image_must_be_image_data_url" });
      return;
    }
    const asset = await resolveAssetSlug(req, res, slug);
    if (!asset) return;
    if (
      !(await assertAssetInScope(req, res, {
        truckId: asset.kind === "TRUCK" ? asset.id : null,
        equipmentId: asset.kind === "EQUIPMENT" ? asset.id : null,
      }))
    ) {
      return;
    }
    if (asset.kind === "TRUCK") {
      await db
        .update(trucksTable)
        .set({ imageDataUrl: dataUrl ?? null })
        .where(eq(trucksTable.id, asset.id));
    } else {
      await db
        .update(equipmentTable)
        .set({ imageDataUrl: dataUrl ?? null })
        .where(eq(equipmentTable.id, asset.id));
    }
    res.json({ ok: true, hasImage: dataUrl != null && dataUrl.length > 0 });
  },
);

router.get(
  "/assets/:slug/image",
  requireAuth,
  requireFleetView(),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const asset = await resolveAssetSlug(req, res, slug);
    if (!asset) return;
    let dataUrl: string | null = null;
    if (asset.kind === "TRUCK") {
      const [row] = await db
        .select({ imageDataUrl: trucksTable.imageDataUrl })
        .from(trucksTable)
        .where(eq(trucksTable.id, asset.id));
      dataUrl = row?.imageDataUrl ?? null;
    } else {
      const [row] = await db
        .select({ imageDataUrl: equipmentTable.imageDataUrl })
        .from(equipmentTable)
        .where(eq(equipmentTable.id, asset.id));
      dataUrl = row?.imageDataUrl ?? null;
    }
    res.json({ imageDataUrl: dataUrl });
  },
);

// ---------- Asset checkout / check-in ----------
// One open row per asset (assetType + assetId) is invariant: the
// checkout route refuses to open a new one while another is open.
// Closing a checkout updates checked_in_at and clears the cached
// currentHolderUserId pointer on the parent asset.
const checkoutSchema = z
  .object({
    userId: z.number().int().positive(),
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

const checkinSchema = z
  .object({
    notes: z.string().max(500).nullable().optional(),
  })
  .strict();

router.post(
  "/assets/:slug/checkout",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const asset = await resolveAssetSlug(req, res, slug);
    if (!asset) return;
    if (
      !(await assertAssetInScope(req, res, {
        truckId: asset.kind === "TRUCK" ? asset.id : null,
        equipmentId: asset.kind === "EQUIPMENT" ? asset.id : null,
      }))
    ) {
      return;
    }
    // Verify the target user exists; otherwise a typo creates an orphan row.
    const [targetUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, parsed.data.userId));
    if (!targetUser) {
      res.status(400).json({ error: "user_not_found" });
      return;
    }
    // Refuse if there's already an open checkout — caller must check in first.
    const [existing] = await db
      .select({ id: assetCheckoutsTable.id })
      .from(assetCheckoutsTable)
      .where(
        and(
          eq(assetCheckoutsTable.assetType, asset.kind),
          eq(assetCheckoutsTable.assetId, asset.id),
          isNull(assetCheckoutsTable.checkedInAt),
        ),
      )
      .limit(1);
    if (existing) {
      res.status(409).json({ error: "already_checked_out", checkoutId: existing.id });
      return;
    }
    const [row] = await db
      .insert(assetCheckoutsTable)
      .values({
        assetType: asset.kind,
        assetId: asset.id,
        userId: parsed.data.userId,
        checkedOutByUserId: req.user?.id ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    const now = new Date();
    if (asset.kind === "TRUCK") {
      await db
        .update(trucksTable)
        .set({ currentHolderUserId: parsed.data.userId, lastCheckedOutAt: now })
        .where(eq(trucksTable.id, asset.id));
    } else {
      await db
        .update(equipmentTable)
        .set({ currentHolderUserId: parsed.data.userId, lastCheckedOutAt: now })
        .where(eq(equipmentTable.id, asset.id));
    }
    res.status(201).json({ checkout: row });
  },
);

router.post(
  "/assets/:slug/checkin",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const parsed = checkinSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const asset = await resolveAssetSlug(req, res, slug);
    if (!asset) return;
    if (
      !(await assertAssetInScope(req, res, {
        truckId: asset.kind === "TRUCK" ? asset.id : null,
        equipmentId: asset.kind === "EQUIPMENT" ? asset.id : null,
      }))
    ) {
      return;
    }
    const [open] = await db
      .select()
      .from(assetCheckoutsTable)
      .where(
        and(
          eq(assetCheckoutsTable.assetType, asset.kind),
          eq(assetCheckoutsTable.assetId, asset.id),
          isNull(assetCheckoutsTable.checkedInAt),
        ),
      )
      .limit(1);
    if (!open) {
      res.status(404).json({ error: "not_checked_out" });
      return;
    }
    const now = new Date();
    const trimmedNotes = parsed.data.notes?.trim();
    // Append the check-in note onto whatever was already on the row so we
    // don't lose the checkout-time note.
    const mergedNotes = [open.notes ?? null, trimmedNotes ? `[checked in] ${trimmedNotes}` : null]
      .filter((x): x is string => !!x && x.length > 0)
      .join(" \n");
    const [closed] = await db
      .update(assetCheckoutsTable)
      .set({
        checkedInAt: now,
        checkedInByUserId: req.user?.id ?? null,
        notes: mergedNotes || null,
      })
      .where(eq(assetCheckoutsTable.id, open.id))
      .returning();
    if (asset.kind === "TRUCK") {
      await db
        .update(trucksTable)
        .set({ currentHolderUserId: null })
        .where(eq(trucksTable.id, asset.id));
    } else {
      await db
        .update(equipmentTable)
        .set({ currentHolderUserId: null })
        .where(eq(equipmentTable.id, asset.id));
    }
    res.json({ checkout: closed });
  },
);

router.get(
  "/assets/:slug/checkouts",
  requireAuth,
  requireFleetView(),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const asset = await resolveAssetSlug(req, res, slug);
    if (!asset) return;
    const rows = await db
      .select()
      .from(assetCheckoutsTable)
      .where(
        and(
          eq(assetCheckoutsTable.assetType, asset.kind),
          eq(assetCheckoutsTable.assetId, asset.id),
        ),
      )
      .orderBy(desc(assetCheckoutsTable.checkedOutAt))
      .limit(100);
    const userIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.userId, r.checkedOutByUserId, r.checkedInByUserId])
          .filter((n): n is number => n != null),
      ),
    );
    const users = userIds.length
      ? await db
          .select({ id: usersTable.id, fullName: usersTable.fullName })
          .from(usersTable)
          .where(inArray(usersTable.id, userIds))
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.fullName]));
    const history = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: userMap.get(r.userId) ?? null,
      checkedOutByUserId: r.checkedOutByUserId,
      checkedOutByName: r.checkedOutByUserId ? (userMap.get(r.checkedOutByUserId) ?? null) : null,
      checkedOutAt: new Date(r.checkedOutAt).toISOString(),
      checkedInAt: r.checkedInAt ? new Date(r.checkedInAt).toISOString() : null,
      checkedInByUserId: r.checkedInByUserId,
      checkedInByName: r.checkedInByUserId ? (userMap.get(r.checkedInByUserId) ?? null) : null,
      notes: r.notes,
    }));
    res.json({ history });
  },
);

// ---------- Crews ----------

const createCrewSchema = z.object({
  name: z.string().min(1).max(120),
  leadUserId: z.number().int().positive(),
  departmentId: z.number().int().positive().optional(),
});

// POST /crews — create a new crew. Requires fleet.trucks OR admin.users edit access.
router.post(
  "/crews",
  requireAuth,
  (req, res, next) => {
    if (!req.user) { res.status(401).json({ error: "unauthenticated" }); return; }
    const canFleet = hasSectionAccess(req.user, "fleet.trucks", "edit");
    const canAdmin = hasSectionAccess(req.user, "admin.users", "edit");
    if (!canFleet && !canAdmin) {
      res.status(403).json({ error: "forbidden", section: "fleet.trucks|admin.users", action: "edit" });
      return;
    }
    next();
  },
  async (req, res) => {
    const parsed = createCrewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }
    const { name, leadUserId, departmentId } = parsed.data;
    // Verify the lead user exists.
    const [leadUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, leadUserId));
    if (!leadUser) {
      res.status(400).json({ error: "lead_user_not_found" });
      return;
    }
    const [crew] = await db
      .insert(crewsTable)
      .values({ name, leadUserId, departmentId: departmentId ?? null })
      .returning();
    if (!crew) {
      res.status(500).json({ error: "insert_failed" });
      return;
    }
    // Auto-add the lead as a crew member.
    await db
      .insert(crewMembersTable)
      .values({ crewId: crew.id, userId: leadUserId })
      .onConflictDoNothing();
    res.status(201).json({ crew: { id: crew.id, name: crew.name } });
  },
);

// PATCH /crews/:id — update an existing crew's lead, name, or department.
// Same edit gate as POST /crews. Useful for re-pointing a crew at a new
// crew lead without forcing the user to delete-and-recreate. When
// leadUserId changes the new lead is also auto-added as a member if
// they aren't already.
const updateCrewSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    leadUserId: z.number().int().positive().optional(),
    departmentId: z.number().int().positive().nullable().optional(),
  })
  .strict();

router.patch(
  "/crews/:id",
  requireAuth,
  (req, res, next) => {
    if (!req.user) { res.status(401).json({ error: "unauthenticated" }); return; }
    const canFleet = hasSectionAccess(req.user, "fleet.trucks", "edit");
    const canAdmin = hasSectionAccess(req.user, "admin.users", "edit");
    if (!canFleet && !canAdmin) {
      res.status(403).json({ error: "forbidden", section: "fleet.trucks|admin.users", action: "edit" });
      return;
    }
    next();
  },
  async (req, res) => {
    const crewId = Number(req.params.id);
    if (!Number.isFinite(crewId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = updateCrewSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    if (parsed.data.leadUserId != null) {
      const [leadUser] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.id, parsed.data.leadUserId));
      if (!leadUser) {
        res.status(400).json({ error: "lead_user_not_found" });
        return;
      }
    }
    const [updated] = await db
      .update(crewsTable)
      .set(parsed.data)
      .where(eq(crewsTable.id, crewId))
      .returning({
        id: crewsTable.id,
        name: crewsTable.name,
        leadUserId: crewsTable.leadUserId,
        departmentId: crewsTable.departmentId,
      });
    if (!updated) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (parsed.data.leadUserId != null) {
      await db
        .insert(crewMembersTable)
        .values({ crewId, userId: parsed.data.leadUserId })
        .onConflictDoNothing();
    }
    res.json({ crew: updated });
  },
);

// DELETE /crews/:id — remove a crew. Every FK that points at crews is
// either cascade (crew_members) or set-null (trucks, equipment, jobs,
// assignment log), so deleting one unassigns rather than orphans. Goes
// through the delete guard like every other destructive admin action.
router.delete(
  "/crews/:id",
  requireAuth,
  (req, res, next) => {
    if (!req.user) { res.status(401).json({ error: "unauthenticated" }); return; }
    const canFleet = hasSectionAccess(req.user, "fleet.trucks", "edit");
    const canAdmin = hasSectionAccess(req.user, "admin.users", "edit");
    if (!canFleet && !canAdmin) {
      res.status(403).json({ error: "forbidden", section: "fleet.trucks|admin.users", action: "edit" });
      return;
    }
    next();
  },
  async (req, res) => {
    const crewId = Number(req.params.id);
    if (!Number.isFinite(crewId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const [existing] = await db
      .select({ name: crewsTable.name })
      .from(crewsTable)
      .where(eq(crewsTable.id, crewId));
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const outcome = await requestDelete({
      req,
      kind: "crew",
      id: crewId,
      label: `Crew: ${existing.name}`,
      execute: async () => {
        const deleted = await db
          .delete(crewsTable)
          .where(eq(crewsTable.id, crewId))
          .returning({ id: crewsTable.id });
        return deleted.length > 0;
      },
    });
    sendDeleteOutcome(res, outcome);
  },
);

// GET /crews/lead-candidates — returns a minimal user list (id + fullName) that
// can be assigned as crew leads. Gated by fleet.trucks view so MECHANIC users
// can populate the crew-creation form without needing admin.users view.
router.get(
  "/crews/lead-candidates",
  requireAuth,
  requireFleetView(),
  async (_req, res) => {
    const rows = await db
      .select({ id: usersTable.id, fullName: usersTable.fullName })
      .from(usersTable)
      .orderBy(usersTable.fullName);
    res.json({ users: rows });
  },
);

// GET /crews — list with summary counts so the Crews page can show
// at-a-glance cards (members / trucks / equipment / lead / dept) without
// fetching a detail payload per crew. Anyone with fleet view permission
// can see crew names. Asset-assignment dropdowns ignore the extra fields.
router.get(
  "/crews",
  requireAuth,
  requireFleetView(),
  async (_req, res) => {
    const rows = await db
      .select({
        id: crewsTable.id,
        name: crewsTable.name,
        leadUserId: crewsTable.leadUserId,
        departmentId: crewsTable.departmentId,
      })
      .from(crewsTable)
      .orderBy(crewsTable.name);

    if (rows.length === 0) {
      res.json({ crews: [] });
      return;
    }

    const crewIds = rows.map((r) => r.id);
    const leadIds = Array.from(
      new Set(rows.map((r) => r.leadUserId).filter((id): id is number => id != null)),
    );
    const deptIds = Array.from(
      new Set(rows.map((r) => r.departmentId).filter((id): id is number => id != null)),
    );

    const [memberCounts, truckCounts, equipCounts, leadNames, deptLabels] =
      await Promise.all([
        db
          .select({
            crewId: crewMembersTable.crewId,
            n: sql<number>`count(*)::int`,
          })
          .from(crewMembersTable)
          .where(inArray(crewMembersTable.crewId, crewIds))
          .groupBy(crewMembersTable.crewId),
        db
          .select({
            crewId: trucksTable.assignedCrewId,
            n: sql<number>`count(*)::int`,
          })
          .from(trucksTable)
          .where(inArray(trucksTable.assignedCrewId, crewIds))
          .groupBy(trucksTable.assignedCrewId),
        db
          .select({
            crewId: equipmentTable.assignedCrewId,
            n: sql<number>`count(*)::int`,
          })
          .from(equipmentTable)
          .where(inArray(equipmentTable.assignedCrewId, crewIds))
          .groupBy(equipmentTable.assignedCrewId),
        leadIds.length
          ? db
              .select({ id: usersTable.id, fullName: usersTable.fullName })
              .from(usersTable)
              .where(inArray(usersTable.id, leadIds))
          : Promise.resolve([] as Array<{ id: number; fullName: string }>),
        deptIds.length
          ? db
              .select({ id: departmentsTable.id, label: departmentsTable.label })
              .from(departmentsTable)
              .where(inArray(departmentsTable.id, deptIds))
          : Promise.resolve([] as Array<{ id: number; label: string }>),
      ]);

    const memberMap = new Map(memberCounts.map((r) => [r.crewId, r.n]));
    const truckMap = new Map(
      truckCounts
        .filter((r): r is { crewId: number; n: number } => r.crewId != null)
        .map((r) => [r.crewId, r.n]),
    );
    const equipMap = new Map(
      equipCounts
        .filter((r): r is { crewId: number; n: number } => r.crewId != null)
        .map((r) => [r.crewId, r.n]),
    );
    const leadMap = new Map(leadNames.map((r) => [r.id, r.fullName]));
    const deptMap = new Map(deptLabels.map((r) => [r.id, r.label]));

    const crews = rows.map((r) => ({
      id: r.id,
      name: r.name,
      leadUserId: r.leadUserId,
      leadName: r.leadUserId != null ? (leadMap.get(r.leadUserId) ?? null) : null,
      departmentId: r.departmentId,
      departmentLabel:
        r.departmentId != null ? (deptMap.get(r.departmentId) ?? null) : null,
      memberCount: memberMap.get(r.id) ?? 0,
      truckCount: truckMap.get(r.id) ?? 0,
      equipmentCount: equipMap.get(r.id) ?? 0,
    }));

    res.json({ crews });
  },
);

// GET /crews/:id — full crew detail: members + assigned trucks + equipment.
router.get(
  "/crews/:id",
  requireAuth,
  requireFleetView(),
  async (req, res) => {
    const crewId = Number(req.params.id);
    if (!Number.isFinite(crewId)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const [crew] = await db
      .select({
        id: crewsTable.id,
        name: crewsTable.name,
        leadUserId: crewsTable.leadUserId,
        departmentId: crewsTable.departmentId,
      })
      .from(crewsTable)
      .where(eq(crewsTable.id, crewId));
    if (!crew) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const memberRows = await db
      .select({
        userId: crewMembersTable.userId,
        fullName: usersTable.fullName,
        roleKey: rolesTable.key,
        roleLabel: rolesTable.label,
        deptLabel: departmentsTable.label,
      })
      .from(crewMembersTable)
      .innerJoin(usersTable, eq(crewMembersTable.userId, usersTable.id))
      .innerJoin(rolesTable, eq(usersTable.roleId, rolesTable.id))
      .innerJoin(departmentsTable, eq(usersTable.departmentId, departmentsTable.id))
      .where(eq(crewMembersTable.crewId, crewId));

    const trucks = await db
      .select({
        id: trucksTable.id,
        name: trucksTable.name,
        status: trucksTable.status,
        slug: trucksTable.slug,
      })
      .from(trucksTable)
      .where(eq(trucksTable.assignedCrewId, crewId));

    const equipment = await db
      .select({
        id: equipmentTable.id,
        name: equipmentTable.name,
        type: equipmentTable.type,
        status: equipmentTable.status,
        slug: equipmentTable.slug,
      })
      .from(equipmentTable)
      .where(eq(equipmentTable.assignedCrewId, crewId));

    res.json({
      crew: {
        ...crew,
        members: memberRows.map((m) => ({
          userId: m.userId,
          fullName: m.fullName,
          role: m.roleLabel,
          department: m.deptLabel,
        })),
        trucks,
        equipment,
      },
    });
  },
);

// ---------- Crew Assignment ----------
// POST /assets/:slug/assign — set or clear the assigned crew for any
// asset. Writes both the row's `assigned_crew_id` (and last-assigned
// metadata) and an audit log entry. Idempotent: if the new crew matches
// the current one, no log row is written. Set `crewId` to null to
// "return" the asset.
const assignAssetSchema = z.object({
  crewId: z.number().int().nullable(),
  note: z.string().max(500).optional(),
});

router.post(
  "/assets/:slug/assign",
  requireAuth,
  requireFleetView(),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const parsed = assignAssetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { crewId: newCrewId, note } = parsed.data;

    // Require the same edit scope as status changes — assigning equipment
    // to a crew is an edit on the asset.
    const allowedKinds = viewableKinds(req.user!);
    const sectionForKind = (kind: "TRUCK" | "EQUIPMENT") =>
      kind === "TRUCK" ? "fleet.trucks" : "fleet.equipment";

    const assets = (await buildAssetList(resolveDeptId(req))).filter((a) =>
      allowedKinds.has(a.kind),
    );
    const asset = assets.find((a) => a.slug === slug);
    if (!asset) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!hasSectionAccess(req.user!, sectionForKind(asset.kind), "edit")) {
      res.status(403).json({ error: "forbidden", section: sectionForKind(asset.kind), action: "edit" });
      return;
    }

    // Validate the crew exists if a non-null id was provided.
    if (newCrewId != null) {
      const [crew] = await db
        .select({ id: crewsTable.id })
        .from(crewsTable)
        .where(eq(crewsTable.id, newCrewId));
      if (!crew) {
        res.status(400).json({ error: "unknown_crew" });
        return;
      }
    }

    const oldCrewId = asset.assignedCrewId ?? null;
    const now = new Date();

    if (asset.kind === "TRUCK") {
      await db
        .update(trucksTable)
        .set({
          assignedCrewId: newCrewId ?? null,
          lastAssignedByUserId: req.user?.id ?? null,
          lastAssignedAt: now,
        })
        .where(eq(trucksTable.id, asset.id));
    } else {
      await db
        .update(equipmentTable)
        .set({
          assignedCrewId: newCrewId ?? null,
          lastAssignedByUserId: req.user?.id ?? null,
          lastAssignedAt: now,
        })
        .where(eq(equipmentTable.id, asset.id));
    }

    if ((oldCrewId ?? null) !== (newCrewId ?? null)) {
      await db.insert(assetAssignmentLogTable).values({
        assetType: asset.kind,
        assetId: asset.id,
        oldCrewId: oldCrewId,
        newCrewId: newCrewId ?? null,
        changedByUserId: req.user?.id ?? null,
        note: note ?? null,
      });
    }

    const refreshed = (await buildAssetList(resolveDeptId(req))).find((a) => a.slug === slug);
    res.json({ asset: refreshed });
  },
);

router.get(
  "/assets/:slug/assignment-history",
  requireAuth,
  requireFleetView(),
  async (req, res) => {
    const slug = String(req.params.slug ?? "");
    const allowedKinds = viewableKinds(req.user!);
    const assets = (await buildAssetList()).filter((a) => allowedKinds.has(a.kind));
    const asset = assets.find((a) => a.slug === slug);
    if (!asset) {
      res.status(404).json({ error: "not_found" });
      return;
    }

    const rawHistory = await db
      .select()
      .from(assetAssignmentLogTable)
      .where(
        and(
          eq(assetAssignmentLogTable.assetType, asset.kind),
          eq(assetAssignmentLogTable.assetId, asset.id),
        ),
      )
      .orderBy(desc(assetAssignmentLogTable.changedAt))
      .limit(100);

    // Resolve crew names + actor names in batched queries so the response
    // is self-contained.
    const crewIds = Array.from(
      new Set(
        [
          ...rawHistory.map((h) => h.oldCrewId),
          ...rawHistory.map((h) => h.newCrewId),
        ].filter((id): id is number => id != null),
      ),
    );
    const userIds = Array.from(
      new Set(
        rawHistory.map((h) => h.changedByUserId).filter((id): id is number => id != null),
      ),
    );
    const [crewNameRows, userNameRows] = await Promise.all([
      crewIds.length
        ? db
            .select({ id: crewsTable.id, name: crewsTable.name })
            .from(crewsTable)
            .where(inArray(crewsTable.id, crewIds))
        : Promise.resolve([]),
      userIds.length
        ? db
            .select({ id: usersTable.id, fullName: usersTable.fullName })
            .from(usersTable)
            .where(inArray(usersTable.id, userIds))
        : Promise.resolve([]),
    ]);
    const crewNameMap = new Map(crewNameRows.map((r) => [r.id, r.name]));
    const userNameMap = new Map(userNameRows.map((r) => [r.id, r.fullName]));

    const history = rawHistory.map((h) => ({
      id: h.id,
      changedAt: new Date(h.changedAt).toISOString(),
      oldCrewId: h.oldCrewId,
      oldCrewName: h.oldCrewId != null ? crewNameMap.get(h.oldCrewId) ?? null : null,
      newCrewId: h.newCrewId,
      newCrewName: h.newCrewId != null ? crewNameMap.get(h.newCrewId) ?? null : null,
      changedByUserId: h.changedByUserId,
      changedByName:
        h.changedByUserId != null ? userNameMap.get(h.changedByUserId) ?? null : null,
      note: h.note ?? null,
    }));
    res.json({ history });
  },
);

router.post(
  "/usage-readings",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const parsed = CreateUsageReadingBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const { mileage, hours, truckId, equipmentId, notes } = parsed.data;
    // Refinement: must target exactly one asset, with the matching usage field.
    const hasTruck = truckId != null;
    const hasEquip = equipmentId != null;
    if (hasTruck === hasEquip) {
      res
        .status(400)
        .json({ error: "must_target_exactly_one_asset" });
      return;
    }
    if (hasTruck && mileage == null) {
      res.status(400).json({ error: "trucks_require_mileage" });
      return;
    }
    if (hasEquip && hours == null) {
      res.status(400).json({ error: "equipment_requires_hours" });
      return;
    }
    // Verify non-admin callers can only record readings for their own dept's assets.
    if (!(await assertAssetInScope(req, res, { truckId, equipmentId }))) return;

    const userId = req.user?.id ?? null;
    const [row] = await db
      .insert(usageReadingsTable)
      .values({
        truckId: truckId ?? null,
        equipmentId: equipmentId ?? null,
        mileage: mileage ?? null,
        hours: hours ?? null,
        notes: notes ?? null,
        recordedByUserId: userId,
      })
      .returning();

    // Advance the asset's current usage if the reading is higher.
    if (truckId && mileage != null) {
      await db
        .update(trucksTable)
        .set({ currentMileage: mileage })
        .where(
          and(
            eq(trucksTable.id, truckId),
            sql`${trucksTable.currentMileage} < ${mileage}`,
          ),
        );
    }
    if (equipmentId && hours != null) {
      await db
        .update(equipmentTable)
        .set({ currentHours: hours })
        .where(
          and(
            eq(equipmentTable.id, equipmentId),
            sql`${equipmentTable.currentHours} < ${hours}`,
          ),
        );
    }

    res.status(201).json({ reading: row });
  },
);

// ---------- Usage reading corrections ----------
// Readings are append-only in the normal flow, but a fat-fingered
// odometer entry (e.g. 1,250,000 instead of 125,000) poisons the cached
// `currentMileage` / `currentHours` on the asset and every service-due
// calculation downstream. These two handlers let a fleet editor fix or
// remove a reading and then re-derive the cached usage from what's left.

const updateUsageReadingSchema = z
  .object({
    mileage: z.number().int().min(0).nullable().optional(),
    hours: z.number().int().min(0).nullable().optional(),
    recordedAt: z.coerce.date().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

async function assertUsageReadingInScope(
  req: import("express").Request,
  res: import("express").Response,
  readingId: number,
): Promise<{ id: number; truckId: number | null; equipmentId: number | null; mileage: number | null; hours: number | null } | null> {
  const [reading] = await db
    .select({
      id: usageReadingsTable.id,
      truckId: usageReadingsTable.truckId,
      equipmentId: usageReadingsTable.equipmentId,
      mileage: usageReadingsTable.mileage,
      hours: usageReadingsTable.hours,
    })
    .from(usageReadingsTable)
    .where(eq(usageReadingsTable.id, readingId));
  if (!reading) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  if (!(await assertAssetInScope(req, res, { truckId: reading.truckId, equipmentId: reading.equipmentId }))) {
    return null;
  }
  return reading;
}

router.patch(
  "/usage-readings/:id",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = updateUsageReadingSchema.safeParse(req.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const reading = await assertUsageReadingInScope(req, res, id);
    if (!reading) return;
    const isTruck = reading.truckId != null;
    // Keep the value on the side that matches the asset kind — a truck
    // reading carries mileage, equipment carries hours.
    if (isTruck && parsed.data.mileage === null) {
      res.status(400).json({ error: "trucks_require_mileage" });
      return;
    }
    if (!isTruck && parsed.data.hours === null) {
      res.status(400).json({ error: "equipment_requires_hours" });
      return;
    }
    const patch: Partial<typeof usageReadingsTable.$inferInsert> = {};
    if (isTruck && parsed.data.mileage !== undefined) patch.mileage = parsed.data.mileage;
    if (!isTruck && parsed.data.hours !== undefined) patch.hours = parsed.data.hours;
    if (parsed.data.recordedAt !== undefined) patch.recordedAt = parsed.data.recordedAt;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes || null;
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "no_fields_to_update" });
      return;
    }
    const [row] = await db
      .update(usageReadingsTable)
      .set(patch)
      .where(eq(usageReadingsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const previousValue = isTruck ? reading.mileage : reading.hours;
    const newValue = isTruck ? row.mileage : row.hours;
    if (newValue != null && previousValue !== newValue) {
      // Advance the cache if the corrected value is now the high-water
      // mark; otherwise re-derive from what's left.
      if (isTruck && reading.truckId != null) {
        await db
          .update(trucksTable)
          .set({ currentMileage: newValue })
          .where(and(eq(trucksTable.id, reading.truckId), sql`${trucksTable.currentMileage} < ${newValue}`));
      } else if (!isTruck && reading.equipmentId != null) {
        await db
          .update(equipmentTable)
          .set({ currentHours: newValue })
          .where(and(eq(equipmentTable.id, reading.equipmentId), sql`${equipmentTable.currentHours} < ${newValue}`));
      }
      await recomputeAssetUsage({
        truckId: reading.truckId,
        equipmentId: reading.equipmentId,
        previousValue,
      });
    }
    res.json({ reading: row });
  },
);

router.delete(
  "/usage-readings/:id",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const reading = await assertUsageReadingInScope(req, res, id);
    if (!reading) return;
    const value = reading.truckId != null ? reading.mileage : reading.hours;
    const unit = reading.truckId != null ? "mi" : "hrs";
    const outcome = await requestDelete({
      req,
      kind: "usage_reading",
      id,
      label: `Usage reading: ${value ?? "?"} ${unit}`,
      execute: async () => {
        const deleted = await db
          .delete(usageReadingsTable)
          .where(eq(usageReadingsTable.id, id))
          .returning({ id: usageReadingsTable.id });
        if (deleted.length > 0) {
          await recomputeAssetUsage({
            truckId: reading.truckId,
            equipmentId: reading.equipmentId,
            previousValue: value,
          });
        }
        return deleted.length > 0;
      },
    });
    sendDeleteOutcome(res, outcome);
  },
);

// ---------- Fleet Pulse ----------
router.get("/fleet-pulse", requireAuth, requireFleetView(), async (req, res) => {
  const allowedKinds = viewableKinds(req.user!);
  const assets = (await buildAssetList(resolveDeptId(req))).filter((a) => allowedKinds.has(a.kind));

  // Spec semantics:
  //   active        = status ACTIVE
  //   down          = RETIRED ("Out of Service")
  //   openRepairs   = IN_SHOP (currently being repaired)
  //   outOfService  = alias for down (kept for backward-compat consumers)
  const counts = {
    active: 0,
    down: 0,
    openRepairs: 0,
    inShop: 0,
    outOfService: 0,
    checkedOut: 0,
    withImage: 0,
    total: assets.length,
  };
  for (const a of assets) {
    if (a.status === "ACTIVE") counts.active++;
    else if (a.status === "IN_SHOP") {
      counts.inShop++;
      counts.openRepairs++;
    } else {
      counts.outOfService++;
      counts.down++;
    }
    if (a.currentHolderUserId != null) counts.checkedOut++;
    if (a.hasImage) counts.withImage++;
  }

  const overdue = assets
    .filter((a) => a.serviceState === "OVERDUE")
    .map(toPulseSummary);
  const dueSoon = assets
    .filter((a) => a.serviceState === "DUE_SOON")
    .map(toPulseSummary);
  // Top "money pits" rank by current-year spend (YTD), per spec.
  const topMoneyPits = assets
    .slice()
    .sort((a, b) => b.ytdSpendCents - a.ytdSpendCents)
    .slice(0, 5)
    .map(toPulseSummary);

  // Monthly spend for last 12 months — and a recent-maintenance feed.
  // Scope logs to the user's allowed asset kinds so financial aggregates
  // (totals, monthlySpend, recentMaintenance) never leak across permissions.
  const allTruckIds = new Set<number>();
  const allEquipIds = new Set<number>();
  for (const a of assets) {
    if (a.kind === "TRUCK") allTruckIds.add(a.id);
    else allEquipIds.add(a.id);
  }
  const allLogs = await db
    .select()
    .from(maintenanceLogsTable)
    .orderBy(desc(maintenanceLogsTable.performedAt));
  const logs = allLogs.filter((l) =>
    l.truckId
      ? allowedKinds.has("TRUCK") && allTruckIds.has(l.truckId)
      : l.equipmentId
        ? allowedKinds.has("EQUIPMENT") && allEquipIds.has(l.equipmentId)
        : false,
  );
  const assetBySlugIndex = new Map<string, AssetSummary>();
  for (const a of assets) {
    assetBySlugIndex.set(`${a.kind}-${a.id}`, a);
  }
  const recentMaintenance = logs
    .slice(0, 8)
    .map((log) => {
      const key = log.truckId
        ? `TRUCK-${log.truckId}`
        : log.equipmentId
          ? `EQUIPMENT-${log.equipmentId}`
          : null;
      const asset = key ? assetBySlugIndex.get(key) : undefined;
      return {
        id: log.id,
        kind: log.kind,
        description: log.description,
        performedAt: new Date(log.performedAt).toISOString(),
        costCents: log.costCents ?? 0,
        laborCostCents: log.laborCostCents ?? 0,
        partsCostCents: log.partsCostCents ?? 0,
        assetKind: (asset?.kind ?? "TRUCK") as "TRUCK" | "EQUIPMENT",
        assetSlug: asset?.slug ?? "",
        assetName: asset?.name ?? "Unknown asset",
      };
    })
    .filter((r) => r.assetSlug !== "");
  const monthMap = new Map<
    string,
    { totalCents: number; laborCents: number; partsCents: number }
  >();
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthMap.set(key, { totalCents: 0, laborCents: 0, partsCents: 0 });
  }
  let last30 = 0;
  let mtd = 0;
  let ytd = 0;
  let lifetime = 0;
  const since30 = Date.now() - 30 * 86_400_000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  for (const log of logs) {
    const d = new Date(log.performedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (monthMap.has(key)) {
      const cur = monthMap.get(key)!;
      cur.totalCents += log.costCents ?? 0;
      cur.laborCents += log.laborCostCents ?? 0;
      cur.partsCents += log.partsCostCents ?? 0;
    }
    const t = d.getTime();
    const c = log.costCents ?? 0;
    lifetime += c;
    if (t >= yearStart) ytd += c;
    if (t >= monthStart) mtd += c;
    if (t >= since30) last30 += c;
  }
  const monthlySpend = Array.from(monthMap.entries()).map(([month, v]) => ({
    month,
    ...v,
  }));

  // Per-year totals for the "Yearly" view in the UI. Includes the current
  // year + up to 4 prior years so the all-time chart isn't unbounded but
  // captures enough history to be useful.
  const yearMap = new Map<
    string,
    { totalCents: number; laborCents: number; partsCents: number }
  >();
  const currentYear = now.getFullYear();
  for (let y = currentYear - 4; y <= currentYear; y++) {
    yearMap.set(String(y), { totalCents: 0, laborCents: 0, partsCents: 0 });
  }
  for (const log of logs) {
    const yearKey = String(new Date(log.performedAt).getFullYear());
    if (yearMap.has(yearKey)) {
      const cur = yearMap.get(yearKey)!;
      cur.totalCents += log.costCents ?? 0;
      cur.laborCents += log.laborCostCents ?? 0;
      cur.partsCents += log.partsCostCents ?? 0;
    }
  }
  const yearlySpend = Array.from(yearMap.entries()).map(([year, v]) => ({
    year,
    ...v,
  }));

  res.json({
    counts,
    overdue,
    dueSoon,
    monthlySpend,
    yearlySpend,
    topMoneyPits,
    totals: {
      mtdCents: mtd,
      last30DaysCents: last30,
      ytdCents: ytd,
      lifetimeCents: lifetime,
    },
    recentMaintenance,
  });
});

function toPulseSummary(a: AssetSummary) {
  return {
    kind: a.kind,
    id: a.id,
    slug: a.slug,
    name: a.name,
    status: a.status,
    usageUntilDue: a.usageUntilDue,
    usageUnit: a.usageUnit,
    serviceState: a.serviceState,
    lifeToDateSpendCents: a.lifeToDateSpendCents,
    ytdSpendCents: a.ytdSpendCents,
    mtdSpendCents: a.mtdSpendCents,
    last30SpendCents: a.last30SpendCents,
    hasImage: a.hasImage,
    currentHolderName: a.currentHolderName,
    lastHolderName: a.lastHolderName,
  };
}

export default router;
