import { db } from "./client";
import { usersTable } from "./schema/users";
import { crewsTable } from "./schema/jobs";
import { customersTable } from "./schema/customers";
import { quotesTable } from "./schema/quotes";
import { assetCheckoutsTable } from "./schema/fleet";
import { inArray, eq, and } from "drizzle-orm";

const DEMO_EMAILS = [
  "sales1@joshuatreeinc.test",
  "sales2@joshuatreeinc.test",
  "lead1@joshuatreeinc.test",
  "lead2@joshuatreeinc.test",
  "lead3@joshuatreeinc.test",
  "mechanic@joshuatreeinc.test",
  "accounting@joshuatreeinc.test",
];

const ADMIN_EMAIL = "admin@joshuatreeinc.test";

/**
 * Idempotent. Removes all demo/test user accounts from the database.
 * Before deleting, reassigns any RESTRICT-FK-referenced rows to the
 * admin user, and deletes rows with CASCADE/RESTRICT FKs that cannot
 * be reassigned. Runs in a single transaction so it is all-or-nothing.
 * Throws if the admin user cannot be found.
 */
export async function cleanupDemoUsers(): Promise<void> {
  // Resolve the IDs we need before opening the transaction.
  const allUsers = await db
    .select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable);

  const admin = allUsers.find((u) => u.email === ADMIN_EMAIL);
  if (!admin) {
    throw new Error(
      `cleanupDemoUsers: admin user (${ADMIN_EMAIL}) not found — aborting`,
    );
  }

  const demoIds = allUsers
    .filter((u) => DEMO_EMAILS.includes(u.email ?? ""))
    .map((u) => u.id);

  if (demoIds.length === 0) {
    // Nothing to do — all demo accounts already gone.
    return;
  }

  await db.transaction(async (tx) => {
    // 1. Reassign crews whose lead is a demo user → admin.
    await tx
      .update(crewsTable)
      .set({ leadUserId: admin.id })
      .where(inArray(crewsTable.leadUserId, demoIds));

    // 2. Reassign customers owned by demo users → admin.
    await tx
      .update(customersTable)
      .set({ ownerUserId: admin.id })
      .where(inArray(customersTable.ownerUserId, demoIds));

    // 3. Reassign quotes owned by demo users → admin.
    await tx
      .update(quotesTable)
      .set({ ownerUserId: admin.id })
      .where(inArray(quotesTable.ownerUserId, demoIds));

    // 4. Delete asset checkouts that belong to demo users (RESTRICT FK —
    //    cannot reassign since the checkout record *is* the user action).
    await tx
      .delete(assetCheckoutsTable)
      .where(inArray(assetCheckoutsTable.userId, demoIds));

    // 5. Delete the demo users themselves.
    //    Remaining FKs are SET NULL or CASCADE so they resolve automatically.
    await tx
      .delete(usersTable)
      .where(inArray(usersTable.id, demoIds));
  });
}
