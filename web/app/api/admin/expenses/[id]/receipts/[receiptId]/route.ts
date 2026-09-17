import { NextRequest } from "next/server";
import { requireExpenseAdmin } from "@/lib/admin-expenses-access";
import { loadExpenseReceipt } from "@/lib/admin-expenses-store";
import { expenseApiError, expensePrivateHeaders } from "@/lib/admin-expenses-http";
export const dynamic = "force-dynamic";
export async function GET(_request:NextRequest,{params}:{params:Promise<{id:string;receiptId:string}>}) {
  try {
    await requireExpenseAdmin();
    const {id,receiptId}=await params;
    const file=await loadExpenseReceipt(id,receiptId);
    return new Response(new Uint8Array(file.body),{headers:{...expensePrivateHeaders,
      "Content-Type":file.type,"Content-Disposition":`attachment; filename="receipt"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g,"%27")}`,
      "Content-Security-Policy":"sandbox; default-src 'none'",
    }});
  } catch(error) { return expenseApiError(error); }
}
