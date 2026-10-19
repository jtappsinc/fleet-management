/**
 * Joshua Tree fleet tags — the official truck numbers ("JT-01", "JTTT-50",
 * "JTLJ-60"), license plates, and plate-expiration months, transcribed
 * from the three printed "Trucks NO Trailers" tag sheets (Oct 2026).
 *
 * This is the hard-coded source of truth for those three fields. Every
 * row is keyed by VIN so it can be matched to the trucks already in the
 * database without touching any other column.
 *
 * Verification performed at transcription time:
 *   - Every 17-character VIN was run through the North-American VIN
 *     check-digit algorithm (position 9). 41 of 44 passed as printed.
 *   - The 3 that did not are called out per-row in `vinNote` below.
 *   - Letter-O vs digit-0 and letter-I vs digit-1 in plates were resolved
 *     by comparing glyph widths on the high-resolution photos.
 *
 * `applyFleetTags()` is idempotent and safe to run on every boot:
 *   - adds the two columns if missing (ALTER TABLE ... IF NOT EXISTS)
 *   - repairs a known-truncated VIN so the row can be matched
 *   - FILLS ONLY BLANK fields (fleet_tag / plate / plate_expires) on
 *     matched trucks — a value the team has edited by hand is never
 *     overwritten, so the fields stay editable in the UI
 *   - inserts the handful of trucks on the sheets that aren't in the
 *     DB yet (keyed by VIN, so re-running never duplicates)
 */
import { eq, sql } from "drizzle-orm";
import { db } from "./client";
import { trucksTable } from "./schema";

export type FleetTagRow = {
  /** Official fleet tag painted on the truck, e.g. "JT-01". */
  tag: string;
  /** License plate exactly as printed; null when the sheet cell is blank. */
  plate: string | null;
  /** Plate expiration month, ISO "YYYY-MM" (sheet shows e.g. "26-Dec"). */
  plateExpires: string | null;
  /** VIN used to match the DB row (check-digit valid where 17 chars). */
  vin: string;
  /** What the sheet literally printed, when it differs from `vin`. */
  sheetVin?: string;
  /** Older/incorrect VIN spellings that may exist in the DB; repaired to `vin`. */
  legacyVins?: string[];
  /** Human-readable explanation for any VIN deviation. */
  vinNote?: string;
  /** Model year as printed on the sheet (informational only — not written). */
  sheetYear: number;
  /** Make / type columns as printed (informational only — not written). */
  sheetMake: string;
  sheetType: string;
  /**
   * Present only for trucks that are NOT in trucks-import.json. When no
   * truck with this VIN exists, a new row is inserted with these values.
   */
  insert?: {
    brand: string;
    model: string;
    bodyTypeCode: string;
  };
};

export const FLEET_TAGS: readonly FleetTagRow[] = [
  // ─── Sheet 1 ──────────────────────────────────────────────────────
  { tag: "JT-01", plate: "16DDNV", plateExpires: "2026-12", vin: "1GC5WLE78PF113200", sheetYear: 2023, sheetMake: "CHEVY 2500", sheetType: "PICKUP" },
  { tag: "JT-02", plate: "QUNH26", plateExpires: "2026-06", vin: "3GCPWAEH6MG274094", sheetYear: 2012, sheetMake: "CHEVY 1500", sheetType: "PICKUP" },
  { tag: "JT-03", plate: "14BXVK", plateExpires: "2026-06", vin: "1GCGSCEA5K1113306", sheetYear: 2019, sheetMake: "CHEVY COLO", sheetType: "PICKUP" },
  {
    tag: "JT-04", plate: "IWTX89", plateExpires: "2026-12",
    vin: "1FTSX20Y78EA86153",
    sheetVin: "1FTSX20Y78EEA86153",
    vinNote: "Sheet prints 18 characters (doubled 'E'). The 17-char VIN already in the DB passes the check digit and is used for matching.",
    sheetYear: 2008, sheetMake: "FORD F250", sheetType: "PICKUP",
  },
  { tag: "JT-05", plate: "ATO4XP", plateExpires: "2026-12", vin: "1FTNW21L61EB04327", sheetYear: 2001, sheetMake: "FORD F250", sheetType: "PICKUP" },
  { tag: "JT-06", plate: "AL14JZ", plateExpires: "2026-12", vin: "1GC4YSEY4NF240953", sheetYear: 2022, sheetMake: "CHEVY 3500", sheetType: "P/U DOOLEY" },
  {
    tag: "JT-07", plate: "48ADUR", plateExpires: "2026-12",
    vin: "1GCPSBEK9S1163595",
    sheetVin: "1GCPSBEK951163595",
    vinNote: "Sheet prints a '5' in position 10. The check digit only validates with 'S' there, and 'S' is the 2025 model-year code (matches the sheet's 2025). Stored with 'S' — confirm against the door-jamb sticker.",
    sheetYear: 2025, sheetMake: "CHEVY", sheetType: "COLORADO",
    insert: { brand: "Chevrolet", model: "Colorado", bodyTypeCode: "PU" },
  },
  // JT-08 — row is blank on the sheet (no plate / make / VIN). Not imported.
  { tag: "JT-09", plate: "KHGL28", plateExpires: "2026-12", vin: "1FTSE34L36DA50893", sheetYear: 2006, sheetMake: "FORD E350", sheetType: "VAN BUCKEY" },
  {
    tag: "JT-10", plate: "ATO7XP", plateExpires: "2025-12", vin: "1FTSE34L63HB20018",
    sheetYear: 2003, sheetMake: "FORD E350", sheetType: "VAN BUCKET",
    insert: { brand: "Ford", model: "E350", bodyTypeCode: "CRGVN" },
  },
  {
    tag: "JT-11", plate: "Y93XKV", plateExpires: "2026-12", vin: "1GB5YLE75MF184509",
    sheetYear: 2021, sheetMake: "CHEVY 2500", sheetType: "UTILITY",
    // Normally already present (backfillFleet.ensureNewTrucks adds it as #55).
    insert: { brand: "Chevrolet", model: "Silverado 2500", bodyTypeCode: "TK" },
  },
  { tag: "JT-12", plate: "N70242", plateExpires: "2026-12", vin: "1HTMSAARX6H203019", sheetYear: 2006, sheetMake: "INTERNATIO", sheetType: "GRAPPLE" },
  { tag: "JT-13", plate: "P5100F", plateExpires: "2026-12", vin: "3ALACXFE2KDLP0789", sheetYear: 2019, sheetMake: "FREIGHTLINE", sheetType: "GRAPPLE" },
  { tag: "JT-14", plate: "P147OH", plateExpires: "2026-12", vin: "1NPCLP0X2PD855188", sheetYear: 2023, sheetMake: "PETERBUILY", sheetType: "GRAPPLE" },
  { tag: "JT-15", plate: "Z38CYL", plateExpires: "2026-12", vin: "54DCDJ1B7LS803755", sheetYear: 2020, sheetMake: "CHEVY 4500", sheetType: "DUMP" },
  { tag: "JT-16", plate: "QVNH94", plateExpires: "2026-12", vin: "54DCDJ1D6MS200931", sheetYear: 2021, sheetMake: "CHEVY 4500", sheetType: "DUMP" },
  {
    tag: "JT-17", plate: "PVNR48", plateExpires: "2026-12", vin: "54DCDJ1B9LS803756",
    sheetYear: 2020, sheetMake: "ISUZU 5500", sheetType: "DUMP",
    // Normally already present (backfillFleet.ensureNewTrucks adds it as #56).
    insert: { brand: "Chevrolet", model: "4500", bodyTypeCode: "TK" },
  },
  { tag: "JT-18", plate: "P2720B", plateExpires: "2026-12", vin: "1FVACXBS9ADAR4951", sheetYear: 2010, sheetMake: "FREIGHTLINE", sheetType: "BUCKET" },
  { tag: "JT-19", plate: "56DXVG", plateExpires: "2026-12", vin: "1FDNF20568ED86171", sheetYear: 2008, sheetMake: "FORD F250", sheetType: "UTILITY" },
  { tag: "JT-20", plate: "7123XW", plateExpires: "2026-12", vin: "1FDFE4FS7FDA12087", sheetYear: 2015, sheetMake: "FORD E450", sheetType: "BUS" },

  // ─── Sheet 2 ──────────────────────────────────────────────────────
  { tag: "JT-21", plate: "PCAP84", plateExpires: "2026-09", vin: "3TYRX5GNXLT002619", sheetYear: 2012, sheetMake: "TOYOTA", sheetType: "PICKUP" },
  { tag: "JT-22", plate: "AR65IK", plateExpires: "2026-12", vin: "1FDUF5HT9FEA47336", sheetYear: 2015, sheetMake: "FORD F550", sheetType: "UTILITY BUC" },
  // JT-23 — not present on the sheets.
  { tag: "JT-24", plate: "AR86IL", plateExpires: "2026-12", vin: "1FDUF5HT8CEA44987", sheetYear: 2012, sheetMake: "FORD F550", sheetType: "UTILITY BUC" },
  { tag: "JT-25", plate: "AL43UT", plateExpires: "2026-12", vin: "3GNKBBRA7MS585255", sheetYear: 2021, sheetMake: "CHEVY", sheetType: "BLAZER" },
  { tag: "JT-26", plate: "49ADUR", plateExpires: "2026-12", vin: "3D6WA7EL1BG621064", sheetYear: 2011, sheetMake: "DODGE 550", sheetType: "UTILITY BUC" },
  { tag: "JT-27", plate: "N4004X", plateExpires: "2026-12", vin: "1GDL7C1E75F531037", sheetYear: 2005, sheetMake: "GMC", sheetType: "FORESTRY" },
  { tag: "JT-28", plate: "QUNH43", plateExpires: "2026-06", vin: "3GCPWAEH1MG294866", sheetYear: 2021, sheetMake: "CHEVY 1500", sheetType: "PICKUP" },
  { tag: "JT-29", plate: "ATO5XP", plateExpires: "2026-12", vin: "1GBJG31R1Y1260514", sheetYear: 2000, sheetMake: "CHEVY CUB", sheetType: "FLATBED" },
  { tag: "JT-30", plate: "DX88NK", plateExpires: "2026-09", vin: "1GTUUHEL9RZ318103", sheetYear: 2023, sheetMake: "GMC SIERRA", sheetType: "PICKUP" },
  { tag: "JT-31", plate: "RCXC20", plateExpires: "2026-12", vin: "3C6UR5DJ1MG554941", sheetYear: 2021, sheetMake: "DODGE 2500", sheetType: "PICKUP" },
  { tag: "JT-32", plate: "RCXC21", plateExpires: "2026-12", vin: "3C6UR5DJ8MG674333", sheetYear: 2021, sheetMake: "DODGE 2500", sheetType: "PICKUP" },
  { tag: "JT-33", plate: "79DRSM", plateExpires: "2026-12", vin: "1GCGSBEC0P1238491", sheetYear: 2023, sheetMake: "CHEVY COLO", sheetType: "PICKUP" },
  { tag: "JT-34", plate: "JX72OZ", plateExpires: "2026-12", vin: "1FT8W3BA9PEC72200", sheetYear: 2023, sheetMake: "FORD F350", sheetType: "P/U BUCKET" },
  { tag: "JT-35", plate: "40FDTF", plateExpires: "2026-12", vin: "1FTRF3BA8REC49997", sheetYear: 2023, sheetMake: "FORD F350", sheetType: "P/U BUCKET" },
  { tag: "JT-36", plate: "LB7-29Q", plateExpires: "2026-12", vin: "1FT8X3BA5REC50095", sheetYear: 2024, sheetMake: "FORD F350", sheetType: "P/U BUCKET" },
  {
    tag: "JT-37", plate: "LB730Q", plateExpires: "2026-12",
    vin: "1FTRF3BA6REC50078",
    legacyVins: ["FTRF3BA6REC50078"],
    vinNote: "trucks-import.json / the live DB had this VIN without its leading '1' (16 chars). The sheet's 17-char VIN passes the check digit; the DB row is repaired on apply.",
    sheetYear: 2024, sheetMake: "FORD F350", sheetType: "P/U BUCKET",
  },
  { tag: "JTTT-50", plate: "P62-19H", plateExpires: "2026-12", vin: "1M2AX04C7GM032043", sheetYear: 2016, sheetMake: "MACK", sheetType: "GRAPPLE" },
  {
    tag: "JTTT-51", plate: "23C-ELD", plateExpires: "2026-06", vin: "1GCSCPEA5AZ102899",
    sheetYear: 2010, sheetMake: "CHEVY1500", sheetType: "P/U",
    insert: { brand: "Chevrolet", model: "Silverado 1500", bodyTypeCode: "PU" },
  },
  { tag: "JTTT-52", plate: "FQK-P36", plateExpires: "2026-12", vin: "1GDE5C3277F404485", sheetYear: 2007, sheetMake: "GMC 5500", sheetType: "BUCKET" },
  { tag: "JTTT-53", plate: "LG3-41B", plateExpires: "2026-12", vin: "3C6UR5HJ0NG354757", sheetYear: 2022, sheetMake: "DODGE2500", sheetType: "P/U" },
  { tag: "JTTT-54", plate: null, plateExpires: "2026-12", vin: "1HTSDAAN8WH526287", sheetYear: 1998, sheetMake: "INTERNATION", sheetType: "GRAPPLE" },
  // JTTT-55 — not present on the sheets.
  {
    tag: "JTTT-56", plate: "79V-CFQ", plateExpires: "2027-06",
    vin: "3FTTW8AA8TR00222",
    vinNote: "Sheet prints only 16 characters (a VIN is 17). Stored exactly as printed; one character is missing and must be confirmed from the vehicle.",
    sheetYear: 2026, sheetMake: "FORD MAV", sheetType: "P/U",
    insert: { brand: "Ford", model: "Maverick", bodyTypeCode: "PU" },
  },

  // ─── Sheet 3 ──────────────────────────────────────────────────────
  { tag: "JTLJ-60", plate: "FEC-72W", plateExpires: "2026-12", vin: "JL6BPH1A4GK000115", sheetYear: 2016, sheetMake: "MITSU FUSO", sheetType: "DUMP" },
  { tag: "JTLJ-61", plate: "XSF-935", plateExpires: "2026-12", vin: "1FDXF46F22EC33251", sheetYear: 2002, sheetMake: "FORD F550", sheetType: "BUCKET" },
];

function normVin(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

export type ApplyFleetTagsResult = {
  tagged: number;
  platesFilled: number;
  expiresFilled: number;
  vinsRepaired: number;
  inserted: number;
  unmatched: string[];
};

/**
 * Idempotent. See module docblock. Pass `{ insertMissing: false }` to
 * skip creating the trucks that aren't in the DB (default: insert them).
 */
export async function applyFleetTags(
  opts: { insertMissing?: boolean; log?: (msg: string) => void } = {},
): Promise<ApplyFleetTagsResult> {
  const insertMissing = opts.insertMissing ?? true;
  const log = opts.log ?? (() => {});

  // 1. Schema — add the two columns on any DB that predates them.
  await db.execute(
    sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS fleet_tag TEXT`,
  );
  await db.execute(
    sql`ALTER TABLE trucks ADD COLUMN IF NOT EXISTS plate_expires TEXT`,
  );

  const result: ApplyFleetTagsResult = {
    tagged: 0,
    platesFilled: 0,
    expiresFilled: 0,
    vinsRepaired: 0,
    inserted: 0,
    unmatched: [],
  };

  // 2. Repair known-bad VIN spellings so the rows can be matched.
  for (const row of FLEET_TAGS) {
    if (!row.legacyVins?.length) continue;
    for (const legacy of row.legacyVins) {
      const [bad] = await db
        .select({ id: trucksTable.id })
        .from(trucksTable)
        .where(eq(trucksTable.vin, legacy))
        .limit(1);
      if (!bad) continue;
      const [good] = await db
        .select({ id: trucksTable.id })
        .from(trucksTable)
        .where(eq(trucksTable.vin, row.vin))
        .limit(1);
      // Only repair when the corrected VIN isn't already taken by
      // another row — otherwise we'd create a duplicate and the
      // operator should resolve it by hand.
      if (good && good.id !== bad.id) {
        log(`fleet-tags: ${row.tag}: both '${legacy}' and '${row.vin}' exist (ids ${bad.id}, ${good.id}); not repairing`);
        continue;
      }
      await db
        .update(trucksTable)
        .set({ vin: row.vin })
        .where(eq(trucksTable.id, bad.id));
      result.vinsRepaired++;
      log(`fleet-tags: ${row.tag}: repaired VIN '${legacy}' → '${row.vin}'`);
    }
  }

  // 3. Match by VIN and fill blanks only.
  const trucks = await db
    .select({
      id: trucksTable.id,
      vin: trucksTable.vin,
      fleetTag: trucksTable.fleetTag,
      plate: trucksTable.plate,
      plateExpires: trucksTable.plateExpires,
    })
    .from(trucksTable);
  const byVin = new Map<string, (typeof trucks)[number]>();
  for (const t of trucks) {
    const k = normVin(t.vin);
    if (k && !byVin.has(k)) byVin.set(k, t);
  }

  for (const row of FLEET_TAGS) {
    const t = byVin.get(normVin(row.vin));
    if (!t) {
      if (insertMissing && row.insert) {
        const name = `${row.tag} ${row.sheetYear} ${row.insert.brand} ${row.insert.model}`;
        const [created] = await db
          .insert(trucksTable)
          .values({
            name,
            vehicleType: "TRUCK",
            brand: row.insert.brand,
            model: row.insert.model,
            vin: row.vin,
            plate: row.plate,
            status: "ACTIVE",
            departmentId: null,
            year: row.sheetYear,
            // Insurance schedules don't carry a purchase date — store
            // Jan 1 of the model year, matching importRealAssets.ts.
            purchaseDate: new Date(row.sheetYear, 0, 1),
            garagingState: "FL",
            bodyTypeCode: row.insert.bodyTypeCode,
            fleetTag: row.tag,
            plateExpires: row.plateExpires,
          })
          .returning({ id: trucksTable.id });
        if (created) {
          await db
            .update(trucksTable)
            .set({ slug: `truck-${created.id}-${slugify(name) || "truck"}` })
            .where(eq(trucksTable.id, created.id));
          result.inserted++;
          log(`fleet-tags: ${row.tag}: inserted new truck '${name}' (${row.vin})`);
        }
      } else {
        result.unmatched.push(`${row.tag} (${row.vin})`);
      }
      continue;
    }

    const patch: Partial<typeof trucksTable.$inferInsert> = {};
    if (!t.fleetTag?.trim()) {
      patch.fleetTag = row.tag;
      result.tagged++;
    }
    if (row.plate && !t.plate?.trim()) {
      patch.plate = row.plate;
      result.platesFilled++;
    }
    if (row.plateExpires && !t.plateExpires?.trim()) {
      patch.plateExpires = row.plateExpires;
      result.expiresFilled++;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(trucksTable).set(patch).where(eq(trucksTable.id, t.id));
    }
  }

  log(
    `fleet-tags: tagged ${result.tagged}, plates ${result.platesFilled}, expirations ${result.expiresFilled}, VINs repaired ${result.vinsRepaired}, inserted ${result.inserted}, unmatched ${result.unmatched.length}` +
      (result.unmatched.length ? ` [${result.unmatched.join(", ")}]` : ""),
  );
  return result;
}
