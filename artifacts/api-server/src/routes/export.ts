import { Router, type IRouter } from "express";
import * as xlsx from "xlsx";
import {
  db,
  trucksTable,
  equipmentTable,
  crewsTable,
  customersTable,
  jobsTable,
  propertiesTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();

router.get(
  "/admin/export",
  requireAuth,
  requireRole("ADMIN"),
  async (_req, res) => {
    const [trucks, equipment, crews, customers, jobs, properties] =
      await Promise.all([
        db.select().from(trucksTable),
        db.select().from(equipmentTable),
        db.select().from(crewsTable),
        db.select().from(customersTable),
        db.select().from(jobsTable),
        db.select().from(propertiesTable),
      ]);

    // Lookup maps used across sheets
    const crewById = new Map(crews.map((c) => [c.id, c.name]));
    const customerById = new Map(customers.map((c) => [c.id, c.fullName]));
    // property → customer name (two-hop: job.propertyId → property.customerId → customer.fullName)
    const customerByPropertyId = new Map(
      properties.map((p) => [p.id, customerById.get(p.customerId) ?? ""]),
    );

    // ---- Fleet sheet ----
    const fleetRows = trucks.map((t) => ({
      Name: t.name ?? "",
      Year: t.year ?? "",
      Make: t.brand ?? "",
      Model: t.model ?? "",
      VIN: t.vin ?? "",
      Plate: t.plate ?? "",
      Status: t.status ?? "",
      "Insurance Veh #": t.insuranceVehNumber ?? "",
      "Stated Value ($)":
        t.statedValueCents != null
          ? (t.statedValueCents / 100).toFixed(2)
          : "",
      "Purchase Price ($)":
        t.purchasePriceCents != null
          ? (t.purchasePriceCents / 100).toFixed(2)
          : "",
      "Purchase Date": t.purchaseDate ?? "",
      "Current Mileage": t.currentMileage ?? "",
      "Service Interval (mi)": t.serviceIntervalMiles ?? "",
      "GVW/GCW (lbs)": t.gvwGcwLbs ?? "",
      "Garaging State": t.garagingState ?? "",
      "Body Type": t.bodyTypeCode ?? "",
    }));

    // ---- Equipment sheet ----
    const equipmentRows = equipment.map((e) => ({
      Name: e.name ?? "",
      Brand: e.brand ?? "",
      Model: e.model ?? "",
      "Serial #": e.serial ?? "",
      Category: e.category ?? "",
      Status: e.status ?? "",
      Location: e.location ?? "",
      "Assigned Crew":
        e.assignedCrewId != null
          ? (crewById.get(e.assignedCrewId) ?? "")
          : "",
      "Purchase Price ($)":
        e.purchasePriceCents != null
          ? (e.purchasePriceCents / 100).toFixed(2)
          : "",
      "Purchase Date": e.purchaseDate ?? "",
      "Current Hours": e.currentHours ?? "",
      "Service Interval (hrs)": e.serviceIntervalHours ?? "",
    }));

    // ---- Crews sheet ----
    const equipPerCrew = new Map<number, number>();
    for (const e of equipment) {
      if (e.assignedCrewId != null) {
        equipPerCrew.set(
          e.assignedCrewId,
          (equipPerCrew.get(e.assignedCrewId) ?? 0) + 1,
        );
      }
    }
    const crewRows = crews.map((c) => ({
      "Crew Name": c.name ?? "",
      "Equipment Count": equipPerCrew.get(c.id) ?? 0,
    }));

    // ---- Customers sheet ----
    const customerRows = customers.map((c) => ({
      Name: c.fullName ?? "",
      Email: c.email ?? "",
      Phone: c.phone ?? "",
      "Billing Address": c.billingAddress ?? "",
      "Created At": c.createdAt
        ? new Date(c.createdAt).toLocaleDateString()
        : "",
    }));

    // ---- Jobs sheet ----
    const jobRows = jobs.map((j) => ({
      Title: `Job #${j.id}`,
      Customer:
        j.propertyId != null
          ? (customerByPropertyId.get(j.propertyId) ?? "")
          : "",
      Crew: j.crewId != null ? (crewById.get(j.crewId) ?? "") : "",
      Status: j.status ?? "",
      "Scheduled Date": j.scheduledFor
        ? new Date(j.scheduledFor).toLocaleDateString()
        : "",
      "Completed At": j.completedAt
        ? new Date(j.completedAt).toLocaleDateString()
        : "",
      "Total ($)":
        j.totalCents != null ? (j.totalCents / 100).toFixed(2) : "",
      Notes: j.notes ?? "",
      "Created At": j.createdAt
        ? new Date(j.createdAt).toLocaleDateString()
        : "",
    }));

    // ---- Build workbook ----
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(fleetRows),
      "Fleet",
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(equipmentRows),
      "Equipment",
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(crewRows),
      "Crews",
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(customerRows),
      "Customers",
    );
    xlsx.utils.book_append_sheet(
      wb,
      xlsx.utils.json_to_sheet(jobRows),
      "Jobs",
    );

    const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" });
    const today = new Date().toISOString().slice(0, 10);
    const filename = `joshua-tree-export-${today}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    res.send(buf);
  },
);

export default router;
