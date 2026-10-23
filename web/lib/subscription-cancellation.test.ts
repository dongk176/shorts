import { describe, expect, it } from "vitest";
import { cancellationRequestSchema, cancellationFeedbackSchema, cancellationReasons } from "./subscription-cancellation";
describe("required cancellation survey", () => {
  it("requires a valid reason on cancellation, but not on resume", () => {
    expect(cancellationRequestSchema.safeParse({cancelAtPeriodEnd:true}).success).toBe(false);
    expect(cancellationRequestSchema.safeParse({cancelAtPeriodEnd:true,feedback:{reason:""}}).success).toBe(false);
    expect(cancellationRequestSchema.parse({cancelAtPeriodEnd:false})).toEqual({cancelAtPeriodEnd:false});
  });
  it.each(cancellationReasons)("accepts %s and an optional message to the team", (reason) => {
    const result = cancellationFeedbackSchema.parse({reason,detail: reason === "other" ? "  My reason  " : "",message:"  Please improve editing  "});
    expect(result.message).toBe("Please improve editing");
  });
  it("requires nonblank Other details and bounds user text", () => {
    for (const detail of ["", "   ", "x".repeat(1001)]) expect(cancellationFeedbackSchema.safeParse({reason:"other",detail}).success).toBe(false);
    expect(cancellationFeedbackSchema.safeParse({reason:"price",message:"x".repeat(2001)}).success).toBe(false);
    expect(cancellationFeedbackSchema.safeParse({reason:"alternative",alternativeService:"x".repeat(101)}).success).toBe(false);
  });
  it("allows unknown or optional alternatives and rejects contradictory answers", () => {
    expect(cancellationFeedbackSchema.safeParse({reason:"alternative"}).success).toBe(true);
    expect(cancellationFeedbackSchema.safeParse({reason:"alternative",alternativeUndecided:true}).success).toBe(true);
    expect(cancellationFeedbackSchema.safeParse({reason:"alternative",alternativeService:"Other",alternativeUndecided:true}).success).toBe(false);
    expect(cancellationFeedbackSchema.safeParse({reason:"price",alternativeService:"Other"}).success).toBe(false);
    expect(cancellationRequestSchema.safeParse({cancelAtPeriodEnd:true,feedback:{reason:"price"},userId:"spoofed"}).success).toBe(false);
  });
});
