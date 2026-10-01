import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import {
  db,
  deleteRequestsTable,
  usersTable,
  customersTable,
  jobsTable,
  quotesTable,
  invoicesTable,
  trucksTable,
  equipmentTable,
  equipmentItemsTable,
  maintenanceLogsTable,
  usageReadingsTable,
  crewsTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { recomputeAssetUsage } from "../lib/assetUsage";

const router: IRouter = Router();

/**
 * Admin-facing API for the "you tried to delete a lot of things,
 * the admin should probably look at this" approval queue. Every
 * non-admin DELETE in the console goes through the deleteGuard;
 * once a user trips the 3-per-hour cap, subsequent deletes land
 * here as PENDING rows that an admin can approve or deny.
 *
 * All endpoints are ADMIN-only. The cap check itself lives in
 * lib/deleteGuard.ts.
 */

function requireAdmin(req: import("express").Request, res: import("express").Response): boolean {
  if (req.user?.role !== "ADMIN") {
    res.status(403).json({ error: "forbidden" });
    return false;
  }
  return true;
}

function publicShape(row: {
  invite: typeof deleteRequestsTable.$inferSelect;
  requestedByName?: string | null;
  requestedByEmail?: string | null;
  decidedByName?: string | null;
}) {
  return {
    id: row.invite.id,
    requestedByUserId: row.invite.requestedByUserId,
    requestedByName: row.requestedByName ?? null,
    requestedByEmail: row.requestedByEmail ?? null,
    resourceKind: row.invite.resourceKind,
    resourceId: row.invite.resourceId,
    resourceLabel: row.invite.resourceLabel ?? null,
    reason: row.invite.reason ?? null,
    status: row.invite.status,
    createdAt: row.invite.createdAt.toISOString(),
    decidedAt: row.invite.decidedAt
      ? row.invite.decidedAt.toISOString()
      : null,
    decidedByUserId: row.invite.decidedByUserId,
    decidedByName: row.decidedByName ?? null,
  };
}

router.get("/delete-requests", requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const requester = db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      email: usersTable.email,
    })
    .from(usersTable)
    .as("requester");
  const decider = db
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .as("decider");
  const rows = await db
    .select({
      row: deleteRequestsTable,
      requestedByName: requester.fullName,
      requestedByEmail: requester.email,
      decidedByName: decider.fullName,
    })
    .from(deleteRequestsTable)
    .leftJoin(requester, eq(deleteRequestsTable.requestedByUserId, requester.id))
    .leftJoin(decider, eq(deleteRequestsTable.decidedByUserId, decider.id))
    .orderBy(desc(deleteRequestsTable.createdAt))
    .limit(200);

  res.json({
    requests: rows.map((r) =>
      publicShape({
        invite: r.row,
        requestedByName: r.requestedByName,
        requestedByEmail: r.requestedByEmail,
        decidedByName: r.decidedByName,
      }),
    ),
  });
});

router.get("/delete-requests/pending-count", requireAuth, async (req, res) => {
  // ADMIN only; lighter endpoint just for the sidebar badge so we
  // don't ship the whole list payload on every nav render.
  if (req.user?.role !== "ADMIN") {
    res.json({ count: 0 });
    return;
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deleteRequestsTable)
    .where(eq(deleteRequestsTable.status, "PENDING"));
  res.json({ count: row?.n ?? 0 });
});

/**
 * Execute the actual delete for an approved request. Mirrors the
 * `execute()` callback that each DELETE handler passes to
 * `requestDelete()`. We don't share that closure across the
 * request/approval boundary, so this is a thin switch on
 * resourceKind.
 *
 * Returns true when a row was deleted; false when the underlying
 * row had already vanished. In the latter case we still flip the
 * request to APPROVED — the resource ended up gone, which is what
 * the admin asked for.
 */
async function executeApprovedDelete(
  kind: string,
  id: number,
): Promise<boolean> {
  switch (kind) {
    case "customer":
      return (
        (
          await db
            .delete(customersTable)
            .where(eq(customersTable.id, id))
            .returning({ id: customersTable.id })
        ).length > 0
      );
    case "job":
      return (
        (
          await db
            .delete(jobsTable)
            .where(eq(jobsTable.id, id))
            .returning({ id: jobsTable.id })
        ).length > 0
      );
    case "quote":
      return (
        (
          await db
            .delete(quotesTable)
            .where(eq(quotesTable.id, id))
            .returning({ id: quotesTable.id })
        ).length > 0
      );
    case "invoice":
      return (
        (
          await db
            .delete(invoicesTable)
            .where(eq(invoicesTable.id, id))
            .returning({ id: invoicesTable.id })
        ).length > 0
      );
    case "truck":
      return (
        (
          await db
            .delete(trucksTable)
            .where(eq(trucksTable.id, id))
            .returning({ id: trucksTable.id })
        ).length > 0
      );
    case "equipment":
      return (
        (
          await db
            .delete(equipmentTable)
            .where(eq(equipmentTable.id, id))
            .returning({ id: equipmentTable.id })
        ).length > 0
      );
    case "equipment_item":
      return (
        (
          await db
            .delete(equipmentItemsTable)
            .where(eq(equipmentItemsTable.id, id))
            .returning({ id: equipmentItemsTable.id })
        ).length > 0
      );
    case "maintenance_log":
      return (
        (
          await db
            .delete(maintenanceLogsTable)
            .where(eq(maintenanceLogsTable.id, id))
            .returning({ id: maintenanceLogsTable.id })
        ).length > 0
      );
    case "usage_reading": {
      // Capture the reading before deleting so the asset's cached
      // odometer / hour-meter can be re-derived (see lib/assetUsage).
      const [reading] = await db
        .select({
          truckId: usageReadingsTable.truckId,
          equipmentId: usageReadingsTable.equipmentId,
          mileage: usageReadingsTable.mileage,
          hours: usageReadingsTable.hours,
        })
        .from(usageReadingsTable)
        .where(eq(usageReadingsTable.id, id));
      if (!reading) return false;
      const deleted = await db
        .delete(usageReadingsTable)
        .where(eq(usageReadingsTable.id, id))
        .returning({ id: usageReadingsTable.id });
      if (deleted.length > 0) {
        await recomputeAssetUsage({
          truckId: reading.truckId,
          equipmentId: reading.equipmentId,
          previousValue: reading.truckId != null ? reading.mileage : reading.hours,
        });
      }
      return deleted.length > 0;
    }
    case "crew":
      return (
        (
          await db
            .delete(crewsTable)
            .where(eq(crewsTable.id, id))
            .returning({ id: crewsTable.id })
        ).length > 0
      );
    default:
      logger.warn({ kind, id }, "executeApprovedDelete: unknown kind");
      return false;
  }
}

router.post("/delete-requests/:id/approve", requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  // Guarded by `status = PENDING` so an admin can't double-approve
  // and accidentally run the delete twice.
  const [row] = await db
    .select()
    .from(deleteRequestsTable)
    .where(eq(deleteRequestsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (row.status !== "PENDING") {
    res.status(409).json({
      error: "not_pending",
      currentStatus: row.status,
    });
    return;
  }

  try {
    await executeApprovedDelete(row.resourceKind, row.resourceId);
  } catch (err) {
    logger.error({ err, row }, "executeApprovedDelete threw");
    res.status(500).json({ error: "execute_failed" });
    return;
  }

  const claim = await db
    .update(deleteRequestsTable)
    .set({
      status: "APPROVED",
      decidedAt: new Date(),
      decidedByUserId: req.user!.id,
    })
    .where(
      and(
        eq(deleteRequestsTable.id, id),
        eq(deleteRequestsTable.status, "PENDING"),
      ),
    )
    .returning({ id: deleteRequestsTable.id });
  if (claim.length === 0) {
    res.status(409).json({ error: "race_lost" });
    return;
  }
  res.json({ ok: true });
});

router.post("/delete-requests/:id/deny", requireAuth, async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }
  const claim = await db
    .update(deleteRequestsTable)
    .set({
      status: "DENIED",
      decidedAt: new Date(),
      decidedByUserId: req.user!.id,
    })
    .where(
      and(
        eq(deleteRequestsTable.id, id),
        eq(deleteRequestsTable.status, "PENDING"),
      ),
    )
    .returning({ id: deleteRequestsTable.id });
  if (claim.length === 0) {
    res.status(404).json({ error: "not_found_or_not_pending" });
    return;
  }
  res.json({ ok: true });
});

export default router;
