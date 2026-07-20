import { describe, expect, it } from "vitest";
import { assertBillingMutationRequest, checkoutUrls } from "./billing-request";

describe("billing mutation requests", () => {
  it("accepts same-origin JSON and binds callbacks to the server origin", () => {
    const request = new Request("https://easy-cut.example/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://easy-cut.example" },
      body: "{}",
    });
    expect(() => assertBillingMutationRequest(request)).not.toThrow();
    expect(checkoutUrls(request, "subscription", "checkout-a")).toEqual({
      successUrl: "https://easy-cut.example/billing/success?flow=subscription&checkoutId=checkout-a",
      failUrl: "https://easy-cut.example/billing/fail?flow=subscription&checkoutId=checkout-a",
    });
  });

  it("rejects cross-origin billing mutations", () => {
    const request = new Request("https://easy-cut.example/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: "{}",
    });
    expect(() => assertBillingMutationRequest(request)).toThrowError("다른 출처");
  });

  it("accepts the public Host origin when Next.js uses an internal request URL", () => {
    const request = new Request("http://0.0.0.0:3000/api/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost:3000",
        Origin: "http://localhost:3000",
      },
      body: "{}",
    });
    expect(() => assertBillingMutationRequest(request)).not.toThrow();
    expect(checkoutUrls(request, "subscription", "checkout-local")).toEqual({
      successUrl: "http://localhost:3000/billing/success?flow=subscription&checkoutId=checkout-local",
      failUrl: "http://localhost:3000/billing/fail?flow=subscription&checkoutId=checkout-local",
    });
  });

  it("accepts a trusted proxy origin and binds callbacks to its public URL", () => {
    const request = new Request("http://web:3000/api/billing/addons/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "web:3000",
        Origin: "https://preview.easy-cut.example",
        "X-Forwarded-Host": "preview.easy-cut.example",
        "X-Forwarded-Proto": "https",
      },
      body: "{}",
    });
    expect(() => assertBillingMutationRequest(request)).not.toThrow();
    expect(checkoutUrls(request, "addon", "checkout-addon")).toEqual({
      successUrl: "https://preview.easy-cut.example/billing/success?flow=addon&checkoutId=checkout-addon",
      failUrl: "https://preview.easy-cut.example/billing/fail?flow=addon&checkoutId=checkout-addon",
    });
  });

  it("still rejects an external Origin behind a proxy", () => {
    const request = new Request("http://web:3000/api/billing/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "web:3000",
        Origin: "https://attacker.example",
        "X-Forwarded-Host": "preview.easy-cut.example",
        "X-Forwarded-Proto": "https",
      },
      body: "{}",
    });
    expect(() => assertBillingMutationRequest(request)).toThrowError("다른 출처");
  });

  it("rejects non-JSON billing mutations", () => {
    const request = new Request("https://easy-cut.example/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
    });
    expect(() => assertBillingMutationRequest(request)).toThrowError("JSON 형식");
  });
});
