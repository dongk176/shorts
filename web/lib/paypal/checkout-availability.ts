import { paddleEnabled } from "@/lib/paddle/config";
import { HttpError } from "@/lib/http";
import { paypalEnabled } from "./api";

// Keep PayPal reads, settlement and refunds available after switching new sales.
export function paypalNewCheckoutEnabled() {
  return paypalEnabled() && !paddleEnabled();
}
export function assertPayPalNewCheckoutEnabled() {
  if (!paypalNewCheckoutEnabled()) throw new HttpError(409,
    "Checkout has changed. Refresh the pricing page to continue with Paddle.",
    "CHECKOUT_REFRESH_REQUIRED");
}
