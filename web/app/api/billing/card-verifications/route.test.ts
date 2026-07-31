import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
  register: vi.fn(),
  encrypt: vi.fn(),
  tokenHash: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/session", () => ({
  requireAuthenticatedMvpSession: mocks.session,
}));
vi.mock("@/lib/thepayone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/thepayone")>()),
  assertThePayOneBillingEnabled: vi.fn(),
  registerThePayOneCard: mocks.register,
  encryptCardToken: mocks.encrypt,
  cardTokenHash: mocks.tokenHash,
}));

import { POST } from "./route";

function dbWithRows(...responses: unknown[][]) {
  const db = vi.fn();
  for (const response of responses) db.mockResolvedValueOnce(response);
  return db;
}

function request(
  requestId: string,
  planCode: "easycut_pro_v2" | "starter_6m" = "easycut_pro_v2",
) {
  return new Request("http://localhost/api/billing/card-verifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      mode: "subscribe",
      planCode,
      billingCycle: planCode === "easycut_pro_v2" ? "monthly" : "yearly",
      payerName: "홍길동",
      payerEmail: "owner@example.com",
      payerTel: "01012345678",
      cardNumber: "4242424242424242",
      expiryYear: "29",
      expiryMonth: "07",
      identityNumber: "800101",
      cardPassword: "12",
      consent: true,
    }),
  });
}

describe("billing card verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("THEPAYONE_PACKAGE_BILLING_ENABLED", "true");
    vi.stubEnv("THEPAYONE_MID", "test-merchant");
    vi.stubEnv("THEPAYONE_TERMINAL_ID", "test-default-terminal");
    vi.stubEnv("THEPAYONE_PACKAGE_TERMINAL_ID", "test-package-terminal");
    mocks.session.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      user: { email: "owner@example.com", displayName: "홍길동" },
    });
    mocks.encrypt.mockReturnValue({
      ciphertext: "encrypted-card-id",
      iv: "verification-iv",
      tag: "verification-tag",
    });
    mocks.tokenHash.mockReturnValue("a".repeat(64));
    mocks.register.mockResolvedValue({
      resultCode: "0000",
      providerTransactionId: "provider-auth-transaction",
      cardId: "provider-card-id",
      last4: "4242",
      issuer: "국민카드",
      cardType: "신용",
      acquirer: "국민카드",
      trackId: "replaced-below",
      amount: 0,
      billingDay: "00",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns only a short-lived opaque verification after zero-won card authentication", async () => {
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const db = dbWithRows(
      [],
      [],
      [{ id: "verification-created" }],
      [{
        id: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
        requestId: "33333333-3333-4333-8333-333333333333",
        mode: "subscribe",
        planCode: "easycut_pro_v2",
        billingCycle: "monthly",
        billingDay: "00",
        status: "active",
        providerOrderId: "provider-order",
        providerTransactionId: "provider-auth-transaction",
        providerResultCode: "0000",
        providerCredentialScope: "default",
        providerMerchantId: "test-merchant",
        providerTerminalId: "test-default-terminal",
        billingKeyCiphertext: "encrypted-card-id",
        billingKeyIv: "verification-iv",
        billingKeyTag: "verification-tag",
        billingKeyHash: "a".repeat(64),
        issuerName: "국민카드",
        cardType: "신용",
        acquirerName: "국민카드",
        cardLast4: "4242",
        expiresAt,
        consumedAt: null,
        revokedAt: null,
      }],
    );
    mocks.getDb.mockReturnValue(db);
    mocks.register.mockImplementation(async (input: { trackId: string }) => ({
      resultCode: "0000",
      providerTransactionId: "provider-auth-transaction",
      cardId: "provider-card-id",
      last4: "4242",
      issuer: "국민카드",
      cardType: "신용",
      acquirer: "국민카드",
      trackId: input.trackId,
      amount: 0,
      billingDay: "00",
    }));

    const response = await POST(request("33333333-3333-4333-8333-333333333333"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      verification: {
        id: "22222222-2222-4222-8222-222222222222",
        issuer: "국민카드",
        cardType: "신용",
        last4: "4242",
        expiresAt: expiresAt.toISOString(),
      },
    });
    expect(JSON.stringify(body)).not.toContain("provider-card-id");
    expect(JSON.stringify(body)).not.toContain("4242424242424242");
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      billingDay: "00",
    }), "default");
  });

  it("reuses an unexpired idempotent result without registering the card twice", async () => {
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    mocks.getDb.mockReturnValue(dbWithRows(
      [],
      [{
        id: "22222222-2222-4222-8222-222222222222",
        userId: "11111111-1111-4111-8111-111111111111",
        requestId: "33333333-3333-4333-8333-333333333333",
        mode: "subscribe",
        planCode: "easycut_pro_v2",
        billingCycle: "monthly",
        billingDay: "00",
        status: "active",
        providerOrderId: "provider-order",
        providerTransactionId: "provider-auth-transaction",
        providerResultCode: "0000",
        providerCredentialScope: "default",
        providerMerchantId: "test-merchant",
        providerTerminalId: "test-default-terminal",
        billingKeyCiphertext: "encrypted-card-id",
        billingKeyIv: "verification-iv",
        billingKeyTag: "verification-tag",
        billingKeyHash: "a".repeat(64),
        issuerName: "국민카드",
        cardType: "신용",
        acquirerName: "국민카드",
        cardLast4: "4242",
        expiresAt,
        consumedAt: null,
        revokedAt: null,
      }],
    ));

    const response = await POST(request("33333333-3333-4333-8333-333333333333"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      duplicate: true,
      verification: { last4: "4242" },
    });
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("never calls the recurring card-registration API for a package", async () => {
    const response = await POST(request(
      "33333333-3333-4333-8333-333333333333",
      "starter_6m",
    ));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "PACKAGE_MANUAL_DIRECT_REQUIRED",
    });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
