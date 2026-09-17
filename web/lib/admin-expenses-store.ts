import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { expenseSchema, monthSchema, type Expense, type ExpenseAudit, type ExpenseInput, type Receipt } from "@/lib/admin-expenses-model";
import type { AdminUser } from "@/lib/admin";

type Row = { id: string; version: number; content: ExpenseInput; updatedAt: Date | string; deletedAt: Date | string | null };
function fromRow(row: Row): Expense {
  return { ...row.content, id: row.id, version: row.version, updatedAt: new Date(row.updatedAt).toISOString(), deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null };
}
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function parseReceipt(receipt: Receipt) {
  if (!receipt.data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(receipt.data)) throw new HttpError(400, "증빙 파일을 다시 선택해 주세요.");
  const body = Buffer.from(receipt.data, "base64");
  const valid = receipt.type === "application/pdf" ? body.subarray(0, 5).toString() === "%PDF-" && /\.pdf$/i.test(receipt.name)
    : receipt.type === "image/png" ? body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && /\.png$/i.test(receipt.name)
    : receipt.type === "image/jpeg" ? body[0] === 255 && body[1] === 216 && body[2] === 255 && /\.jpe?g$/i.test(receipt.name)
    : body.subarray(0, 4).toString() === "RIFF" && body.subarray(8, 12).toString() === "WEBP" && /\.webp$/i.test(receipt.name);
  if (!valid || body.length !== receipt.size) throw new HttpError(400, "증빙의 파일 형식 또는 크기가 올바르지 않습니다.");
  return { body, digest: hash(body) };
}
export async function listExpenses(month: string) {
  monthSchema.parse(month);
  const rows = await getDb()`
    select id,version,content,updated_at,deleted_at from shorts_mvp.admin_expenses
    where content->>'month'=${month} or exists (
      select 1 from jsonb_array_elements(content->'payments') p where left(p->>'date',7)=${month}
    ) order by updated_at desc,id limit 2001
  `;
  if (rows.length > 2000) throw new HttpError(422, "월별 조회 한도 2,000건을 초과했습니다. 관리자에게 문의해 주세요.");
  return rows.map(row => fromRow(row as Row));
}
export async function expenseDetail(id: string) {
  z.string().uuid().parse(id);
  const db = getDb();
  const rows = await db`select id,version,content,updated_at,deleted_at from shorts_mvp.admin_expenses where id=${id}`;
  if (!rows[0]) throw new HttpError(404, "비용을 찾을 수 없습니다.");
  const history = await db`
    select c.id,c.action,c.created_at,c.before_snapshot,c.after_snapshot,u.display_name,u.email
    from shorts_mvp.admin_expense_changes c join shorts_mvp.app_users u on u.id=c.actor_user_id
    where c.expense_id=${id} order by c.created_at desc,c.id desc limit 100
  `;
  return { expense: fromRow(rows[0] as Row), history: history.map(row => ({
    id: row.id, action: row.action, date: new Date(row.createdAt).toISOString(), actor: row.displayName || row.email,
    before: row.beforeSnapshot, after: row.afterSnapshot,
  })) as ExpenseAudit[] };
}
export async function mutateExpense(admin: AdminUser, requestId: string, input: ExpenseInput | { id: string; version: number }, action: "save" | "delete") {
  z.string().uuid().parse(requestId);
  const parsed = action === "save" ? expenseSchema.parse(input) : z.object({id: z.string().uuid(), version: z.number().int().positive()}).strict().parse(input);
  const fingerprint = hash(JSON.stringify({ action, input: parsed }));
  return getDb().begin(async tx => {
    const access = await tx`select a.user_id from shorts_mvp.admin_expense_access a join shorts_mvp.app_users u on u.id=a.user_id where a.user_id=${admin.id} and u.is_admin for share of a,u`;
    if (!access.length) throw new HttpError(403, "매입·비용 관리 권한이 필요합니다.");
    await tx`select pg_advisory_xact_lock(hashtextextended(${requestId},1))`;
    const replay = await tx`select payload_hash,actor_user_id,after_snapshot from shorts_mvp.admin_expense_changes where request_id=${requestId}`;
    if (replay[0]) {
      if (replay[0].payloadHash !== fingerprint || replay[0].actorUserId !== admin.id) throw new HttpError(409, "이미 사용한 저장 요청입니다. 새로고침 후 다시 시도해 주세요.");
      return replay[0].afterSnapshot as Expense;
    }
    await tx`select pg_advisory_xact_lock(hashtextextended(${parsed.id},2))`;
    const existing = await tx`select id,version,content,updated_at,deleted_at from shorts_mvp.admin_expenses where id=${parsed.id} for update`;
    const before = existing[0] ? fromRow(existing[0] as Row) : null;
    if (before?.deletedAt) throw new HttpError(409, "삭제된 비용은 수정할 수 없습니다.");
    if ((before?.version ?? 0) !== parsed.version || (action === "delete" && !before)) throw new HttpError(409, "다른 창에서 변경된 비용입니다. 목록을 새로고침한 뒤 다시 수정해 주세요.", "EXPENSE_CONFLICT");
    const saved = action === "save" ? parsed as ExpenseInput : before!;
    const content: ExpenseInput = {
      id: saved.id, version: parsed.version + 1, name: saved.name, category: saved.category, vendor: saved.vendor,
      amount: saved.amount, month: saved.month, stage: saved.stage, environment: saved.environment,
      recurring: saved.recurring, note: saved.note, dueOn: saved.dueOn, foreignCurrency: saved.foreignCurrency,
      foreignAmount: saved.foreignAmount, payments: saved.payments,
      receipts: saved.receipts.map(({id,name,type,size}) => ({id,name,type,size})),
    };
    const newReceipts = action === "save" ? (parsed as ExpenseInput).receipts.filter(r => r.data !== undefined).map(r => ({ receipt: r, ...parseReceipt(r) })) : [];
    const retained = action === "save" ? (parsed as ExpenseInput).receipts.filter(r => r.data === undefined) : [];
    for (const receipt of retained) {
      const row = await tx`select id,name,content_type,octet_length(body) as size from shorts_mvp.admin_expense_receipts where id=${receipt.id} and expense_id=${parsed.id}`;
      if (!row[0] || row[0].name !== receipt.name || row[0].contentType !== receipt.type || row[0].size !== receipt.size) throw new HttpError(400, "이 비용에 속하지 않는 증빙입니다.");
    }
    const updated = before ? await tx`
      update shorts_mvp.admin_expenses set content=${tx.json(content)},version=${content.version},updated_by=${admin.id},updated_at=clock_timestamp(),deleted_at=${action === "delete" ? new Date() : null}
      where id=${parsed.id} returning id,version,content,updated_at,deleted_at
    ` : await tx`
      insert into shorts_mvp.admin_expenses(id,version,content,created_by,updated_by)
      values(${parsed.id},${content.version},${tx.json(content)},${admin.id},${admin.id}) returning id,version,content,updated_at,deleted_at
    `;
    for (const {receipt,body,digest} of newReceipts) {
      await tx`insert into shorts_mvp.admin_expense_receipts(id,expense_id,name,content_type,body,sha256)
        values(${receipt.id},${parsed.id},${receipt.name},${receipt.type},${body},${digest})`;
    }
    const after = fromRow(updated[0] as Row);
    await tx`insert into shorts_mvp.admin_expense_changes(request_id,payload_hash,expense_id,actor_user_id,action,before_snapshot,after_snapshot)
      values(${requestId},${fingerprint},${parsed.id},${admin.id},${action === "delete" ? "deleted" : before ? "updated" : "created"},${before ? tx.json(before) : null},${tx.json(after)})`;
    return after;
  });
}
export async function loadExpenseReceipt(expenseId: string, receiptId: string) {
  z.string().uuid().parse(expenseId); z.string().uuid().parse(receiptId);
  const rows = await getDb()`
    select r.name,r.content_type,r.body from shorts_mvp.admin_expense_receipts r
    join shorts_mvp.admin_expenses e on e.id=r.expense_id
    where r.id=${receiptId} and r.expense_id=${expenseId}
  `;
  if (!rows[0]) throw new HttpError(404, "증빙을 찾을 수 없습니다.");
  return { name: String(rows[0].name), type: String(rows[0].contentType), body: rows[0].body as Buffer };
}
