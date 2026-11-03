import { requireAdminUser } from "@/lib/admin";
import { PayPalConfigurationPanel } from "./panel";
export const dynamic='force-dynamic';
export default async function PayPalConfigurationPage(){await requireAdminUser();return <PayPalConfigurationPanel/>;}
