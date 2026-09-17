import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireExpenseAdmin } from "@/lib/admin-expenses-access";
import { expenseDetail, mutateExpense } from "@/lib/admin-expenses-store";
import { expenseApiError, expensePrivateHeaders, expenseRequestBody } from "@/lib/admin-expenses-http";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
type Context = {params:Promise<{id:string}>};
export const dynamic = "force-dynamic";
export async function GET(_request: NextRequest,context:Context) {
  try {
    await requireExpenseAdmin();
    return NextResponse.json(await expenseDetail((await context.params).id), {headers:expensePrivateHeaders});
  } catch(error) { return expenseApiError(error); }
}
export async function DELETE(request:NextRequest,context:Context) {
  try {
    assertSameOriginJsonRequest(request);
    const admin=await requireExpenseAdmin();
    const body=z.object({requestId:z.string().uuid(),version:z.number().int().positive()}).strict().parse(await expenseRequestBody(request));
    const expense=await mutateExpense(admin,body.requestId,{id:(await context.params).id,version:body.version},"delete");
    return NextResponse.json({expense},{headers:expensePrivateHeaders});
  } catch(error) { return expenseApiError(error); }
}
