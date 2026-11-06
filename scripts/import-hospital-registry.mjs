#!/usr/bin/env node
/**
 * Import the DGHS Health Facility Registry into CIVIS.
 *
 * The public registry renders its table from a server-side DataTables endpoint.
 * This script calls the same endpoint the page does. The previous version scoped
 * the import to Sylhet Division with a text search; the endpoint's
 * `division_id[]` parameter does filter correctly, so this version imports all
 * eight divisions (or one, with --division=Name).
 *
 * Records keep the source's own wording in `facility_type` and a normalised
 * `facility_category` for filtering. The registry publishes no coordinates, so
 * lat/lng stay NULL and `location_status` stays 'unavailable': nothing is
 * placed at an invented position.
 *
 * Usage
 *   node scripts/import-hospital-registry.mjs                 # all divisions
 *   node scripts/import-hospital-registry.mjs --division=Dhaka
 *   node scripts/import-hospital-registry.mjs --dry --pages 1
 *   node scripts/import-hospital-registry.mjs --file=international.json
 *
 * International datasets use the same upsert path. `--file` accepts a JSON file
 * (an array, or { records: [...] }) or a CSV with the header:
 *   country,country_code,name,category,facility_type,ownership,division,district,upazila,address,lat,lng,phone,email,source,source_id,source_url
 * `division`/`district`/`upazila` are admin levels 1/2/3 for that country, so
 * India can supply state/district/subdistrict and the US state/county/city
 * through the same three columns.
 */
import fs from "node:fs";
import path from "node:path";
import sqlite from "node-sqlite3-wasm";

const { Database } = sqlite;

const ENDPOINT = "https://hris.mohfw.gov.bd/public/facility-registry/facilities/datatable/json";
const SOURCE = "DGHS Health Facility Registry";
const PROFILE_URL = "https://hris.mohfw.gov.bd/public/facility-registry/facilities";
const PAGE_SIZE = 1000;

/** Official division ids used by the registry's `division_id[]` filter. */
const DIVISIONS = [
  { id: 1, name: "Dhaka" },
  { id: 2, name: "Chattogram" },
  { id: 3, name: "Rajshahi" },
  { id: 4, name: "Rangpur" },
  { id: 5, name: "Khulna" },
  { id: 6, name: "Barishal" },
  { id: 7, name: "Sylhet" },
  { id: 8, name: "Mymensingh" },
];

const TYPE_CATEGORY = new Map([
  ["community clinic", "community_clinic"],
  ["union health center", "union_health_centre"],
  ["union health sub center", "union_health_centre"],
  ["union health & family welfare center (uh&fwc)", "union_health_centre"],
  ["consultancy & diagnostic center", "diagnostic_centre"],
  ["private hospital / clinic", "clinic"],
  ["ngo hospital/clinic", "clinic"],
  ["chest disease clinic", "clinic"],
  ["school health clinic", "clinic"],
  ["upazila health complex", "upazila_health_complex"],
  ["medical college", "medical_college"],
  ["medical college hospital", "medical_college"],
  ["district/general hospital", "district_hospital"],
  ["upazila level office", "administrative"],
  ["district level office", "administrative"],
  ["district office", "administrative"],
  ["divisional level office", "administrative"],
  ["jail hospital", "hospital"],
  ["20-bed hospital", "hospital"],
  ["10-bed hospital", "hospital"],
  ["31-bed hospital", "hospital"],
  ["50-bed hospital", "hospital"],
  ["combined military hospital", "hospital"],
  ["infectious disease hospital", "hospital"],
  ["leprosy hospital", "hospital"],
  ["special purpose hospital", "specialized"],
  ["chest disease hospital", "specialized"],
  ["trauma center", "hospital"],
  ["municipality", "other"],
  ["city corporation", "other"],
]);

function categoryFor(type) {
  const text = String(type ?? "").trim();
  const exact = TYPE_CATEGORY.get(text.toLowerCase());
  if (exact) return exact;
  const lower = text.toLowerCase();
  if (!lower) return "other";
  if (lower.includes("office")) return "administrative";
  if (lower.includes("community clinic")) return "community_clinic";
  if (lower.includes("health complex")) return "upazila_health_complex";
  if (lower.includes("medical college")) return "medical_college";
  if (lower.includes("district") && lower.includes("hospital")) return "district_hospital";
  if (lower.includes("diagnostic")) return "diagnostic_centre";
  if (lower.includes("dental")) return "dental";
  if (lower.includes("hospital")) return "hospital";
  if (lower.includes("clinic") || lower.includes("dispensary")) return "clinic";
  if (/college|institute|university|academy|training|school/.test(lower)) return "other";
  return "other";
}

function normalizePhone(raw) {
  const text = String(raw ?? "").trim();
  const digits = text.replace(/\D/g, "");
  if (!digits) return { phone: null, e164: null };
  if (/^01\d{9}$/.test(digits)) return { phone: text, e164: `+88${digits}` };
  if (/^8801\d{9}$/.test(digits)) return { phone: text, e164: `+${digits}` };
  if (/^0\d{8,9}$/.test(digits)) return { phone: text, e164: `+880${digits.slice(1)}` };
  if (digits.length >= 7 && digits.length <= 15) return { phone: text, e164: `+${digits}` };
  return { phone: text, e164: null };
}

function ownershipFor(raw) {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("private")) return "private";
  if (value.includes("public") || value.includes("government")) return "public";
  return null;
}

/** The endpoint wraps id and name in an anchor tag; keep only the text. */
function textOf(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function facilityId(sourceId) {
  return `rf-dghs-${sourceId}`;
}

function ensureSchema(db) {
  const columns = [
    "ALTER TABLE registry_facilities ADD COLUMN country TEXT NOT NULL DEFAULT 'Bangladesh'",
    "ALTER TABLE registry_facilities ADD COLUMN country_code TEXT NOT NULL DEFAULT 'BD'",
    "CREATE INDEX IF NOT EXISTS idx_registry_country ON registry_facilities(country_code, division, district)",
  ];
  for (const statement of columns) {
    try {
      db.exec(statement);
    } catch {
      // Already present.
    }
  }
}

async function fetchPage(divisionId, start, attempt = 1) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("draw", String(start / PAGE_SIZE + 1));
  url.searchParams.set("start", String(start));
  url.searchParams.set("length", String(PAGE_SIZE));
  url.searchParams.set("division_id[]", String(divisionId));
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "CIVIS/1.0 hospital directory importer",
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      return fetchPage(divisionId, start, attempt + 1);
    }
    throw new Error(`Registry returned HTTP ${response.status} for start=${start}.`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.data)) throw new Error("Registry returned an unexpected payload.");
  return payload;
}

function statements(db) {
  const facility = db.prepare(`
    INSERT INTO registry_facilities
      (id, source, source_id, source_url, name, name_bn, facility_code, facility_type, facility_category,
       agency, ownership, country, country_code, division, district, city_corporation, upazila, address,
       lat, lng, location_status, phone, email, active, imported_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source, source_id) DO UPDATE SET
      name = excluded.name, name_bn = excluded.name_bn, facility_code = excluded.facility_code,
      facility_type = excluded.facility_type, facility_category = excluded.facility_category,
      agency = excluded.agency, ownership = excluded.ownership, country = excluded.country,
      country_code = excluded.country_code, division = excluded.division, district = excluded.district,
      city_corporation = excluded.city_corporation, upazila = excluded.upazila, address = excluded.address,
      lat = COALESCE(excluded.lat, registry_facilities.lat),
      lng = COALESCE(excluded.lng, registry_facilities.lng),
      location_status = CASE
        WHEN registry_facilities.lat IS NOT NULL AND registry_facilities.lng IS NOT NULL
          THEN registry_facilities.location_status
        ELSE excluded.location_status END,
      phone = excluded.phone, email = excluded.email, active = excluded.active,
      source_url = excluded.source_url, imported_at = excluded.imported_at,
      updated_at = excluded.updated_at
  `);
  const contact = db.prepare(`
    INSERT INTO registry_contacts
      (id, facility_id, department_code, department_name, contact_group, phone, phone_e164,
       operating_hours, contact_type, source, source_url, verification_status,
       last_verified_at, updated_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(facility_id, department_code) DO UPDATE SET
      phone = excluded.phone, phone_e164 = excluded.phone_e164,
      source = excluded.source, source_url = excluded.source_url,
      updated_at = excluded.updated_at
    WHERE registry_contacts.verification_status = 'registry'
  `);
  const runRecord = db.prepare(`
    INSERT INTO registry_imports
      (id, source, scope, records_seen, records_written, records_skipped, note, ran_at)
    VALUES (?,?,?,?,?,?,?,?)
  `);
  return { facility, contact, runRecord };
}

function writeRecords(db, prep, records, scope, stamp, dry) {
  let written = 0;
  let skipped = 0;
  db.exec("BEGIN");
  try {
    for (const record of records) {
      if (!record || !record.sourceId || !record.name) {
        skipped += 1;
        continue;
      }
      const id = facilityId(record.sourceId);
      const phone = normalizePhone(record.phone);
      if (!dry) {
        prep.facility.run([
          id,
          record.source ?? SOURCE,
          String(record.sourceId),
          record.sourceUrl ?? `${PROFILE_URL}/${record.sourceId}/profile`,
          record.name,
          record.nameBn ?? null,
          record.facilityCode ?? null,
          record.facilityType ?? null,
          record.category ?? categoryFor(record.facilityType),
          record.agency ?? null,
          record.ownership ?? null,
          record.country ?? "Bangladesh",
          record.countryCode ?? "BD",
          record.division ?? null,
          record.district ?? null,
          record.cityCorporation ?? null,
          record.upazila ?? null,
          record.address ?? null,
          record.lat ?? null,
          record.lng ?? null,
          record.lat !== null && record.lat !== undefined && record.lng !== null && record.lng !== undefined
            ? "verified"
            : "unavailable",
          phone.phone,
          record.email ?? null,
          record.active ?? null,
          stamp,
          stamp,
          stamp,
        ]);
        if (phone.phone) {
          prep.contact.run([
            `rc-${id}-general`,
            id,
            "general",
            "Main reception / general enquiry",
            "general",
            phone.phone,
            phone.e164,
            null,
            "voice",
            record.source ?? SOURCE,
            record.sourceUrl ?? `${PROFILE_URL}/${record.sourceId}/profile`,
            "registry",
            null,
            null,
            stamp,
            stamp,
          ]);
        }
      }
      written += 1;
    }
    if (!dry) {
      prep.runRecord.run([
        `ri-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        SOURCE,
        scope,
        records.length,
        written,
        skipped,
        "Registry listing imported; coordinates unavailable unless supplied.",
        stamp,
      ]);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { written, skipped };
}

function toRecord(row) {
  return {
    sourceId: textOf(row.id),
    name: textOf(row.name),
    nameBn: textOf(row.name_bn) || null,
    facilityCode: row.code ?? null,
    facilityType: row.facility_type_name ?? null,
    category: categoryFor(row.facility_type_name),
    agency: row.facility_agency_name ?? null,
    ownership: ownershipFor(row.is_private),
    country: "Bangladesh",
    countryCode: "BD",
    division: row.division_name ?? null,
    district: row.district_name ?? null,
    cityCorporation: row.city_corporation_name ?? null,
    upazila: row.upazila_name ?? null,
    address: null,
    lat: null,
    lng: null,
    phone: row.mobile_1 ?? null,
    email: row.email_1 ?? null,
    active: row.is_active ?? null,
  };
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let record = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.some((value) => value.trim() !== "")) rows.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }
  record.push(field);
  if (record.some((value) => value.trim() !== "")) rows.push(record);
  if (!rows.length) return [];
  const header = rows.shift().map((value) => value.trim());
  return rows.map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index]?.trim() ?? ""])),
  );
}

function fileRecords(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  if (filePath.toLowerCase().endsWith(".csv")) return parseCsv(text);
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(rows)) throw new Error("The dataset must be an array or { records: [...] }.");
  return rows;
}

function datasetRecord(row) {
  const lat = row.lat === "" || row.lat === undefined || row.lat === null ? null : Number(row.lat);
  const lng = row.lng === "" || row.lng === undefined || row.lng === null ? null : Number(row.lng);
  return {
    sourceId: String(row.source_id ?? row.sourceId ?? row.id ?? "").trim(),
    name: String(row.name ?? "").trim(),
    nameBn: row.name_bn ?? row.nameBn ?? null,
    facilityType: row.facility_type ?? row.facilityType ?? null,
    category: row.category ? String(row.category).trim() : categoryFor(row.facility_type ?? row.facilityType),
    ownership: row.ownership ? ownershipFor(row.ownership) ?? String(row.ownership) : null,
    country: String(row.country ?? "").trim() || "Bangladesh",
    countryCode: String(row.country_code ?? row.countryCode ?? "").trim().toUpperCase() || "BD",
    division: row.division ?? row.admin1 ?? null,
    district: row.district ?? row.admin2 ?? null,
    upazila: row.upazila ?? row.admin3 ?? null,
    address: row.address ?? null,
    lat: Number.isFinite(lat) && Math.abs(lat) <= 90 ? lat : null,
    lng: Number.isFinite(lng) && Math.abs(lng) <= 180 ? lng : null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    active: row.active ?? null,
    source: row.source ? String(row.source).trim() : null,
    sourceUrl: row.source_url ?? row.sourceUrl ?? null,
  };
}

async function main() {
  const args = new Map(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, "").split("=");
      return [key, rest.length ? rest.join("=") : "true"];
    }),
  );
  const dry = args.has("dry");
  const dbPath = args.get("db") ?? path.join(process.cwd(), "data", "civis.db");
  const db = new Database(dbPath);
  ensureSchema(db);
  const prep = statements(db);
  const stamp = new Date().toISOString();

  try {
    if (args.has("file")) {
      const records = fileRecords(args.get("file")).map(datasetRecord).filter((row) => row.name && row.sourceId);
      const countries = [...new Set(records.map((row) => row.countryCode))].join(", ") || "unknown";
      const result = writeRecords(db, prep, records, `dataset:${countries}`, stamp, dry);
      console.log(`Dataset import: ${result.written} records written, ${result.skipped} skipped (${countries}).`);
      return;
    }

    const only = args.get("division");
    const selected = only
      ? DIVISIONS.filter((division) => division.name.toLowerCase() === only.toLowerCase())
      : DIVISIONS;
    if (!selected.length) throw new Error(`Unknown division "${only}". Use one of: ${DIVISIONS.map((d) => d.name).join(", ")}.`);
    const pageLimit = Number(args.get("pages") ?? 0) || Infinity;

    for (const division of selected) {
      const records = [];
      let seen = 0;
      for (let page = 0; page < pageLimit; page += 1) {
        const payload = await fetchPage(division.id, page * PAGE_SIZE);
        const rows = payload.data.map(toRecord).filter((row) => row.sourceId && row.name);
        records.push(...rows);
        seen += payload.data.length;
        process.stdout.write(`\r${division.name}: ${records.length.toLocaleString()} records`);
        if (payload.data.length < PAGE_SIZE) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      const result = writeRecords(db, prep, records, division.name, stamp, dry);
      console.log(`\r${division.name}: ${result.written.toLocaleString()} written, ${result.skipped} skipped (seen ${seen.toLocaleString()}).`);
    }
  } finally {
    prep.facility.finalize();
    prep.contact.finalize();
    prep.runRecord.finalize();
    db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
