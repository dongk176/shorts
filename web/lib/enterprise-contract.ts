import { z } from "zod";

export const ENTERPRISE_PURCHASE_TERMS_VERSION = 1;
export const ENTERPRISE_PURCHASE_TERMS_HASH = "6e434ec81aeed1c4d5cbf412026e08340e1b62cae2a76aec4452855893052a14";
export const ENTERPRISE_REFUND_POLICY_VERSION = 1;
export const ENTERPRISE_REFUND_POLICY_HASH = "950a653454ab53490fdf2aa2eefef0bd5cfb72e1ed9fec3b3d56d60db4ec2449";
export const ENTERPRISE_CONSENT_COPY_VERSION = 1;
export const ENTERPRISE_BILLING_RUNTIME_FLAG = "toss_enterprise_billing";

export const enterpriseDurationUnitSchema = z.enum(["days", "months"]);
export const enterpriseVatTreatmentSchema = z.enum(["included", "not_applicable"]);

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const enterprisePaymentItemSchema = z.object({
  name: z.string().trim().min(1).max(100),
  serviceStartDate: dateSchema,
  durationValue: z.number().int().positive(),
  durationUnit: enterpriseDurationUnitSchema,
  includedMinutes: z.number().int().min(1).max(100_000),
  amountKrw: z.number().int().min(100).max(1_000_000_000),
  vatTreatment: enterpriseVatTreatmentSchema,
  paymentDueDate: dateSchema,
}).strict().superRefine((item, context) => {
  const maximum = item.durationUnit === "days" ? 3_650 : 120;
  if (item.durationValue > maximum) {
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum,
      inclusive: true,
      origin: "number",
      path: ["durationValue"],
      message: item.durationUnit === "days"
        ? "이용기간은 최대 3,650일까지 입력할 수 있습니다."
        : "이용기간은 최대 120개월까지 입력할 수 있습니다.",
    });
  }
});

export type EnterpriseDurationUnit = z.infer<typeof enterpriseDurationUnitSchema>;
export type EnterpriseVatTreatment = z.infer<typeof enterpriseVatTreatmentSchema>;
export type EnterprisePaymentItemInput = z.infer<typeof enterprisePaymentItemSchema>;

function parseDate(value: string) {
  if (!dateSchema.safeParse(value).success) throw new Error("날짜 형식이 올바르지 않습니다.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error("존재하지 않는 날짜입니다.");
  }
  return { year, month, day, date };
}

function formatDate(date: Date) {
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("-");
}

function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function calculateEnterpriseServiceEndDate(input: {
  serviceStartDate: string;
  durationValue: number;
  durationUnit: EnterpriseDurationUnit;
}) {
  const parsed = parseDate(input.serviceStartDate);
  if (!Number.isInteger(input.durationValue) || input.durationValue < 1) {
    throw new Error("이용기간은 1 이상의 정수여야 합니다.");
  }
  const maximum = input.durationUnit === "days" ? 3_650 : 120;
  if (input.durationValue > maximum) throw new Error("이용기간이 허용 범위를 초과했습니다.");
  if (input.durationUnit === "days") {
    const end = new Date(parsed.date);
    end.setUTCDate(end.getUTCDate() + input.durationValue - 1);
    return formatDate(end);
  }
  const targetMonthIndex = parsed.month - 1 + input.durationValue;
  const targetYear = parsed.year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const targetLastDay = lastDayOfMonth(targetYear, normalizedMonthIndex);
  if (parsed.day > targetLastDay) {
    return formatDate(new Date(Date.UTC(targetYear, normalizedMonthIndex, targetLastDay)));
  }
  const anniversaryDay = parsed.day;
  const exclusive = new Date(Date.UTC(targetYear, normalizedMonthIndex, anniversaryDay));
  exclusive.setUTCDate(exclusive.getUTCDate() - 1);
  return formatDate(exclusive);
}

export function kstStartInstant(date: string) {
  parseDate(date);
  return new Date(`${date}T00:00:00+09:00`);
}

export function kstExclusiveEndInstant(serviceEndDate: string) {
  const parsed = parseDate(serviceEndDate).date;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return new Date(`${formatDate(parsed)}T00:00:00+09:00`);
}

export function enterprisePaymentRequestExpiresAt(items: EnterprisePaymentItemInput[]) {
  if (!items.length) throw new Error("결제 상품이 필요합니다.");
  const latest = items.reduce(
    (current, item) => item.paymentDueDate > current ? item.paymentDueDate : current,
    items[0].paymentDueDate,
  );
  return kstExclusiveEndInstant(latest);
}

export function validateEnterpriseItemSequence(items: EnterprisePaymentItemInput[]) {
  const parsed = items.map((item) => ({
    ...item,
    serviceEndDate: calculateEnterpriseServiceEndDate(item),
  }));
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index].serviceStartDate < parsed[index - 1].serviceStartDate) {
      throw new Error(`${index + 1}번째 상품 시작일은 이전 상품보다 빠를 수 없습니다.`);
    }
  }
  return parsed;
}

export function enterprisePeriodRelation(
  previous: { serviceEndDate: string },
  current: { serviceStartDate: string },
) {
  const nextDay = kstExclusiveEndInstant(previous.serviceEndDate);
  const currentStart = kstStartInstant(current.serviceStartDate);
  if (currentStart.getTime() < nextDay.getTime()) return "overlap" as const;
  if (currentStart.getTime() > nextDay.getTime()) return "gap" as const;
  return "continuous" as const;
}

export function enterpriseVatLabel(value: EnterpriseVatTreatment) {
  return value === "included" ? "부가세 포함" : "부가세 해당 없음";
}
