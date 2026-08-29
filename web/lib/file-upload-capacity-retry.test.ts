import { describe, expect, it, vi } from "vitest";
import {
  FileUploadCapacityTransientError,
  fileUploadCapacityRetryDelayMs,
  isTransientFileUploadCapacityError,
  retryFileUploadCapacityOperation,
} from "@/lib/file-upload-capacity-retry";

describe("file upload capacity retry", () => {
  it("retries only transient Lambda capacity failures", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce({ name: "TooManyRequestsException" })
      .mockResolvedValueOnce({ leaseState: "waiting" });
    const waits: number[] = [];

    await expect(retryFileUploadCapacityOperation(operation, {
      wait: async (milliseconds) => { waits.push(milliseconds); },
      random: () => 0.5,
    })).resolves.toEqual({ leaseState: "waiting" });

    expect(operation).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([150]);
    expect(isTransientFileUploadCapacityError({
      $metadata: { httpStatusCode: 503 },
    })).toBe(true);
  });

  it("never retries a permanent permission or validation error", async () => {
    const operation = vi.fn().mockRejectedValue({
      name: "AccessDeniedException",
      $metadata: { httpStatusCode: 403 },
    });

    await expect(retryFileUploadCapacityOperation(operation))
      .rejects.toMatchObject({ name: "AccessDeniedException" });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("marks exhausted transient failures without exposing their details", async () => {
    const waits: number[] = [];
    await expect(retryFileUploadCapacityOperation(
      async () => { throw { name: "TooManyRequestsException" }; },
      {
        maxAttempts: 3,
        wait: async (milliseconds) => { waits.push(milliseconds); },
        random: () => 0.5,
      },
    )).rejects.toBeInstanceOf(FileUploadCapacityTransientError);
    expect(waits).toEqual([150, 300]);
  });

  it("keeps retry delay bounded and jittered", () => {
    expect(fileUploadCapacityRetryDelayMs(0, 0)).toBe(113);
    expect(fileUploadCapacityRetryDelayMs(0, 1)).toBe(188);
    expect(fileUploadCapacityRetryDelayMs(20, 1)).toBe(2_500);
  });
});
