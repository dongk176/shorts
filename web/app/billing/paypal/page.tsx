import { redirect } from "next/navigation";
import { PayPalPage } from "@/components/paypal-page";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { authProfile,requireMvpSession } from "@/lib/session";
import { getRequestLocale,localizedRedirectPath } from "@/lib/i18n/server";
import { paypalEnabled } from "@/lib/paypal/api";
import { getPayPalState } from "@/lib/paypal/service";
export const dynamic="force-dynamic";
export default async function PayPalReturnPage({searchParams}:{searchParams:Promise<{checkout?:string;cancelled?:string}>}){
 const user=await getAuthenticatedUser();const params=await searchParams;
 if(!user)redirect(await localizedRedirectPath('/auth/sign-in?next=/billing/paypal'+(params.checkout?'?checkout='+encodeURIComponent(params.checkout):'')));
 const session=await requireMvpSession(user,{createIfMissing:false});
 return <PayPalPage user={authProfile(user)} locale={await getRequestLocale()} enabled={paypalEnabled()} subscription={session.userId?await getPayPalState(session.userId):null} checkoutId={params.checkout} checkoutCanceled={params.cancelled==="1"} managementOnly/>;
}
