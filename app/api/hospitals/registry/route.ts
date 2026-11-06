import {
  REGISTRY_SORTS,
  districtsFor,
  divisionsFor,
  registryCountries,
  registrySearch,
  registrySummary,
  upazilasFor,
  type RegistrySort,
} from "@/lib/hospitals/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RADII = [2, 5, 10, 25, 50];
const SORT_VALUES = new Set<string>(REGISTRY_SORTS.map((entry) => entry.value));

/**
 * Global hospital directory search.
 *
 * `mode=nearby` needs a real coordinate and sorts by distance; without one it
 * returns an empty set and says why, rather than guessing a location.
 * `mode=region` is the directory, scoped by country (and optionally by the
 * three administrative levels that country publishes).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const mode = params.get("mode") === "nearby" ? "nearby" : "region";
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const hasPoint =
    params.has("lat") &&
    params.has("lng") &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  const radiusRaw = Number(params.get("radius") ?? "10");
  const radiusKm = RADII.includes(radiusRaw) ? radiusRaw : 10;

  const rawCountry = (params.get("country") ?? "").trim().toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : undefined;
  const division = (params.get("division") ?? "").trim();
  const district = (params.get("district") ?? "").trim();
  const upazila = (params.get("upazila") ?? "").trim();
  const rawSort = (params.get("sort") ?? "").trim();
  const sort: RegistrySort = SORT_VALUES.has(rawSort) ? (rawSort as RegistrySort) : "recommended";

  const result = registrySearch({
    mode,
    countryCode,
    division: division || undefined,
    q: (params.get("q") ?? "").trim() || undefined,
    district: district || undefined,
    upazila: upazila || undefined,
    category: (params.get("category") ?? "").trim() || undefined,
    ownership: (params.get("ownership") ?? "").trim() || undefined,
    sort,
    lat: hasPoint ? lat : undefined,
    lng: hasPoint ? lng : undefined,
    radiusKm,
    page: Number(params.get("page") ?? 1),
    pageSize: Number(params.get("pageSize") ?? 24),
  });

  return Response.json(
    {
      ...result,
      summary: registrySummary(countryCode),
      countries: registryCountries(),
      divisions: divisionsFor(countryCode),
      districts: districtsFor(division || undefined, countryCode),
      upazilas: district ? upazilasFor(district, countryCode) : [],
      message:
        mode === "nearby" && !hasPoint
          ? "Share your location to search by distance, or browse the full country directory."
          : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
