/**
 * Client-safe location metadata for the hospital directory.
 *
 * Kept out of `lib/hospitals/registry.ts` because that module opens SQLite and
 * must never be bundled into a browser component.
 */

export type AdminLabels = {
  level1: string;
  level2: string;
  level3: string;
};

/** The eight official divisions, in the order the directory lists them. */
export const BANGLADESH_DIVISIONS = [
  "Dhaka",
  "Chattogram",
  "Rajshahi",
  "Khulna",
  "Barishal",
  "Sylhet",
  "Rangpur",
  "Mymensingh",
] as const;

/**
 * Every country keeps its own administrative structure. These labels describe
 * what each of the three stored levels means so the interface never forces
 * Bangladesh's division/district/upazila wording onto another country.
 */
const LABELS: Record<string, AdminLabels> = {
  BD: { level1: "Division", level2: "District", level3: "Upazila" },
  IN: { level1: "State", level2: "District", level3: "Subdistrict" },
  US: { level1: "State", level2: "County", level3: "City" },
  CA: { level1: "Province", level2: "Municipality", level3: "City" },
  GB: { level1: "Region", level2: "County or local authority", level3: "Locality" },
  PK: { level1: "Province", level2: "District", level3: "Tehsil" },
  NP: { level1: "Province", level2: "District", level3: "Municipality" },
  LK: { level1: "Province", level2: "District", level3: "Divisional secretariat" },
  AU: { level1: "State or territory", level2: "Local government area", level3: "Suburb" },
  AE: { level1: "Emirate", level2: "Region", level3: "City" },
  SA: { level1: "Region", level2: "Governorate", level3: "City" },
  MY: { level1: "State", level2: "District", level3: "City" },
  ID: { level1: "Province", level2: "Regency or city", level3: "District" },
  PH: { level1: "Region", level2: "Province", level3: "City or municipality" },
  KE: { level1: "County", level2: "Sub-county", level3: "Ward" },
  ZA: { level1: "Province", level2: "District municipality", level3: "Local municipality" },
  NG: { level1: "State", level2: "Local government area", level3: "City" },
};

const GENERIC: AdminLabels = { level1: "Region", level2: "District", level3: "City" };

/**
 * Countries whose administrative structure CIVIS names explicitly. They are
 * offered ahead of the long tail in the country picker, because a directory
 * importer is most likely to target one of them next.
 */
export const SUPPORTED_COUNTRY_CODES = new Set(Object.keys(LABELS));

export function adminLabels(countryCode: string | null | undefined): AdminLabels {
  if (!countryCode) return GENERIC;
  return LABELS[countryCode.toUpperCase()] ?? GENERIC;
}

/** Rough map centre per country, used only to point the map at a region. */
const COUNTRY_CENTRES: Record<string, { lat: number; lng: number; zoom: number }> = {
  BD: { lat: 23.685, lng: 90.3563, zoom: 6.6 },
  IN: { lat: 22.3511, lng: 78.6677, zoom: 4.2 },
  US: { lat: 39.8283, lng: -98.5795, zoom: 3.6 },
  CA: { lat: 56.1304, lng: -106.3468, zoom: 3.2 },
  GB: { lat: 54.5, lng: -3.4, zoom: 5 },
  PK: { lat: 30.3753, lng: 69.3451, zoom: 4.6 },
  NP: { lat: 28.3949, lng: 84.124, zoom: 6.2 },
  LK: { lat: 7.8731, lng: 80.7718, zoom: 6.6 },
  AU: { lat: -25.2744, lng: 133.7751, zoom: 3.4 },
  AE: { lat: 23.4241, lng: 53.8478, zoom: 5.8 },
  SA: { lat: 23.8859, lng: 45.0792, zoom: 4.6 },
  MY: { lat: 4.2105, lng: 101.9758, zoom: 5.4 },
  ID: { lat: -2.5489, lng: 118.0149, zoom: 4 },
  PH: { lat: 12.8797, lng: 121.774, zoom: 5 },
  KE: { lat: -0.0236, lng: 37.9062, zoom: 5.4 },
  ZA: { lat: -30.5595, lng: 22.9375, zoom: 4.4 },
  NG: { lat: 9.082, lng: 8.6753, zoom: 5 },
};

/** Division centres, so selecting a division moves the map without recreating it. */
const DIVISION_CENTRES: Record<string, { lat: number; lng: number }> = {
  Dhaka: { lat: 23.8103, lng: 90.4125 },
  Chattogram: { lat: 22.3569, lng: 91.7832 },
  Rajshahi: { lat: 24.3745, lng: 88.6042 },
  Khulna: { lat: 22.8456, lng: 89.5403 },
  Barishal: { lat: 22.701, lng: 90.3535 },
  Sylhet: { lat: 24.8949, lng: 91.8687 },
  Rangpur: { lat: 25.7439, lng: 89.2752 },
  Mymensingh: { lat: 24.7471, lng: 90.4203 },
};

export function areaCentre(countryCode: string, division?: string) {
  if (countryCode.toUpperCase() === "BD" && division) {
    const centre = DIVISION_CENTRES[division];
    if (centre) return { ...centre, zoom: 8.2 };
  }
  return COUNTRY_CENTRES[countryCode.toUpperCase()] ?? { lat: 23.685, lng: 90.3563, zoom: 4.2 };
}

/** Ordering choices offered above the results. */
export const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "nearest", label: "Nearest first" },
  { value: "verified", label: "Verified contacts first" },
  { value: "government", label: "Government hospitals" },
  { value: "private", label: "Private hospitals" },
  { value: "recent", label: "Recently verified" },
] as const;
