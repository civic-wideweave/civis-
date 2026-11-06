import type { Metadata } from "next";
import { HospitalDirectory } from "@/components/hospitals/hospital-directory";
import { getCurrentUser } from "@/lib/auth";
import {
  DEPARTMENT_OPTIONS,
  FACILITY_CATEGORIES,
  districtsFor,
  divisionsFor,
  registryCountries,
  registrySearch,
  registrySummary,
} from "@/lib/hospitals/registry";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hospital directory",
  description:
    "Find hospitals near you, across all eight divisions of Bangladesh, or in another country, with verified contacts and direct calling.",
};

export default async function HospitalsPage() {
  const user = await getCurrentUser();
  const initial = registrySearch({ mode: "region", countryCode: "BD", pageSize: 24 });
  const summary = registrySummary("BD");

  const canManage =
    user?.role === "admin" || (user?.role === "authority" && user.org_status === "approved");

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-20 pt-28 sm:px-6">
      <HospitalDirectory
        initial={{
          items: initial.items,
          total: initial.total,
          page: initial.page,
          asOf: initial.asOf,
          divisions: divisionsFor("BD"),
          districts: districtsFor(undefined, "BD"),
          countries: registryCountries(),
        }}
        summary={summary}
        categories={FACILITY_CATEGORIES}
        departments={DEPARTMENT_OPTIONS}
        canManage={canManage}
      />
    </div>
  );
}
