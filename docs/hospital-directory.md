# Hospital directory

CIVIS carries a real directory of facilities imported from official datasets,
with three ways in: **Near me**, **Bangladesh** (all eight divisions) and
**Worldwide** (country by country). This document records what is real, what is
not, and why.

---

## 1. Where the data comes from

**Bangladesh:** DGHS Health Facility Registry —
<https://hris.mohfw.gov.bd/public/facility-registry/>

The public page renders its table from a DataTables endpoint. The importer calls
the same endpoint with the same `division_id[]` filter the page uses, so every
division is fetched directly rather than by text search.

Imported: **39,447 facilities** across all eight divisions, with **29,027**
published phone numbers.

| Division | Facilities |
| --- | --- |
| Dhaka | 9,983 |
| Chattogram | 7,485 |
| Rajshahi | 5,226 |
| Khulna | 4,822 |
| Rangpur | 4,026 |
| Barishal | 2,887 |
| Mymensingh | 2,791 |
| Sylhet | 2,227 |

Fields retained per facility: official id, English and Bangla name, facility
code, agency, facility type (source wording **and** a normalised category),
ownership, country, division, district, city corporation, upazila, published
email, published mobile number, active flag, source URL and import timestamp.

Re-run the import at any time:

```bash
npm run hospitals:import                       # all eight divisions
node scripts/import-hospital-registry.mjs --division=Dhaka
node scripts/import-hospital-registry.mjs --dry --pages 1
```

The importer is idempotent: it upserts on `(source, source_id)` and restores the
same ids (`rf-dghs-<id>`), so a re-run refreshes names and numbers instead of
duplicating rows. It never overwrites a contact a CIVIS reviewer verified.

---

## 2. Country and administrative hierarchy

Every record carries `country` and `country_code`. The three location columns
are generic levels so one schema serves every country:

| Column | Bangladesh | India | United States | Canada | United Kingdom |
| --- | --- | --- | --- | --- | --- |
| `division` | Division | State | State | Province | Region |
| `district` | District | District | County | Municipality | County / local authority |
| `upazila` | Upazila | Subdistrict | City | City | Locality |

The interface reads those labels from `lib/hospitals/hierarchy.ts`, so a country
is never forced into Bangladesh's wording.

### Importing an international dataset

`--file` accepts JSON (an array, or `{ records: [...] }`) or CSV with this header:

```
country,country_code,name,category,facility_type,ownership,division,district,upazila,address,lat,lng,phone,email,source,source_id,source_url
```

```bash
npm run hospitals:import -- --file=international.json
```

Rows are upserted on `(source, source_id)` exactly like the DGHS records. No
facility is created for a region without a dataset: the interface says
**"No hospital records are currently available for this region."**

---

## 3. Locations and filters

### Near me
- Requires an actual device fix; the mode requests one and says plainly when it
  cannot get it.
- Radii: 2, 5, 10, 25, 50 km.
- Distance-sorted with `haversine` computed in SQL (SQLite math functions), so
  "nearest first" is applied **before** pagination.

### Bangladesh
- Division dropdown always lists the eight official divisions, even when one has
  no imported records.
- Districts load for the chosen division, upazilas load for the chosen district.
- Search covers name, Bangla name, division, district, upazila, city corporation,
  address and facility type.
- **Reset filters** returns to every available hospital in Bangladesh.

### Worldwide
- Searchable country list with flags and record counts (countries with records
  first). Selecting a country scopes every query to `country_code`.
- Its own administrative levels are offered, labelled per country.

---

## 4. Ordering

`recommended` (default) ranks CIVIS-verified contacts first, then facilities with
a published number. Coordinates are deliberately **not** a ranking signal, so a
single mapped division cannot dominate a nationwide list.

Also available: nearest first, verified contacts first, government hospitals,
private hospitals, recently verified.

---

## 5. Coordinates

The DGHS registry publishes no latitude or longitude. Two thousand two hundred
and twenty-five Sylhet records were previously geocoded to their **upazila
centre** and are stored with `location_status = 'approximate'`; they are drawn on
the map but never presented as verified positions. Nothing else is placed at an
invented coordinate.

Consequences, stated plainly:

1. The map shows markers only for records with a coordinate.
2. Near me returns nothing outside regions without coordinates — a data gap, not
   a bug. The Emergency Center's OpenStreetMap finder is separate and does return
   real nearby facilities.
3. The map centres on the chosen division or country even when the result set has
   no markers, and it is never recreated: selecting a region re-centres or re-fits
   the existing instance.

To add coordinates, use a geocoding run (`location_status = 'approximate'`, for
review) or import a CSV keyed by facility id with `location_status = 'verified'`.

---

## 6. Contacts and calling

Only a row in `registry_contacts` authorises a Call button. No number is derived
or reused from reception for every department.

| Value | Shown as |
| --- | --- |
| `registry` | "Official registry number — not independently verified by CIVIS" |
| `verified` | "Verified" + date |
| `unverified` | "Reported — not verified" |

`tel:` links are only produced for a number that resolves to a dial target
(Bangladesh patterns, or a generic 7–15 digit international number). Every number
also has copy-to-clipboard.

Administrators and approved authority accounts can publish a department contact
through `POST /api/hospitals/registry/[id]/contacts`.

---

## 7. Availability stays separate, and honest

The registry says nothing about beds or services. Those remain in the existing,
unchanged tables (`hospital_wards`, `hospital_services`) and only ever hold rows
from a verified organisation. The directory therefore shows "Bed availability not
reported" and "Medical services not reported" rather than a figure it cannot
attribute.

---

## 8. Files

```
lib/hospitals/registry.sql                  registry schema (country + admin levels)
lib/hospitals/registry.ts                   search, ordering, summary, location lists
lib/hospitals/hierarchy.ts                  client-safe admin labels and map centres
scripts/import-hospital-registry.mjs        DGHS importer + international dataset import
app/hospitals/page.tsx                      directory route
components/hospitals/hospital-directory.tsx three modes, filters, list, profile
components/hospitals/hospital-map.tsx       map (coordinate-only pins, re-centres)
app/api/hospitals/registry/route.ts         scoped search + dependent location lists
app/api/hospitals/registry/[id]/route.ts    profile + contacts
```

`lib/db.ts` applies `registry.sql` and the country-column migrations.

---

## 9. Verification performed

- `npx tsc --noEmit` — clean
- Import: 39,447 facilities, 29,027 contacts, all eight divisions populated
- `GET /api/hospitals/registry?country=BD` — 37,737 care facilities, eight divisions
- `?division=Dhaka` — 9,495 records; `?division=Chattogram` — 7,3xx
- `?division=Dhaka&district=Gazipur` — 831 records, upazila list populated
- `?q=medical college` — 271 records
- Every sort option returns the same total with different ordering
- `?country=IN` — empty set with the region message path exercised
- `GET /hospitals` — HTTP 200, rendered in the browser

Not verified: a signed-in test of the administrator contact form, and live
Near-me results (no device fix with the importer running).

---

## 10. Limitations

1. **Only Bangladesh has an imported dataset.** Every other country correctly
   reports that no records are available until a dataset is imported.
2. **No coordinates outside the geocoded Sylhet records.** Near me is limited to
   those.
3. **No point-in-polygon lookup.** A GPS fix is not converted into a division;
   boundary polygons are not shipped, and nearest-place matching would misidentify
   users near borders.
4. **SQLite, not PostGIS.** `bbox` + index + SQL haversine is the equivalent of
   `ST_DWithin`.
5. **Registry numbers are not call-tested.**
