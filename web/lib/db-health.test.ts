import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: mocks.postgres,
}));

type FakeSql = ReturnType<typeof vi.fn> & {
  end: ReturnType<typeof vi.fn>;
};

function fakeSql(result: Promise<unknown> = Promise.resolve([{ one: 1 }])): FakeSql {
  const query = vi.fn(() => result) as FakeSql;
  query.end = vi.fn().mockResolvedValue(undefined);
  return query;
}

function resetGlobalDbState() {
  const globalDb = globalThis as typeof globalThis & {
    __shortsMvpDbClient?: unknown;
    __shortsMvpDbHealthCheck?: Promise<void>;
  };
  delete globalDb.__shortsMvpDbClient;
  delete globalDb.__shortsMvpDbHealthCheck;
}

describe("database pool health recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "postgres://health-check.invalid/shorts");
    mocks.postgres.mockReset();
    resetGlobalDbState();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetGlobalDbState();
  });

  it("keeps ordinary production call sites on the existing no-op path", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { ensureLocalDbReady } = await import("./db");

    await ensureLocalDbReady();

    expect(mocks.postgres).not.toHaveBeenCalled();
  });

  it("checks the administrator database pool in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const healthyClient = fakeSql();
    mocks.postgres.mockReturnValue(healthyClient);
    const { ensureAdminDbReady } = await import("./db");

    await ensureAdminDbReady();

    expect(mocks.postgres).toHaveBeenCalledOnce();
    expect(healthyClient).toHaveBeenCalledOnce();
    expect(healthyClient.end).not.toHaveBeenCalled();
  });

  it("recycles a stalled administrator pool after four seconds", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
    const stalledClient = fakeSql(new Promise(() => undefined));
    const replacementClient = fakeSql();
    mocks.postgres
      .mockReturnValueOnce(stalledClient)
      .mockReturnValueOnce(replacementClient);
    const { ensureAdminDbReady } = await import("./db");

    const recovery = ensureAdminDbReady();
    await vi.advanceTimersByTimeAsync(4_000);
    await recovery;

    expect(stalledClient.end).toHaveBeenCalledWith({ timeout: 1 });
    expect(replacementClient).toHaveBeenCalledOnce();
    expect(mocks.postgres).toHaveBeenCalledTimes(2);
  });
});
