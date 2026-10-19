/* eslint-disable no-console */
/**
 * Apply the hard-coded fleet tags / plates / plate-expiration months
 * (lib/db/src/fleetTags.ts) to the trucks table — without truncating or
 * re-importing anything.
 *
 *   DATABASE_URL=postgres://… pnpm --filter @workspace/db run apply-fleet-tags
 *
 * Idempotent and non-destructive: matches trucks by VIN, fills only the
 * fields that are currently blank, inserts the few sheet trucks missing
 * from the DB, and repairs one known-truncated VIN. The API server also
 * runs this on every boot, so this script is only needed to apply the
 * tags immediately (or to re-check) without a redeploy.
 *
 * Pass --no-insert to skip creating the missing trucks.
 */
import { applyFleetTags } from "../src/fleetTags";

async function main() {
  const insertMissing = !process.argv.includes("--no-insert");
  const result = await applyFleetTags({ insertMissing, log: console.log });
  console.log("\nDone.");
  console.log(
    `  tags filled: ${result.tagged}\n  plates filled: ${result.platesFilled}\n  expirations filled: ${result.expiresFilled}\n  VINs repaired: ${result.vinsRepaired}\n  trucks inserted: ${result.inserted}`,
  );
  if (result.unmatched.length) {
    console.log(`  unmatched (no truck with this VIN): ${result.unmatched.join(", ")}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
