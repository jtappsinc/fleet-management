import { Router, type IRouter } from "express";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, shopSuppliesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSection } from "../middlewares/requireSection";
import { requestDelete, sendDeleteOutcome } from "../lib/deleteGuard";

/**
 * Shop supplies — consumables inventory with unit prices.
 *
 * Permission-wise this is part of the shop, so it reuses the
 * `fleet.maintenance` section: anyone who can view maintenance can see
 * supplies; anyone who can edit maintenance can add / adjust / delete
 * them. No new permission key, so the Permissions page is unchanged.
 */
const router: IRouter = Router();

const writeSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: z.string().trim().max(60).nullable().optional(),
    sku: z.string().trim().max(80).nullable().optional(),
    vendor: z.string().trim().max(120).nullable().optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    quantityOnHand: z.number().int().min(0).optional(),
    reorderLevel: z.number().int().min(0).nullable().optional(),
    unitPriceCents: z.number().int().min(0).optional(),
    lastPurchasedAt: z.string().datetime({ offset: true }).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

// PATCH accepts any subset of the create fields.
const patchSchema = writeSchema.partial().strict();

function emptyToNull(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return v.length === 0 ? null : v;
}

function toValues(d: z.infer<typeof patchSchema>) {
  const out: Partial<typeof shopSuppliesTable.$inferInsert> = {};
  if (d.name !== undefined) out.name = d.name;
  if (d.category !== undefined) out.category = emptyToNull(d.category) ?? null;
  if (d.sku !== undefined) out.sku = emptyToNull(d.sku) ?? null;
  if (d.vendor !== undefined) out.vendor = emptyToNull(d.vendor) ?? null;
  if (d.unit !== undefined) out.unit = d.unit;
  if (d.quantityOnHand !== undefined) out.quantityOnHand = d.quantityOnHand;
  if (d.reorderLevel !== undefined) out.reorderLevel = d.reorderLevel;
  if (d.unitPriceCents !== undefined) out.unitPriceCents = d.unitPriceCents;
  if (d.lastPurchasedAt !== undefined)
    out.lastPurchasedAt = d.lastPurchasedAt ? new Date(d.lastPurchasedAt) : null;
  if (d.notes !== undefined) out.notes = emptyToNull(d.notes) ?? null;
  return out;
}

router.get(
  "/shop-supplies",
  requireAuth,
  requireSection("fleet.maintenance", "view"),
  async (_req, res) => {
    const rows = await db
      .select()
      .from(shopSuppliesTable)
      .orderBy(asc(shopSuppliesTable.name))
      .limit(2000);
    res.json({ supplies: rows });
  },
);

router.post(
  "/shop-supplies",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const parsed = writeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
      return;
    }
    const [row] = await db
      .insert(shopSuppliesTable)
      .values({
        unit: "each",
        quantityOnHand: 0,
        unitPriceCents: 0,
        ...toValues(parsed.data),
        name: parsed.data.name,
      })
      .returning();
    if (!row) {
      res.status(500).json({ error: "insert_failed" });
      return;
    }
    res.status(201).json({ supply: row });
  },
);

router.patch(
  "/shop-supplies/:id",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
      return;
    }
    const values = toValues(parsed.data);
    if (Object.keys(values).length === 0) {
      res.status(400).json({ error: "no_fields_to_update" });
      return;
    }
    const [row] = await db
      .update(shopSuppliesTable)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(shopSuppliesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({ supply: row });
  },
);

router.delete(
  "/shop-supplies/:id",
  requireAuth,
  requireSection("fleet.maintenance", "edit"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid_id" });
      return;
    }
    const [existing] = await db
      .select({ name: shopSuppliesTable.name })
      .from(shopSuppliesTable)
      .where(eq(shopSuppliesTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // Same approval flow as every other delete in the console.
    const outcome = await requestDelete({
      req,
      kind: "shop_supply",
      id,
      label: `Shop supply: ${existing.name}`,
      execute: async () => {
        const deleted = await db
          .delete(shopSuppliesTable)
          .where(eq(shopSuppliesTable.id, id))
          .returning({ id: shopSuppliesTable.id });
        return deleted.length > 0;
      },
    });
    sendDeleteOutcome(res, outcome);
  },
);

export default router;
