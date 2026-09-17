import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireExpenseAdmin } from "@/lib/admin-expenses-access";
import { expenseSchema, todayKst } from "@/lib/admin-expenses-model";
import { listExpenses, mutateExpense } from "@/lib/admin-expenses-store";
import { expenseApiError, expensePrivateHeaders, expenseRequestBody } from "@/lib/admin-expenses-http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await requireExpenseAdmin();
    const month = request.nextUrl.searchParams.get("month") || todayKst().slice(0,7);
    return NextResponse.json({ month, expenses: await listExpenses(month) }, { headers: expensePrivateHeaders });
  } catch(error) { return expenseApiError(error); }
}
export async function POST(request: NextRequest) {
  try {
    assertSameOriginJsonRequest(request);
    const admin = await requireExpenseAdmin();
    const body = z.object({requestId:z.string().uuid(),expense:expenseSchema}).strict().parse(await expenseRequestBody(request));
    const expense = await mutateExpense(admin,body.requestId,body.expense,"save");
    return NextResponse.json({expense}, {headers:expensePrivateHeaders});
  } catch(error) { return expenseApiError(error); }
}
