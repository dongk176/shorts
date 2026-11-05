import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import { paypalNewCheckoutEnabled, assertPayPalNewCheckoutEnabled } from "./checkout-availability";
import { oneTimeEnabled } from "./one-time-config";
afterEach(()=>vi.unstubAllEnvs());
it("stops new PayPal sales while retaining paid-order settlement",()=>{
 vi.stubEnv("PAYPAL_ENABLED","true");vi.stubEnv("PAYPAL_ONE_TIME_ENABLED","true");vi.stubEnv("PADDLE_ENABLED","true");
 expect(paypalNewCheckoutEnabled()).toBe(false);
 expect(()=>assertPayPalNewCheckoutEnabled()).toThrow(/Paddle/);
 expect(oneTimeEnabled()).toBe(true);
});
it("supports rollback to PayPal",()=>{
 vi.stubEnv("PAYPAL_ENABLED","true");vi.stubEnv("PADDLE_ENABLED","false");expect(paypalNewCheckoutEnabled()).toBe(true);
});
