# Importing real customer fleet assets

This script replaces the demo trucks + equipment with the actual fleet data
transcribed from the insurance schedule (3 screenshots, ~50 vehicles) and
`asset-3.xlsx` (250 handheld equipment rows). Customers, jobs, quotes, and
invoices are **not** touched — only the fleet tables.

## One-time steps before running

1. **Set `DEMO_MODE=false`** in the environment that runs the API server.
   This stops `backfillFleetData()` from re-overlaying T-01/T-02/T-03
   demo trucks on every boot, and stops `backfillDemoData()` from
   inserting demo customers on a fresh DB.

   On Replit: open the **Secrets** tab and set `DEMO_MODE=false`.

2. **Push the schema** so the `asset_checkouts`, image-URL, and
   holder-pointer columns from the v2 fleet PR exist:
   ```
   pnpm --filter @workspace/db run push
   ```

## Run the import

```
DATABASE_URL=postgres://… pnpm --filter @workspace/db run import-real-assets
```

What it does, in order:
1. Looks up the `TreeService` and `Lawn` department ids (errors if either is
   missing — run `backfillDepartments` first if so).
2. `TRUNCATE … RESTART IDENTITY CASCADE` on every fleet table:
   `asset_checkouts`, `asset_assignment_log`, `asset_status_log`,
   `usage_readings`, `maintenance_logs`, `equipment_items`, `equipment`,
   `trucks`. *(Maintenance history is wiped — fleet is starting clean.)*
3. Inserts trucks + trailers from `data/trucks-import.json`
   (47 vehicles + 2 extras from the secondary schedule).
4. Inserts 11 heavy equipment rows (Dingos, CMC lift, Vermeer skid
   steer, Giant track loader) from `data/heavy-equipment-import.json`.
5. Inserts 250 handheld equipment rows from `data/equipment-import.json`.
   For each row, the holder name from the spreadsheet (e.g. "Wilber",
   "Melecio") is appended to the equipment name in square brackets so
   it's visible in the registry without a schema change. Once the team
   creates real user accounts, replace these labels with proper
   checkouts via the per-asset **Check out** UI.

Re-runnable: pass `--keep-existing` to skip the truncate step (useful for
appending one-off rows without losing maintenance logs).

## Fleet tags, plates & plate expirations

The official truck numbers ("JT-01" … "JT-37", "JTTT-50" … "JTTT-56",
"JTLJ-60", "JTLJ-61"), license plates, and plate-expiration months come
from three printed "Trucks NO Trailers" tag sheets and are **hard-coded in
`lib/db/src/fleetTags.ts`**. That file is the source of truth — edit it
there if a sheet changes.

They land in three nullable columns on `trucks`:

| column          | example   | notes                                        |
|-----------------|-----------|----------------------------------------------|
| `fleet_tag`     | `JT-01`   | shown as a badge in the registry + detail page |
| `plate`         | `16DDNV`  | existing column; was empty before the sheets  |
| `plate_expires` | `2026-12` | ISO year-month; sheet shows it as "26-Dec"    |

`applyFleetTags()` runs **on every API-server boot** (after the fleet
backfill) and is also available as:

```
DATABASE_URL=postgres://… pnpm --filter @workspace/db run apply-fleet-tags
```

Behaviour — idempotent and non-destructive:
- adds the two columns if missing (`ALTER TABLE … IF NOT EXISTS`);
- matches each sheet row to a truck **by VIN**;
- **fills only blank fields** — a tag/plate/expiration someone edited in
  the UI is never overwritten (clearing a field will get it re-filled on
  the next boot; change it to something else instead);
- inserts the trucks that are on the sheets but not in
  `trucks-import.json` (JT-07, JT-10, JTTT-51, JTTT-56; JT-11 / JT-17 are
  normally already created by `backfillFleet.ensureNewTrucks`);
- repairs JT-37's VIN, which was stored without its leading `1`.

Every 17-character VIN on the sheets was validated with the VIN
check-digit algorithm. Three rows needed judgment and are documented in
`vinNote` on the row:
- **JT-04** — sheet prints 18 chars (`…78EEA…`); the DB's 17-char VIN
  `1FTSX20Y78EA86153` is check-digit valid and is used.
- **JT-07** — sheet prints `1GCPSBEK951163595`; only `…9S1163595` passes
  the check digit, and `S` is the 2025 model-year code. Stored with `S`.
  **Confirm against the truck.**
- **JTTT-56** — sheet prints a 16-char VIN `3FTTW8AA8TR00222`. Stored as
  printed; one character is missing. **Confirm against the truck.**

Also noted but deliberately *not* changed (the sheets are only
authoritative for tag/plate/expiration): the sheet's model year differs
from the DB for JT-02 (2012 vs 2021), JT-21 (2012 vs 2020), JT-30 (2023
vs 2024), JT-35 (2023 vs 2024) and JTLJ-61 (2002 vs 2022, and F550 vs
F450). In every case except JTLJ-61 the VIN's year code agrees with the
DB; for JTLJ-61 it agrees with the sheet (2002). Edit in the UI if desired.

Rows skipped: JT-08 is blank on the sheet; JT-23 and JTTT-55 do not appear.

## Department assignment heuristics

Trucks are routed by brand/model:
- Smaller pickups + SUVs + cargo vans (Silverado, Tacoma, Colorado,
  Blazer, Expedition, Sierra, RAM 2500, F250, Econoline) → **Lawn**
- Everything else (heavy trucks, dump trucks, trailers) → **TreeService**

Equipment is routed by the spreadsheet "Site" column:
- `Tree Yard` → **TreeService**
- `Lawn Yard` → **Lawn**

Adjust individual rows in the admin UI after import — the heuristic is a
starting point, not a permanent assignment.

## Updating the source data

- `data/trucks-import.json` — hand-edit JSON. One row per vehicle. The
  `statedValueCents` field expects integer cents (e.g. `$40,000` → `4000000`).
- `data/heavy-equipment-import.json` — hand-edit JSON.
- `data/equipment-import.json` — regenerated from `asset-3.xlsx`. To
  re-import after the spreadsheet changes, re-run the Python conversion
  block in `lib/db/scripts/REGENERATE_HANDHELD_JSON.md` *(or paste the
  block in `seed.ts` history)*.
