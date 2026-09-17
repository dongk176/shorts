import { z } from "zod";

export const EXPENSE_CATEGORIES = ["인건비", "외주비", "서버·인프라", "AI·소프트웨어", "광고·마케팅", "수수료", "사무·운영", "기타"] as const;
export const EXPENSE_ENVIRONMENTS = ["운영", "테스트", "공통"] as const;
export const PAYMENT_METHODS = ["계좌이체", "카드", "현금", "기타"] as const;
export const RECEIPT_LIMIT = 2 * 1024 * 1024;
export const monthSchema = z.string().regex(/^(20\d{2})-(0[1-9]|1[0-2])$/, "귀속월을 확인해 주세요.");
export const dateSchema = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "올바른 날짜를 입력해 주세요.");
const amountSchema = z.number().int().min(1).max(1_000_000_000);
export const receiptSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(180).refine(value => !/[\x00-\x1f\x7f/\\]/.test(value)),
  type: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
  size: z.number().int().min(1).max(RECEIPT_LIMIT),
  data: z.string().max(Math.ceil(RECEIPT_LIMIT / 3) * 4).optional(),
}).strict();
export const expenseSchema = z.object({
  id: z.string().uuid(), version: z.number().int().min(0),
  name: z.string().trim().min(1, "항목명을 입력해 주세요.").max(100),
  category: z.enum(EXPENSE_CATEGORIES), vendor: z.string().trim().min(1, "거래처 또는 지급 대상을 입력해 주세요.").max(100),
  amount: amountSchema, month: monthSchema, stage: z.enum(["draft", "confirmed"]),
  environment: z.enum(EXPENSE_ENVIRONMENTS), recurring: z.boolean(),
  note: z.string().trim().max(2000), dueOn: z.union([z.literal(""), dateSchema]),
  foreignCurrency: z.enum(["", "USD", "EUR", "JPY", "GBP", "CNY"]),
  foreignAmount: z.string().max(20),
  payments: z.array(z.object({
    id: z.string().uuid(), amount: amountSchema, date: dateSchema,
    method: z.enum(PAYMENT_METHODS), note: z.string().trim().max(200),
  }).strict()).max(36),
  receipts: z.array(receiptSchema).max(5),
}).strict().superRefine((item, ctx) => {
  const fail = (message: string, field: string) => ctx.addIssue({ code: "custom", message, path: [field] });
  if (item.stage === "draft" && item.payments.length) fail("예상 초안은 지급 내역을 입력할 수 없습니다. 확정 비용으로 바꿔 주세요.", "stage");
  if (paidAmount(item) > item.amount) fail("지급액 합계가 비용 총액을 초과합니다.", "payments");
  if (new Set(item.payments.map(p => p.id)).size !== item.payments.length) fail("지급 내역이 중복되었습니다.", "payments");
  if (item.payments.some(p => p.date > todayKst())) fail("실제 지급일은 오늘 이후로 입력할 수 없습니다.", "payments");
  if (new Set(item.receipts.map(r => r.id)).size !== item.receipts.length) fail("증빙이 중복되었습니다.", "receipts");
  if (item.receipts.reduce((sum, r) => sum + r.size, 0) > RECEIPT_LIMIT) fail("한 비용의 증빙은 합계 2MB까지 첨부할 수 있습니다.", "receipts");
  if (item.foreignCurrency ? !/^\d{1,12}(\.\d{1,2})?$/.test(item.foreignAmount) || Number(item.foreignAmount) <= 0 : item.foreignAmount !== "") fail("외화 통화와 외화 금액을 함께 입력해 주세요.", "foreignAmount");
});
export type ExpenseInput = z.infer<typeof expenseSchema>;
export type Receipt = z.infer<typeof receiptSchema>;
export type Expense = ExpenseInput & { updatedAt: string; deletedAt: string | null };
export type ExpenseAudit = { id: string; action: string; date: string; actor: string; before: Expense | null; after: Expense };
export type ExpenseList = { expenses: Expense[]; month: string };
export function todayKst() { return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10); }
export const money = (value: number) => `${value.toLocaleString("ko-KR")}원`;
export const paidAmount = (item: Pick<ExpenseInput, "payments">) => item.payments.reduce((sum, payment) => sum + payment.amount, 0);
export function paymentStatus(item: ExpenseInput) {
  if (item.stage === "draft") return "예상 초안";
  const paid = paidAmount(item);
  return paid === 0 ? "미지급" : paid === item.amount ? "지급 완료" : "일부 지급";
}
export function emptyExpense(month: string): ExpenseInput {
  return { id: crypto.randomUUID(), version: 0, name: "", category: "기타", vendor: "", amount: 0, month,
    stage: "confirmed", environment: "운영", recurring: false, note: "", dueOn: "", foreignCurrency: "", foreignAmount: "", payments: [], receipts: [] };
}
export function copyExpense(item: ExpenseInput): ExpenseInput {
  const next = new Date(`${item.month}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1);
  return { ...expenseInput(item), id: crypto.randomUUID(), version: 0, month: next.toISOString().slice(0, 7), stage: "draft", payments: [], receipts: [], dueOn: "", note: `${item.month} 비용에서 복사한 초안${item.note ? `\n${item.note}` : ""}`.slice(0, 2000) };
}
export function summarizeExpenses(items: Expense[], month: string) {
  const active = items.filter(i => !i.deletedAt);
  const incurred = active.filter(i => i.month === month && i.stage === "confirmed");
  return {
    confirmed: incurred.reduce((n, i) => n + i.amount, 0),
    paid: active.reduce((n, i) => n + i.payments.filter(p => p.date.startsWith(month)).reduce((a, p) => a + p.amount, 0), 0),
    unpaid: incurred.reduce((n, i) => n + i.amount - paidAmount(i), 0),
    missing: incurred.filter(i => !i.receipts.length).length,
    draft: active.filter(i => i.month === month && i.stage === "draft").reduce((n, i) => n + i.amount, 0),
  };
}
export function expenseInput(item: ExpenseInput): ExpenseInput {
  return Object.fromEntries(Object.keys(expenseSchema.shape).map(key => [key, item[key as keyof ExpenseInput]])) as ExpenseInput;
}
