import { eq, sql } from "drizzle-orm";
import {
  db,
  trucksTable,
  equipmentTable,
  usageReadingsTable,
  maintenanceLogsTable,
} from "@workspace/db";

/**
 * Re-derive the cached usage on an asset after a reading was corrected or
 * removed. The cache is "highest value ever observed", so we only need to
 * touch it when the reading we just changed *was* the one holding that
 * high-water mark. The new value is the max over remaining readings and
 * maintenance-log snapshots; if neither exists we leave the cache alone
 * (it may have been seeded directly on the asset and we have nothing
 * better to replace it with — the Edit Asset form can set it explicitly).
 */
export async function recomputeAssetUsage(opts: {
  truckId: number | null;
  equipmentId: number | null;
  previousValue: number | null;
}) {
  if (opts.truckId != null) {
    const [truck] = await db
      .select({ currentMileage: trucksTable.currentMileage })
      .from(trucksTable)
      .where(eq(trucksTable.id, opts.truckId));
    if (!truck) return;
    if (opts.previousValue == null || opts.previousValue < truck.currentMileage) return;
    const [agg] = await db
      .select({
        maxReading: sql<number | null>`max(${usageReadingsTable.mileage})`,
      })
      .from(usageReadingsTable)
      .where(eq(usageReadingsTable.truckId, opts.truckId));
    const [logAgg] = await db
      .select({
        maxLog: sql<number | null>`max(${maintenanceLogsTable.mileageAtService})`,
      })
      .from(maintenanceLogsTable)
      .where(eq(maintenanceLogsTable.truckId, opts.truckId));
    const candidates = [agg?.maxReading, logAgg?.maxLog].filter(
      (n): n is number => n != null,
    );
    if (candidates.length === 0) return;
    await db
      .update(trucksTable)
      .set({ currentMileage: Math.max(...candidates) })
      .where(eq(trucksTable.id, opts.truckId));
    return;
  }
  if (opts.equipmentId != null) {
    const [equip] = await db
      .select({ currentHours: equipmentTable.currentHours })
      .from(equipmentTable)
      .where(eq(equipmentTable.id, opts.equipmentId));
    if (!equip) return;
    if (opts.previousValue == null || opts.previousValue < equip.currentHours) return;
    const [agg] = await db
      .select({
        maxReading: sql<number | null>`max(${usageReadingsTable.hours})`,
      })
      .from(usageReadingsTable)
      .where(eq(usageReadingsTable.equipmentId, opts.equipmentId));
    const [logAgg] = await db
      .select({
        maxLog: sql<number | null>`max(${maintenanceLogsTable.hoursAtService})`,
      })
      .from(maintenanceLogsTable)
      .where(eq(maintenanceLogsTable.equipmentId, opts.equipmentId));
    const candidates = [agg?.maxReading, logAgg?.maxLog].filter(
      (n): n is number => n != null,
    );
    if (candidates.length === 0) return;
    await db
      .update(equipmentTable)
      .set({ currentHours: Math.max(...candidates) })
      .where(eq(equipmentTable.id, opts.equipmentId));
  }
}
