import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable, departmentsTable } from "./users";
import { crewsTable } from "./jobs";

// NOTE on status enums: the underlying Postgres enum keeps the legacy
// "RETIRED" value for backwards compatibility. The UI renames it to
// "Out of Service" — there is no separate OUT_OF_SERVICE value in the DB.
export const truckStatusEnum = pgEnum("truck_status", [
  "ACTIVE",
  "IN_SHOP",
  "RETIRED",
]);

export const equipmentStatusEnum = pgEnum("equipment_status", [
  "ACTIVE",
  "IN_SHOP",
  "RETIRED",
]);

export const maintenanceKindEnum = pgEnum("maintenance_kind", [
  "SCHEDULED",
  "REPAIR",
  "INSPECTION",
]);

// Trucks and trailers share the same physical-asset shape (VIN, plate,
// make/model, departmental ownership). The `vehicle_type` discriminator
// lets the registry surface them as separate top-level categories while
// keeping a single insert/update code path. Trailers inherit the mileage
// columns but the UI hides them — trailers don't track usage.
export const vehicleTypeEnum = pgEnum("vehicle_type", ["TRUCK", "TRAILER"]);

export const trucksTable = pgTable(
  "trucks",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    vehicleType: vehicleTypeEnum("vehicle_type").notNull().default("TRUCK"),
    brand: text("brand"),
    model: text("model"),
    vin: text("vin"),
    plate: text("plate"),
    status: truckStatusEnum("status").notNull().default("ACTIVE"),
    // Nullable so freshly-imported assets can land without a department —
    // the team assigns one later via the registry's "Bulk assign" action
    // or the asset detail page. The FK is set-null on delete so removing
    // a department unassigns its assets instead of blocking the delete.
    departmentId: integer("department_id").references(
      () => departmentsTable.id,
      { onDelete: "set null" },
    ),
    assignedCrewId: integer("assigned_crew_id").references(
      () => crewsTable.id,
      { onDelete: "set null" },
    ),
    lastAssignedByUserId: integer("last_assigned_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    lastAssignedAt: timestamp("last_assigned_at", { withTimezone: true }),
    purchasePriceCents: integer("purchase_price_cents"),
    purchaseDate: timestamp("purchase_date", { withTimezone: true }),
    currentMileage: integer("current_mileage").notNull().default(0),
    serviceIntervalMiles: integer("service_interval_miles")
      .notNull()
      .default(5000),
    slug: text("slug"),
    // Hero photo of the asset, stored as a base64 data URL (image/png|jpeg|webp).
    // Mirrors the maintenance receipt approach — no separate file store needed.
    imageDataUrl: text("image_data_url"),
    // Cached "currently held by" pointer. Source of truth is asset_checkouts
    // (the open row where checked_in_at is null), but caching here keeps the
    // /assets list query a single round-trip.
    currentHolderUserId: integer("current_holder_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    lastCheckedOutAt: timestamp("last_checked_out_at", { withTimezone: true }),
    // Insurance schedule fields — imported from the annual coverage document.
    // All nullable so existing rows and future manual-entry rows are unaffected.
    year: integer("year"),
    statedValueCents: integer("stated_value_cents"),
    gvwGcwLbs: integer("gvw_gcw_lbs"),
    garagingState: text("garaging_state").default("FL"),
    operatingRadiusMiles: integer("operating_radius_miles"),
    insuranceVehNumber: integer("insurance_veh_number"),
    bodyTypeCode: text("body_type_code"),
    // Official fleet tag painted on the vehicle ("JT-01", "JTTT-50",
    // "JTLJ-60") and the plate-expiration month as ISO "YYYY-MM".
    // Seeded from the printed tag sheets by lib/db/src/fleetTags.ts
    // (fills blanks only), editable from the asset detail / edit dialog.
    fleetTag: text("fleet_tag"),
    plateExpires: text("plate_expires"),
  },
  (t) => [
    index("trucks_status_idx").on(t.status),
    uniqueIndex("trucks_slug_uq").on(t.slug),
  ],
);

// Two non-vehicle asset categories live in this table:
//   HANDHELD — chainsaws, blowers, hand tools. Quantity > 1 supported
//              so "30 shovels" is one row with quantity=30.
//   CUSTOM   — anything else (heavy powered equipment, safety gear,
//              consumables). `customCategoryLabel` is a free-form label
//              ("Heavy Equipment", "Safety Gear") that drives grouping.
export const equipmentCategoryEnum = pgEnum("equipment_category", [
  "HANDHELD",
  "CUSTOM",
]);

export const equipmentTable = pgTable(
  "equipment",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    category: equipmentCategoryEnum("category").notNull().default("HANDHELD"),
    customCategoryLabel: text("custom_category_label"),
    quantity: integer("quantity").notNull().default(1),
    brand: text("brand"),
    model: text("model"),
    serial: text("serial"),
    location: text("location"),
    status: equipmentStatusEnum("status").notNull().default("ACTIVE"),
    // Nullable — see trucks.departmentId comment.
    departmentId: integer("department_id").references(
      () => departmentsTable.id,
      { onDelete: "set null" },
    ),
    assignedTruckId: integer("assigned_truck_id").references(
      () => trucksTable.id,
      { onDelete: "set null" },
    ),
    assignedCrewId: integer("assigned_crew_id").references(
      () => crewsTable.id,
      { onDelete: "set null" },
    ),
    lastAssignedByUserId: integer("last_assigned_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    lastAssignedAt: timestamp("last_assigned_at", { withTimezone: true }),
    purchasePriceCents: integer("purchase_price_cents"),
    purchaseDate: timestamp("purchase_date", { withTimezone: true }),
    currentHours: integer("current_hours").notNull().default(0),
    serviceIntervalHours: integer("service_interval_hours")
      .notNull()
      .default(100),
    slug: text("slug"),
    imageDataUrl: text("image_data_url"),
    currentHolderUserId: integer("current_holder_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    lastCheckedOutAt: timestamp("last_checked_out_at", { withTimezone: true }),
  },
  (t) => [
    index("equipment_status_idx").on(t.status),
    uniqueIndex("equipment_slug_uq").on(t.slug),
  ],
);

export const maintenanceLogsTable = pgTable(
  "maintenance_logs",
  {
    id: serial("id").primaryKey(),
    truckId: integer("truck_id").references(() => trucksTable.id, {
      onDelete: "cascade",
    }),
    equipmentId: integer("equipment_id").references(() => equipmentTable.id, {
      onDelete: "cascade",
    }),
    kind: maintenanceKindEnum("kind").notNull().default("SCHEDULED"),
    description: text("description").notNull(),
    performedByUserId: integer("performed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    loggedByUserId: integer("logged_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    laborCostCents: integer("labor_cost_cents").notNull().default(0),
    partsCostCents: integer("parts_cost_cents").notNull().default(0),
    // costCents is the cached total = labor + parts; kept for backwards compat
    // and to keep dashboard sums fast. The API always sets it on write.
    costCents: integer("cost_cents").notNull().default(0),
    mileageAtService: integer("mileage_at_service"),
    hoursAtService: integer("hours_at_service"),
    // Receipt-tracking fields, set by the maintenance log dialog when a
    // mechanic uploads a photo of a vendor receipt and categorizes it
    // for the accountant. All four are nullable so existing rows pre-
    // dating the feature stay valid.
    vendor: text("vendor"),
    category: text("category"), // LABOR | PARTS | FUEL | OUTSOURCED | OTHER
    notes: text("notes"),
    receiptDataUrl: text("receipt_data_url"),
  },
  (t) => [
    index("maintenance_logs_truck_id_idx").on(t.truckId),
    index("maintenance_logs_equipment_id_idx").on(t.equipmentId),
    index("maintenance_logs_performed_at_idx").on(t.performedAt),
  ],
);

// Tracks every status transition for trucks and equipment so the team can see
// who put an asset In Shop or Out of Service and when.
export const assetStatusLogTable = pgTable(
  "asset_status_log",
  {
    id: serial("id").primaryKey(),
    assetType: text("asset_type").notNull(), // "TRUCK" | "EQUIPMENT"
    assetId: integer("asset_id").notNull(),
    oldStatus: text("old_status").notNull(),
    newStatus: text("new_status").notNull(),
    changedByUserId: integer("changed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("asset_status_log_asset_idx").on(t.assetType, t.assetId),
    index("asset_status_log_changed_at_idx").on(t.changedAt),
  ],
);

// Audit trail for crew-assignment changes. One row per change. Mirrors
// the `asset_status_log` shape so a single (assetType, assetId) pair can
// resolve back to the underlying truck/equipment row.
//   - newCrewId == null && oldCrewId != null → "returned" / unassigned
//   - newCrewId != null && oldCrewId == null → first assignment
//   - both non-null with different ids       → reassignment
export const assetAssignmentLogTable = pgTable(
  "asset_assignment_log",
  {
    id: serial("id").primaryKey(),
    assetType: text("asset_type").notNull(), // "TRUCK" | "EQUIPMENT"
    assetId: integer("asset_id").notNull(),
    oldCrewId: integer("old_crew_id").references(() => crewsTable.id, {
      onDelete: "set null",
    }),
    newCrewId: integer("new_crew_id").references(() => crewsTable.id, {
      onDelete: "set null",
    }),
    changedByUserId: integer("changed_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text("note"),
  },
  (t) => [
    index("asset_assignment_log_asset_idx").on(t.assetType, t.assetId),
    index("asset_assignment_log_changed_at_idx").on(t.changedAt),
  ],
);

export const usageReadingsTable = pgTable(
  "usage_readings",
  {
    id: serial("id").primaryKey(),
    truckId: integer("truck_id").references(() => trucksTable.id, {
      onDelete: "cascade",
    }),
    equipmentId: integer("equipment_id").references(() => equipmentTable.id, {
      onDelete: "cascade",
    }),
    mileage: integer("mileage"),
    hours: integer("hours"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedByUserId: integer("recorded_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
  },
  (t) => [
    index("usage_readings_truck_id_idx").on(t.truckId),
    index("usage_readings_equipment_id_idx").on(t.equipmentId),
    index("usage_readings_recorded_at_idx").on(t.recordedAt),
  ],
);

// Consumable items / accessories attached to a piece of equipment.
// Examples: saw chains, guide bars, blades, spark plugs, mixing oil.
export const equipmentItemsTable = pgTable(
  "equipment_items",
  {
    id: serial("id").primaryKey(),
    equipmentId: integer("equipment_id")
      .notNull()
      .references(() => equipmentTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unit: text("unit"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("equipment_items_equipment_id_idx").on(t.equipmentId)],
);

// Per-user checkout / check-in log for any asset (truck or equipment).
// One row per checkout event; the open row (checked_in_at IS NULL) is
// the current holder. Closing a checkout updates checked_in_at and
// clears the cached current_holder_user_id on the parent asset.
export const assetCheckoutsTable = pgTable(
  "asset_checkouts",
  {
    id: serial("id").primaryKey(),
    assetType: text("asset_type").notNull(), // "TRUCK" | "EQUIPMENT"
    assetId: integer("asset_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    checkedOutByUserId: integer("checked_out_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInByUserId: integer("checked_in_by_user_id").references(
      () => usersTable.id,
      { onDelete: "set null" },
    ),
    notes: text("notes"),
  },
  (t) => [
    index("asset_checkouts_asset_idx").on(t.assetType, t.assetId),
    index("asset_checkouts_open_idx").on(t.assetType, t.assetId, t.checkedInAt),
    index("asset_checkouts_user_idx").on(t.userId),
  ],
);

export type Truck = typeof trucksTable.$inferSelect;
export type AssetCheckout = typeof assetCheckoutsTable.$inferSelect;
export type Equipment = typeof equipmentTable.$inferSelect;
export type EquipmentItem = typeof equipmentItemsTable.$inferSelect;
export type MaintenanceLog = typeof maintenanceLogsTable.$inferSelect;
export type UsageReading = typeof usageReadingsTable.$inferSelect;
export type AssetStatusLog = typeof assetStatusLogTable.$inferSelect;
export type AssetAssignmentLog = typeof assetAssignmentLogTable.$inferSelect;

import { createInsertSchema, createSelectSchema } from "drizzle-zod";
export const insertTruckSchema = createInsertSchema(trucksTable);
export const selectTruckSchema = createSelectSchema(trucksTable);
export const insertEquipmentSchema = createInsertSchema(equipmentTable);
export const selectEquipmentSchema = createSelectSchema(equipmentTable);
export const insertMaintenanceLogSchema = createInsertSchema(maintenanceLogsTable);
export const selectMaintenanceLogSchema = createSelectSchema(maintenanceLogsTable);
export const insertUsageReadingSchema = createInsertSchema(usageReadingsTable);
export const selectUsageReadingSchema = createSelectSchema(usageReadingsTable);
export const insertEquipmentItemSchema = createInsertSchema(equipmentItemsTable);
export const selectEquipmentItemSchema = createSelectSchema(equipmentItemsTable);
export const insertAssetCheckoutSchema = createInsertSchema(assetCheckoutsTable);
export const selectAssetCheckoutSchema = createSelectSchema(assetCheckoutsTable);
