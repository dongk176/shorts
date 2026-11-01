import { NextResponse } from "next/server";
import { HttpError } from "@/lib/http";
import { ZodError } from "zod";
export function paypalJson(value:unknown,status=200){return NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store"}});}
export function paypalError(error:unknown){const status=error instanceof HttpError?error.status:error instanceof ZodError||error instanceof SyntaxError?400:503;return paypalJson({code:error instanceof HttpError?error.code:status===400?"INVALID_REQUEST":"PAYPAL_UNAVAILABLE"},status);}
