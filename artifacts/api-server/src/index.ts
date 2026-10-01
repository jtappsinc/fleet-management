import app from "./app";
import { logger } from "./lib/logger";
import { syncDefaultPermissionMatrix } from "./lib/rbac/syncMatrix";
import { sql } from "drizzle-orm";
import {
  db,
  seedIfEmpty,
  backfillFleetData,
  backfillDemoData,
  backfillDepartments,
  importRealCrews,
  cleanupDemoUsers,
  crewMembersTable,
} from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Run startup tasks that must complete before the server accepts requests.
// Auto-seed first (fail-fast on error), then sync the permissions matrix.
async function startup() {
  // Auto-seed demo data when the database is empty (production first boot).
  // Checks if the users table is empty; inserts all demo data if so.
  // Safe to call every restart — it is a no-op when data already exists.
  const seeded = await seedIfEmpty();
  if (seeded) {
    logger.info("Database was empty — seed data inserted on first boot.");
  }

  // Mirror the in-code default permission matrix into the DB so admins can
  // override it via the toggle panel without redeploys. Existing rows are
  // never overwritten; only missing (role, section) pairs are inserted.
  try {
    await syncDefaultPermissionMatrix();
  } catch (err) {
    logger.error({ err }, "Failed to sync default permission matrix on boot");
  }

  // Fleet backfill runs FIRST because its first step is the
  // idempotent ALTER TABLE that adds the maintenance_logs vendor /
  // category / notes / receipt_data_url columns. Subsequent steps
  // (and the accounting endpoint) read those columns via drizzle's
  // explicit column lists, so they MUST exist before any other code
  // queries the table.
  try {
    await backfillFleetData();
  } catch (err) {
    logger.error({ err }, "Failed to backfill fleet data on boot");
  }

  // Migrate any DB seeded against an older department layout to the
  // current 7-key canonical set, re-home orphaned assets, and (in
  // non-production) make sure every visible department has at least
  // one truck + equipment so the fleet dept-filter dropdown is
  // meaningful. Also enriches maintenance logs with vendor /
  // category / receipt — relies on the columns added by the fleet
  // backfill above.
  try {
    await backfillDepartments();
  } catch (err) {
    logger.error({ err }, "Failed to backfill departments on boot");
  }
  try {
    await backfillDemoData();
  } catch (err) {
    logger.error({ err }, "Failed to backfill demo data on boot");
  }

  // Import real Joshua Tree crews + equipment assignments from the
  // asset inventory spreadsheet. Idempotent — no-op once the data
  // is present. Runs after demo backfills so the demo-crew cleanup
  // step can remove any placeholders they inserted.
  try {
    await importRealCrews();
  } catch (err) {
    logger.error({ err }, "Failed to import real crews on boot");
  }

  // Remove any demo/test user accounts that may have been seeded
  // in a previous environment. Idempotent — no-op if they don't exist.
  // Runs last so it always wins over any backfill that re-inserts them.
  // Throws on failure (e.g. missing admin) so boot fails loudly.
  await cleanupDemoUsers();

  // Confirm crew-members table is clean (user-to-crew assignments).
  const [{ count: crewMemberCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crewMembersTable);
  logger.info(
    { crewMemberCount },
    "crew_members row count confirmed on boot",
  );
}

startup()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Startup failed — server will not start");
    process.exit(1);
  });
