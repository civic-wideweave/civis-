"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BedDouble, Check, Globe2, MapPin, Navigation, Phone, RotateCcw, Search, Stethoscope } from "lucide-react";
import type { RegistryContact, RegistryFacility, RegistrySort, RegistrySummary } from "@/lib/hospitals/registry";
import {
  BANGLADESH_DIVISIONS,
  SORT_OPTIONS,
  SUPPORTED_COUNTRY_CODES,
  adminLabels,
  areaCentre,
} from "@/lib/hospitals/hierarchy";
import { COUNTRIES } from "@/lib/emergency/countries";
import { useGeolocation } from "@/lib/map/geolocation";
import { Spinner, cx } from "@/components/ui";
import HospitalMap from "./hospital-map";

type Category = { value: string; label: string };
type Department = { code: string; name: string; group: RegistryContact["contactGroup"] };
type Mode = "nearby" | "bangladesh" | "worldwide";

type Result = {
  items: RegistryFacility[];
  total: number;
  page: number;
  asOf: string | null;
  upazilas: string[];
  divisions: { division: string; count: number }[];
  districts: string[];
  countries: { code: string; name: string; count: number }[];
  message: string | null;
};

const PAGE_SIZE = 24;
const RADII = [2, 5, 10, 25, 50];

const DISCLAIMER =
  "Current bed availability has not been confirmed through CIVIS. Please contact the hospital directly to confirm availability before travelling.";

const GROUP_LABELS: Record<RegistryContact["contactGroup"], string> = {
  general: "General hospital contacts",
  emergency: "Emergency medical contacts",
  department: "Medical departments",
  diagnostic: "Diagnostic and support services",
  support: "Support services",
};

const MODES: { value: Mode; label: string; hint: string; icon: typeof MapPin }[] = [
  { value: "nearby", label: "Near me", hint: "Hospitals around your current location", icon: Navigation },
  { value: "bangladesh", label: "Bangladesh", hint: "Every division, district and upazila", icon: MapPin },
  { value: "worldwide", label: "Worldwide", hint: "Choose any supported country", icon: Globe2 },
];

/** Phone link is only produced from a number that resolves to a dial target. */
function telHref(contact: { phone: string; phoneE164: string | null }): string | null {
  if (contact.phoneE164 && /^\+\d{7,15}$/.test(contact.phoneE164)) return `tel:${contact.phoneE164}`;
  const digits = contact.phone.replace(/\D/g, "");
  if (/^01\d{9}$/.test(digits)) return `tel:+88${digits}`;
  if (/^8801\d{9}$/.test(digits)) return `tel:+${digits}`;
  if (/^0\d{8,9}$/.test(digits)) return `tel:+880${digits.slice(1)}`;
  if (digits.length >= 7 && digits.length <= 15) return `tel:+${digits}`;
  return null;
}

function facilityTel(facility: RegistryFacility): string | null {
  if (!facility.phone) return null;
  return telHref({ phone: facility.phone, phoneE164: null });
}

/** Fixed locale and zone so the server-rendered date matches the browser. */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function HospitalDirectory({
  initial,
  summary,
  categories,
  departments,
  canManage,
}: {
  initial: {
    items: RegistryFacility[];
    total: number;
    page: number;
    asOf: string | null;
    divisions: { division: string; count: number }[];
    districts: string[];
    countries: { code: string; name: string; count: number }[];
  };
  summary: RegistrySummary;
  categories: Category[];
  departments: Department[];
  canManage: boolean;
}) {
  const geo = useGeolocation();

  const [mode, setMode] = useState<Mode>("bangladesh");
  const [countryCode, setCountryCode] = useState("BD");
  const [countrySearch, setCountrySearch] = useState("");
  const [q, setQ] = useState("");
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [category, setCategory] = useState("");
  const [ownership, setOwnership] = useState("");
  const [sort, setSort] = useState<RegistrySort>("recommended");
  const [radius, setRadius] = useState(10);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "map">("list");

  const [result, setResult] = useState<Result>({
    items: initial.items,
    total: initial.total,
    page: initial.page,
    asOf: initial.asOf,
    upazilas: [],
    divisions: initial.divisions,
    districts: initial.districts,
    countries: initial.countries,
    message: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ facility: RegistryFacility; contacts: RegistryContact[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [form, setForm] = useState({ departmentCode: "", phone: "", operatingHours: "", source: "", verified: false });
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const labelFor = useMemo(() => {
    const map = new Map(categories.map((entry) => [entry.value, entry.label]));
    return (value: string) => map.get(value) ?? value;
  }, [categories]);

  const labels = adminLabels(countryCode || "BD");
  const fix = geo.fix;
  const selectedCountry = COUNTRIES.find((entry) => entry.code === countryCode) ?? null;

  const countryCounts = useMemo(
    () => new Map(result.countries.map((entry) => [entry.code, entry.count])),
    [result.countries],
  );

  /**
   * Countries with imported records first, then countries whose hierarchy CIVIS
   * names explicitly, then the rest alphabetically. Otherwise India, the United
   * States and the United Kingdom would be buried behind territories.
   */
  const countryOptions = useMemo(() => {
    const term = countrySearch.trim().toLowerCase();
    const rank = (entry: { code: string; count: number }) =>
      entry.count > 0 ? 0 : SUPPORTED_COUNTRY_CODES.has(entry.code) ? 1 : 2;
    return COUNTRIES.map((entry) => ({ ...entry, count: countryCounts.get(entry.code) ?? 0 }))
      .filter((entry) => !term || `${entry.name} ${entry.code}`.toLowerCase().includes(term))
      .sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [countryCounts, countrySearch]);

  const divisionOptions = useMemo(() => {
    const counts = new Map(result.divisions.map((entry) => [entry.division, entry.count]));
    if (!countryCode || countryCode === "BD") {
      // The eight official divisions are always offered, even while empty, so a
      // division without imported records is selectable and explains itself.
      return BANGLADESH_DIVISIONS.map((name) => ({ name, count: counts.get(name) ?? 0 }));
    }
    return result.divisions.map((entry) => ({ name: entry.division, count: entry.count }));
  }, [result.divisions, countryCode]);

  // Search whenever the mode, location, filters, page or the user's fix changes.
  useEffect(() => {
    if (mode === "nearby" && !fix) {
      setResult((current) => ({
        ...current,
        items: [],
        total: 0,
        message: "Share your location to search by distance, or choose Bangladesh to browse the full directory.",
      }));
      return;
    }

    // Worldwide browsing starts with an explicit country choice.
    if (mode === "worldwide" && !countryCode) {
      setResult((current) => ({ ...current, items: [], total: 0, message: null }));
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        // The map draws everything it is given, so ask for a larger page there.
        // Switching back to the list restores pagination at PAGE_SIZE.
        const params = new URLSearchParams({
          mode: mode === "nearby" ? "nearby" : "region",
          page: String(page),
          pageSize: String(view === "map" ? 200 : PAGE_SIZE),
          sort,
        });
        if (mode !== "nearby" && countryCode) params.set("country", countryCode);
        if (q.trim()) params.set("q", q.trim());
        if (mode !== "nearby") {
          if (division) params.set("division", division);
          if (district) params.set("district", district);
          if (upazila) params.set("upazila", upazila);
        }
        if (category) params.set("category", category);
        if (ownership) params.set("ownership", ownership);
        // With a fix, every mode can show distance (and "nearest first" works
        // nationwide); only the nearby mode applies a radius.
        if (fix) {
          params.set("lat", String(fix.lat));
          params.set("lng", String(fix.lng));
          if (mode === "nearby") params.set("radius", String(radius));
        }
        const response = await fetch(`/api/hospitals/registry?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error("The hospital directory could not be loaded.");
        const data = (await response.json()) as Result;
        setResult(data);
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") {
          setError(caught instanceof Error ? caught.message : "The hospital directory could not be loaded.");
        }
      } finally {
        setLoading(false);
      }
    }, 260);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [mode, countryCode, q, division, district, upazila, category, ownership, sort, radius, page, fix, view]);

  // Detail fetch, with the user's distance when one is known.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    const query = fix ? `?lat=${fix.lat}&lng=${fix.lng}` : "";
    fetch(`/api/hospitals/registry/${selectedId}${query}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Could not load this facility."))))
      .then((data: { facility: RegistryFacility; contacts: RegistryContact[] }) => setDetail(data))
      .catch((caught: Error) => {
        if (caught.name !== "AbortError") setError(caught.message);
      })
      .finally(() => setDetailLoading(false));
    return () => controller.abort();
  }, [selectedId, fix]);

  function clearRegion() {
    setDivision("");
    setDistrict("");
    setUpazila("");
    setPage(1);
  }

  function pickMode(next: Mode) {
    setMode(next);
    setPage(1);
    setSelectedId(null);
    setQ("");
    setDivision("");
    setDistrict("");
    setUpazila("");
    if (next === "bangladesh") setCountryCode("BD");
    if (next === "worldwide") {
      setCountryCode("");
      setCountrySearch("");
    }
    if (next === "nearby" && !fix && geo.state !== "detecting") void geo.locate();
  }

  function resetFilters() {
    setMode("bangladesh");
    setCountryCode("BD");
    setCountrySearch("");
    setQ("");
    setDivision("");
    setDistrict("");
    setUpazila("");
    setCategory("");
    setOwnership("");
    setSort("recommended");
    setPage(1);
    setSelectedId(null);
  }

  const copyNumber = useCallback(async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(phone);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setCopied(null);
    }
  }, []);

  async function saveContact(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setSaving(true);
    setFormMessage(null);
    try {
      const response = await fetch(`/api/hospitals/registry/${selectedId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentCode: form.departmentCode,
          phone: form.phone,
          operatingHours: form.operatingHours || null,
          source: form.source,
          verificationStatus: form.verified ? "verified" : "unverified",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The contact could not be saved.");
      setDetail(data.facility);
      setForm({ departmentCode: "", phone: "", operatingHours: "", source: "", verified: false });
      setFormMessage("Contact saved.");
    } catch (caught) {
      setFormMessage(caught instanceof Error ? caught.message : "The contact could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const placedCount = result.items.filter((item) => item.lat !== null && item.lng !== null).length;
  const mapCentre = useMemo(() => areaCentre(countryCode || "BD", division || undefined), [countryCode, division]);
  const areaLabel =
    mode === "nearby"
      ? "your current location"
      : [selectedCountry?.name, division, district, upazila].filter(Boolean).join(" · ") || "Bangladesh";
  const focusKey = `${mode}:${countryCode}:${division}:${district}:${upazila}`;
  const filtersActive = Boolean(q || division || district || upazila || category || ownership || sort !== "recommended");
  const awaitingCountry = mode === "worldwide" && !countryCode;

  const emptyMessage = awaitingCountry
    ? "Choose a country above to browse its hospitals."
    : mode === "nearby"
      ? "No hospital with a published coordinate is within this radius. Try a wider radius, or switch to Bangladesh to browse the full listing."
      : !q && (division || district || upazila || mode === "worldwide")
        ? "No hospital records are currently available for this region."
        : "No facility matches these filters. Clear a filter, or reset to all available hospitals in Bangladesh.";

  return (
    <div>
      <header className="border-b border-white/10 pb-5">
        <h1 className="text-[clamp(1.7rem,3.4vw,2.5rem)] font-semibold leading-tight">Hospital directory</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Find hospitals near you, anywhere in Bangladesh, or in another country. Every record comes from an imported
          official dataset, and facilities that have no imported region are called out instead of filled in.
        </p>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[11.5px] text-muted">
          <div>
            <dt className="inline">Countries with records: </dt>
            <dd className="inline font-semibold text-fg">{summary.countries.length.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="inline">Bangladesh records: </dt>
            <dd className="inline font-semibold text-fg">{summary.total.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="inline">With a verified coordinate: </dt>
            <dd className="inline font-semibold text-fg">{summary.withCoordinates.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="inline">Last import: </dt>
            <dd className="inline text-fg">
              {summary.lastImportAt ? formatDate(summary.lastImportAt) : "never"}
            </dd>
          </div>
          <div>
            <dt className="inline">Source: </dt>
            <dd className="inline text-fg">DGHS Health Facility Registry</dd>
          </div>
        </dl>
      </header>

      {/* location selector */}
      <section className="mt-5 rounded-2xl border border-white/10 bg-ink-soft/50 p-3 sm:p-4" aria-label="Choose a location">
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map(({ value, label, hint, icon: Icon }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => pickMode(value)}
                className={cx(
                  "flex min-h-[68px] items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                  active
                    ? "border-accent/60 bg-accent/[0.09]"
                    : "border-white/10 bg-white/[0.02] hover:border-white/25",
                )}
              >
                <span
                  className={cx(
                    "mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg",
                    active ? "bg-accent/15 text-accent" : "bg-white/[0.05] text-muted",
                  )}
                  aria-hidden
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className={cx("block text-[12.5px] font-semibold", active ? "text-fg" : "text-fg/80")}>
                    {label}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-relaxed text-muted">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {mode === "nearby" && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void geo.locate()}
                disabled={geo.state === "detecting"}
                className="flex min-h-11 items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 text-[12px] font-semibold text-accent disabled:opacity-60"
              >
                {geo.state === "detecting" ? <Spinner className="size-3.5" /> : <Navigation size={14} aria-hidden />}
                {fix ? "Update my location" : "Use my location"}
              </button>
              <span className="text-[11.5px] text-muted">Within</span>
              {RADII.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setRadius(value);
                    setPage(1);
                  }}
                  aria-pressed={radius === value}
                  className={cx(
                    "min-h-9 rounded-full border px-3 text-[11.5px]",
                    radius === value ? "border-accent/50 bg-accent/10 text-accent" : "border-white/10 text-muted hover:text-fg",
                  )}
                >
                  {value} km
                </button>
              ))}
            </div>
            {geo.state !== "idle" && (
              <p className={`mt-2 text-[11.5px] ${geo.state === "found" ? "text-mint" : "text-warn"}`}>
                {geo.state === "found" && fix
                  ? `Using ${fix.lat.toFixed(4)}, ${fix.lng.toFixed(4)}${fix.accuracy ? ` · ±${Math.round(fix.accuracy)} m` : ""}`
                  : geo.state === "detecting"
                    ? "Finding your location…"
                    : "Location unavailable. Allow location access, or browse by country instead."}
              </p>
            )}
          </div>
        )}

        {mode === "bangladesh" && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <select
              value={division}
              onChange={(event) => {
                setDivision(event.target.value);
                setDistrict("");
                setUpazila("");
                setPage(1);
              }}
              aria-label="Filter by division"
              className="h-11 rounded-xl border border-white/10 bg-ink px-3 text-[12.5px] text-fg"
            >
              <option value="">All divisions</option>
              {divisionOptions.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name} ({entry.count.toLocaleString()})
                </option>
              ))}
            </select>
            <select
              value={district}
              onChange={(event) => {
                setDistrict(event.target.value);
                setUpazila("");
                setPage(1);
              }}
              aria-label="Filter by district"
              disabled={!division}
              className="h-11 rounded-xl border border-white/10 bg-ink px-3 text-[12.5px] text-fg disabled:opacity-50"
            >
              <option value="">All districts</option>
              {result.districts.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={upazila}
              onChange={(event) => {
                setUpazila(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by upazila"
              disabled={!district}
              className="h-11 rounded-xl border border-white/10 bg-ink px-3 text-[12.5px] text-fg disabled:opacity-50"
            >
              <option value="">All upazilas</option>
              {result.upazilas.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === "worldwide" && (
          <div className="mt-3">
            {countryCode ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex min-h-9 items-center gap-2 rounded-full border border-accent/35 bg-accent/[0.08] px-3 text-[12px] font-semibold text-fg">
                    <span aria-hidden>{selectedCountry?.flag ?? "🏳"}</span>
                    {selectedCountry?.name ?? countryCode}
                    <span className="text-[10.5px] font-normal text-muted">
                      {countryCounts.get(countryCode)?.toLocaleString() ?? 0} records
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCountryCode("");
                      setCountrySearch("");
                      clearRegion();
                      setSelectedId(null);
                    }}
                    className="min-h-9 rounded-full border border-white/15 px-3 text-[11.5px] text-muted hover:text-fg"
                  >
                    Change country
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                    <select
                      value={division}
                      onChange={(event) => {
                        setDivision(event.target.value);
                        setDistrict("");
                        setUpazila("");
                        setPage(1);
                      }}
                      aria-label={`Filter by ${labels.level1.toLowerCase()}`}
                      disabled={divisionOptions.length === 0}
                      className="h-11 rounded-xl border border-white/10 bg-ink px-3 text-[12.5px] text-fg disabled:opacity-50"
                    >
                      <option value="">All {labels.level1.toLowerCase()}s</option>
                      {divisionOptions.map((entry) => (
                        <option key={entry.name} value={entry.name}>
                          {entry.name} ({entry.count.toLocaleString()})
                        </option>
                      ))}
                    </select>
                    <select
                      value={district}
                      onChange={(event) => {
                        setDistrict(event.target.value);
                        setUpazila("");
                        setPage(1);
                      }}
                      aria-label={`Filter by ${labels.level2.toLowerCase()}`}
                      disabled={!division}
                      className="h-11 rounded-xl border border-white/10 bg-ink px-3 text-[12.5px] text-fg disabled:opacity-50"
                    >
                      <option value="">All {labels.level2.toLowerCase()}s</option>
                      {result.districts.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={upazila}
                      onChange={(event) => {
                        setUpazila(event.target.value);
                        setPage(1);
                      }}
                      aria-label={`Filter by ${labels.level3.toLowerCase()}`}
                      disabled={!district}
                      className="h-11 rounded-xl border border-white/10 bg-ink px-3 text-[12.5px] text-fg disabled:opacity-50"
                    >
                      <option value="">All {labels.level3.toLowerCase()}s</option>
                      {result.upazilas.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                </div>
                {divisionOptions.length === 0 && (
                  <p className="text-[10.5px] text-muted">
                    No {labels.level1.toLowerCase()} list is available for this country yet. Import a dataset to
                    populate its {labels.level1.toLowerCase()} → {labels.level2.toLowerCase()} → {labels.level3.toLowerCase()} hierarchy.
                  </p>
                )}
                {!countryCounts.get(countryCode) && (
                  <p className="rounded-xl border border-warn/25 bg-warn/[0.05] p-3 text-[11.5px] leading-relaxed text-warn">
                    No hospital records are currently available for this region. An international dataset can be
                    imported with <code className="font-mono">npm run hospitals:import -- --file=dataset.json</code>;
                    CIVIS does not create facilities to fill the gap.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-3 top-3.5 text-muted" aria-hidden />
                  <input
                    value={countrySearch}
                    onChange={(event) => setCountrySearch(event.target.value)}
                    placeholder="Search any country by name or code…"
                    aria-label="Search countries"
                    className="h-11 w-full rounded-xl border border-white/10 bg-ink pl-9 pr-3 text-[12.5px] text-fg placeholder:text-muted focus:border-accent/50 focus:outline-none"
                  />
                </div>
                <div className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                  {countryOptions.map((entry) => (
                    <button
                      key={entry.code}
                      type="button"
                      onClick={() => {
                        setCountryCode(entry.code);
                        setDistrict("");
                        setUpazila("");
                        setDivision("");
                        setPage(1);
                        setSelectedId(null);
                      }}
                      className="flex min-h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 text-left text-[12px] hover:border-accent/40 hover:bg-accent/[0.06]"
                    >
                      <span aria-hidden>{entry.flag}</span>
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className={cx("text-[10px]", entry.count > 0 ? "text-mint" : "text-muted")}>
                        {entry.count > 0 ? entry.count.toLocaleString() : "—"}
                      </span>
                    </button>
                  ))}
                  {countryOptions.length === 0 && (
                    <p className="col-span-full p-3 text-[12px] text-muted">
                      No country matches “{countrySearch}”. Try another name or ISO code.
                    </p>
                  )}
                </div>
                <p className="mt-1.5 text-[10.5px] text-muted">
                  {result.countries.length} {result.countries.length === 1 ? "country has" : "countries have"} imported
                  records. Selecting any other country shows that its dataset is not available yet.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* filters */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
          placeholder="Search name, division, district, upazila or type…"
          aria-label="Search hospitals"
          className="h-10 rounded-xl border border-white/10 bg-ink-soft px-3 text-[12.5px] text-fg placeholder:text-muted focus:border-accent/50 focus:outline-none sm:col-span-2"
        />
        <select
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by facility type"
          className="h-10 rounded-xl border border-white/10 bg-ink-soft px-2 text-[12.5px] text-fg"
        >
          <option value="">All facility types</option>
          {categories.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
        <select
          value={ownership}
          onChange={(event) => {
            setOwnership(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by ownership"
          className="h-10 rounded-xl border border-white/10 bg-ink-soft px-2 text-[12.5px] text-fg"
        >
          <option value="">Government and private</option>
          <option value="public">Government</option>
          <option value="private">Private</option>
        </select>
        <select
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as RegistrySort);
            setPage(1);
          }}
          aria-label="Sort results"
          className="h-10 rounded-xl border border-white/10 bg-ink-soft px-2 text-[12.5px] text-fg sm:col-span-2"
        >
          {SORT_OPTIONS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              Sort: {entry.label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2 sm:col-span-2">
          <button
            type="button"
            onClick={resetFilters}
            className="flex min-h-10 items-center gap-1.5 rounded-xl border border-white/10 px-3 text-[11.5px] text-muted hover:text-fg"
          >
            <RotateCcw size={13} aria-hidden />
            Reset filters
          </button>
          <span className="truncate text-[11px] text-muted">
            {awaitingCountry
              ? "Worldwide · choose a country"
              : mode === "nearby"
                ? `Near me${fix ? " · " + radius + " km" : ""}`
                : `${selectedCountry?.name ?? "Bangladesh"}${division ? " · " + division : ""}${district ? " · " + district : ""}${upazila ? " · " + upazila : ""}`}
            {filtersActive ? " · filtered" : ""}
          </span>
          <div className="ml-auto flex rounded-full border border-white/10 p-0.5">
            {(["list", "map"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setView(value);
                  if (value === "map") setPage(1);
                }}
                aria-pressed={view === value}
                className={cx(
                  "rounded-full px-3 py-1.5 text-[12px] font-medium capitalize",
                  view === value ? "bg-white/10 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {value === "list" ? "List" : "Map"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* result meta */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
        {!awaitingCountry && (
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1">
            {loading ? "Searching…" : `${result.total.toLocaleString()} matching record${result.total === 1 ? "" : "s"}`}
          </span>
        )}
        {view === "map" && (
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1">
            {placedCount} of {result.items.length} loaded with a location
            {result.total > result.items.length ? ` · first ${result.items.length.toLocaleString()} of ${result.total.toLocaleString()}` : ""}
          </span>
        )}
        {result.asOf && (
          <span className="rounded-full bg-white/[0.06] px-2.5 py-1">
            Data as of {formatDate(result.asOf)}
          </span>
        )}
        {result.message && <span className="text-warn">{result.message}</span>}
        {error && <span className="text-crit">{error}</span>}
      </div>

      {view === "map" && (
        <div className="mt-4">
          <HospitalMap
            hospitals={result.items.map((item) => ({
              id: item.id,
              name: item.name,
              lat: item.lat,
              lng: item.lng,
              category: item.category,
            }))}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setView("list");
            }}
            fix={fix}
            center={mapCentre}
            areaLabel={areaLabel}
            focusKey={focusKey}
          />
        </div>
      )}

      {/* selected facility */}
      {selectedId && (
        <section className="mt-5 rounded-2xl border border-accent/25 bg-accent/[0.04] p-4 sm:p-5" aria-live="polite">
          {detailLoading && !detail ? (
            <div className="grid h-24 place-items-center">
              <Spinner />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-semibold leading-snug">{detail.facility.name}</h2>
                  {detail.facility.nameBn && <p className="text-[13px] text-muted">{detail.facility.nameBn}</p>}
                  <p className="mt-1 text-[11.5px] text-muted">
                    {labelFor(detail.facility.category)}
                    {detail.facility.ownership ? ` · ${detail.facility.ownership === "private" ? "Private" : "Government"}` : ""}
                    {detail.facility.agency ? ` · ${detail.facility.agency}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-muted hover:text-fg"
                >
                  Close
                </button>
              </div>

              <dl className="grid gap-x-4 gap-y-1.5 text-[11.5px] sm:grid-cols-2">
                {[
                  ["Country", detail.facility.country],
                  [adminLabels(detail.facility.countryCode).level1, detail.facility.division],
                  [adminLabels(detail.facility.countryCode).level2, detail.facility.district],
                  [adminLabels(detail.facility.countryCode).level3, detail.facility.upazila],
                  ["City corporation", detail.facility.cityCorporation],
                  ["Address", detail.facility.address ?? "Not published by the source"],
                  ["Facility type", detail.facility.facilityType],
                  ["Status in registry", detail.facility.active],
                  ["Distance", detail.facility.distanceKm !== null ? `${detail.facility.distanceKm} km` : "Unknown (no verified coordinate)"],
                ].map(([key, value]) => (
                  <div key={key as string} className="flex justify-between gap-3 border-b border-white/[0.05] py-1">
                    <dt className="text-muted">{key}</dt>
                    <dd className="text-right text-fg">{value ?? "Not recorded"}</dd>
                  </div>
                ))}
              </dl>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-ink/50 p-3 text-[11.5px]">
                  <p className="flex items-center gap-1.5 font-semibold text-fg">
                    <BedDouble size={13} aria-hidden /> Reported bed availability
                  </p>
                  <p className="mt-1 text-muted">No verified bed report has been published for this facility.</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-ink/50 p-3 text-[11.5px]">
                  <p className="flex items-center gap-1.5 font-semibold text-fg">
                    <Stethoscope size={13} aria-hidden /> Medical services
                  </p>
                  <p className="mt-1 text-muted">No verified service report has been published for this facility.</p>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted">
                Coordinate:{" "}
                {detail.facility.lat !== null && detail.facility.lng !== null
                  ? `${detail.facility.lat.toFixed(5)}, ${detail.facility.lng.toFixed(5)} (${detail.facility.locationStatus})`
                  : "not published by the registry and not yet verified by CIVIS"}
                . Source:{" "}
                <a href={detail.facility.sourceUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                  {detail.facility.source}
                </a>
                .
              </p>

              <div className="rounded-xl border border-warn/25 bg-warn/[0.05] p-3 text-[11.5px] leading-relaxed text-warn">
                {DISCLAIMER}
              </div>

              {detail.contacts.length === 0 ? (
                <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[11.5px] text-muted">
                  No published contact number is available for this facility. CIVIS does not display a number it cannot
                  attribute to a source.
                </p>
              ) : (
                <div className="space-y-3">
                  {(["emergency", "general", "department", "diagnostic", "support"] as const).map((group) => {
                    const rows = detail.contacts.filter((contact) => contact.contactGroup === group);
                    if (!rows.length) return null;
                    return (
                      <div key={group}>
                        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.14em] text-muted">
                          {GROUP_LABELS[group]}
                        </h3>
                        <ul className="space-y-1.5">
                          {rows.map((contact) => {
                            const href = telHref(contact);
                            return (
                              <li
                                key={contact.id}
                                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink/60 px-3 py-2"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[12px] text-fg">{contact.departmentName}</span>
                                  <span className="block font-mono text-[11.5px] text-muted">{contact.phone}</span>
                                  <span className="block text-[10px] text-muted">
                                    {contact.verificationStatus === "verified"
                                      ? `Verified${contact.lastVerifiedAt ? ` ${formatDate(contact.lastVerifiedAt)}` : ""}`
                                      : contact.verificationStatus === "registry"
                                        ? "Official registry number — not independently verified by CIVIS"
                                        : "Reported — not verified"}
                                    {contact.operatingHours ? ` · ${contact.operatingHours}` : ""}
                                  </span>
                                </span>
                                {href ? (
                                  <a
                                    href={href}
                                    className="rounded-full bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-ink"
                                  >
                                    Call now
                                  </a>
                                ) : (
                                  <span className="text-[10.5px] text-warn">No dialable number</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void copyNumber(contact.phone)}
                                  className="rounded-full border border-white/15 px-2.5 py-1.5 text-[11px] text-muted hover:text-fg"
                                >
                                  {copied === contact.phone ? "Copied" : "Copy"}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Link
                  href={{ pathname: "/emergency", hash: "nearby-hospitals" }}
                  className="rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] text-muted hover:text-fg"
                >
                  Nearby hospitals
                </Link>
                {detail.facility.lat !== null && detail.facility.lng !== null && (
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${detail.facility.lat}&mlon=${detail.facility.lng}#map=16/${detail.facility.lat}/${detail.facility.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] text-muted hover:text-fg"
                  >
                    Open in OpenStreetMap
                  </a>
                )}
                <a
                  href="https://hris.mohfw.gov.bd/public/facility-registry/"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/15 px-3 py-1.5 text-[11.5px] text-muted hover:text-fg"
                >
                  Report incorrect information
                </a>
              </div>

              {canManage && (
                <form onSubmit={saveContact} className="space-y-2 rounded-xl border border-white/10 bg-ink/60 p-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[.14em] text-muted">
                    Publish a department contact
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      value={form.departmentCode}
                      onChange={(event) => setForm((current) => ({ ...current, departmentCode: event.target.value }))}
                      aria-label="Department"
                      className="h-9 rounded-lg border border-white/10 bg-ink-soft px-2 text-[12px] text-fg"
                    >
                      <option value="">Choose a department</option>
                      {departments.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                          {entry.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={form.phone}
                      onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                      placeholder="Phone, e.g. 01712 345678"
                      aria-label="Phone number"
                      className="h-9 rounded-lg border border-white/10 bg-ink-soft px-2 text-[12px] text-fg"
                    />
                    <input
                      value={form.operatingHours}
                      onChange={(event) => setForm((current) => ({ ...current, operatingHours: event.target.value }))}
                      placeholder="Operating hours (optional)"
                      aria-label="Operating hours"
                      className="h-9 rounded-lg border border-white/10 bg-ink-soft px-2 text-[12px] text-fg"
                    />
                    <input
                      value={form.source}
                      onChange={(event) => setForm((current) => ({ ...current, source: event.target.value }))}
                      placeholder="Source checked"
                      aria-label="Source"
                      className="h-9 rounded-lg border border-white/10 bg-ink-soft px-2 text-[12px] text-fg"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-[11.5px] text-muted">
                    <input
                      type="checkbox"
                      checked={form.verified}
                      onChange={(event) => setForm((current) => ({ ...current, verified: event.target.checked }))}
                      className="size-4 accent-accent"
                    />
                    I confirmed this number with the facility
                  </label>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-ink disabled:opacity-60"
                  >
                    {saving ? "Saving…" : "Save contact"}
                  </button>
                  {formMessage && <p className="text-[11px] text-muted">{formMessage}</p>}
                </form>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-muted">This facility could not be loaded.</p>
          )}
        </section>
      )}

      {/* list */}
      <ul className="mt-5 space-y-2">
        {result.items.map((item) => {
          const hasLocation = item.lat !== null && item.lng !== null;
          const call = facilityTel(item);
          return (
            <li key={item.id}>
              <div
                className={cx(
                  "rounded-xl border p-3.5 transition-colors",
                  selectedId === item.id ? "border-accent/40 bg-accent/[0.05]" : "border-white/10 bg-ink-soft/60",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted">
                        {labelFor(item.category)}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted">
                        {item.ownership === "private" ? "Private" : item.ownership === "public" ? "Government" : "Ownership not recorded"}
                      </span>
                      {item.verifiedContactCount > 0 ? (
                        <span className="flex items-center gap-1 rounded-full border border-mint/30 bg-mint/10 px-2 py-0.5 text-[10px] text-mint">
                          <Check size={10} aria-hidden /> Verified contact
                        </span>
                      ) : item.phone ? (
                        <span className="rounded-full border border-accent/25 bg-accent/[0.07] px-2 py-0.5 text-[10px] text-accent">
                          Registry number
                        </span>
                      ) : (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-muted">
                          No published number
                        </span>
                      )}
                      {item.distanceKm !== null && (
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-muted">
                          {item.distanceKm} km away
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1.5 text-[13.5px] font-medium leading-snug">{item.name}</h2>
                    {item.nameBn && <p className="text-[11px] text-muted">{item.nameBn}</p>}
                    <p className="mt-0.5 text-[11px] text-muted">
                      {[item.facilityType, item.upazila, item.district, item.division].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-0.5 text-[10.5px] text-muted">
                      {item.address || "Street address not published by the source"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-muted">
                      <span className="inline-flex items-center gap-1">
                        <BedDouble size={12} aria-hidden /> Bed availability not reported
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Stethoscope size={12} aria-hidden /> Medical services not reported
                      </span>
                      {!hasLocation && <span className="text-warn">Location unavailable</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className="min-h-9 rounded-full border border-white/15 px-2.5 text-[11px] text-muted hover:text-fg"
                    >
                      View details
                    </button>
                    {call && item.phone && (
                      <a
                        href={call}
                        className="flex min-h-9 items-center gap-1 rounded-full bg-accent px-2.5 text-[11px] font-semibold text-ink"
                      >
                        <Phone size={11} aria-hidden /> Call
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {result.items.length === 0 && !loading && (
        <p className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5 text-center text-[12.5px] text-muted">
          {emptyMessage}
        </p>
      )}

      {pages > 1 && view === "list" && (
        <div className="mt-5 flex items-center justify-center gap-3 text-[12px] text-muted">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className="rounded-full border border-white/15 px-3 py-1.5 disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
            className="rounded-full border border-white/15 px-3 py-1.5 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-muted">
        Imported from the DGHS Health Facility Registry. A registry listing does not confirm that a facility is
        operating, that a number still works, or that a bed is free. CIVIS publishes no availability figure it has not
        received from a verified source.
      </p>
    </div>
  );
}
