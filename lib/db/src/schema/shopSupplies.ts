import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Shop supplies — consumables the shop keeps on hand (oil, filters,
 * grease, blades, hardware, cleaning supplies) with their unit price
 * and quantity, so the team can see what's in stock, what it's worth,
 * and what needs reordering.
 *
 * Deliberately a flat table: one row per supply item. `quantityOnHand`
 * is the live count; `reorderLevel` (optional) drives the low-stock
 * badge. Prices are stored in cents like everywhere else in the app.
 *
 * The table is created on boot by `ensureShopSuppliesTable()` in
 * backfillFleet.ts (CREATE TABLE IF NOT EXISTS) so no migration step is
 * needed on deploy.
 */
export const shopSuppliesTable = pgTable(
  "shop_supplies",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    // Free-text grouping, e.g. "Oil & Lubricants", "Filters", "Hardware".
    category: text("category"),
    // Vendor part number / SKU for quick reordering.
    sku: text("sku"),
    vendor: text("vendor"),
    // Unit of measure for quantity: "each", "gal", "qt", "box", "case"…
    unit: text("unit").notNull().default("each"),
    quantityOnHand: integer("quantity_on_hand").notNull().default(0),
    // When quantityOnHand <= reorderLevel the item is flagged low.
    reorderLevel: integer("reorder_level"),
    unitPriceCents: integer("unit_price_cents").notNull().default(0),
    lastPurchasedAt: timestamp("last_purchased_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("shop_supplies_name_idx").on(t.name),
    index("shop_supplies_category_idx").on(t.category),
  ],
);

export type ShopSupply = typeof shopSuppliesTable.$inferSelect;
export type NewShopSupply = typeof shopSuppliesTable.$inferInsert;
