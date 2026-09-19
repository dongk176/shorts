import { redirect } from "next/navigation";
import { localizedRedirectPath } from "@/lib/i18n/server";

export default async function LegacyPricingTwoPage() {
  redirect(await localizedRedirectPath("/pricing"));
}
