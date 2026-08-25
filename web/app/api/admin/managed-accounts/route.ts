import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { getDb } from "@/lib/db";
import { apiError, HttpError } from "@/lib/http";
import { insertEnterpriseBillingRequest } from "@/lib/enterprise-billing";
import { enterprisePaymentItemSchema } from "@/lib/enterprise-contract";
import { MANAGED_ACCOUNT_TYPES } from "@/lib/managed-account-type";
import {
  MANAGED_ACCOUNT_PRODUCT_CODE,
  createManagedAuthEmail,
  isManagedLoginId,
  normalizeManagedLoginId,
} from "@/lib/managed-login";
import { assertSameOriginJsonRequest } from "@/lib/same-origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const createSchema = z.object({
  requestId: z.string().uuid(),
  loginId: z.string().trim().min(3).max(32),
  temporaryPassword: z.string().min(10).max(128),
  displayName: z.string().trim().min(1).max(100),
  usageMinutes: z.number().int().min(0).max(100_000).default(0),
  serviceAccessUntil: z.string().datetime({ offset: true }).nullable().optional(),
  popularFilterEnabled: z.boolean(),
  accountType: z.enum(MANAGED_ACCOUNT_TYPES).default("personal"),
  customerEmail: z.union([z.string().trim().email().max(100), z.literal("")]).optional(),
  paymentTitle: z.string().trim().min(1).max(100).default("이지컷 기업 결제 요청"),
  paymentItems: z.array(enterprisePaymentItemSchema).max(10).default([]),
}).superRefine((value, context) => {
  if (value.accountType === "enterprise" && value.paymentItems.length < 1) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["paymentItems"],
      message: "기업 계정에는 결제 상품이 1개 이상 필요합니다.",
    });
  }
  if (value.accountType === "personal" && !value.serviceAccessUntil) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["serviceAccessUntil"],
      message: "개인 계정의 서비스 이용 만료일이 필요합니다.",
    });
  }
});

export async function POST(request: NextRequest) {
  let createdAuthUserId: string | null = null;
  try {
    assertSameOriginJsonRequest(request);
    const [admin, body] = await Promise.all([
      requireAdminUser(),
      request.json().then((value) => createSchema.parse(value)),
    ]);
    const loginId = normalizeManagedLoginId(body.loginId);
    if (!isManagedLoginId(loginId)) {
      throw new HttpError(
        400,
        "아이디는 영문 소문자로 시작하고 영문 소문자, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.",
        "INVALID_MANAGED_LOGIN_ID",
      );
    }
    const serviceAccessUntil = body.serviceAccessUntil
      ? new Date(body.serviceAccessUntil)
      : null;
    if (body.accountType === "personal" && (
      !serviceAccessUntil || serviceAccessUntil.getTime() <= Date.now()
    )) {
      throw new HttpError(400, "서비스 이용 만료일은 현재보다 이후여야 합니다.");
    }

    const db = getDb();
    const duplicateRequest = await db`
      select id
      from shorts_mvp.managed_login_accounts
      where create_request_id=${body.requestId}
      limit 1
    `;
    if (duplicateRequest[0]) {
      const paymentRows = await db`
        select public_token
        from shorts_mvp.enterprise_payment_requests
        where managed_account_id=${duplicateRequest[0].id}
        order by created_at
        limit 1
      `;
      return NextResponse.json({
        ok: true,
        accountId: duplicateRequest[0].id,
        paymentPath: paymentRows[0]
          ? `/enterprise-pay/${encodeURIComponent(paymentRows[0].publicToken)}`
          : null,
        alreadyProcessed: true,
      });
    }
    const duplicateLogin = await db`
      select id
      from shorts_mvp.managed_login_accounts
      where login_id=${loginId}
      limit 1
    `;
    if (duplicateLogin[0]) {
      throw new HttpError(409, "이미 사용 중인 아이디입니다.", "MANAGED_LOGIN_ID_DUPLICATE");
    }

    const authEmail = createManagedAuthEmail();
    const authAdmin = createSupabaseAdminClient();
    const { data, error } = await authAdmin.auth.admin.createUser({
      email: authEmail,
      password: body.temporaryPassword,
      email_confirm: true,
      app_metadata: {
        login_type: "managed",
        login_id: loginId,
      },
      user_metadata: {
        full_name: body.displayName,
      },
    });
    if (error || !data.user) {
      throw new HttpError(
        503,
        "인증 계정을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
        "MANAGED_AUTH_CREATE_FAILED",
      );
    }
    createdAuthUserId = data.user.id;

    const account = await db.begin(async (tx) => {
      const appUsers = await tx`
        insert into shorts_mvp.app_users (
          auth_user_id,email,display_name,provider,selected_plan_code,
          manual_service_access_until
        ) values (
          ${data.user.id},${authEmail},${body.displayName},'managed_password','free',
          ${body.accountType === "personal" ? serviceAccessUntil : null}
        )
        returning id
      `;
      const appUserId = appUsers[0].id;
      const accounts = await tx`
        insert into shorts_mvp.managed_login_accounts (
          create_request_id,auth_user_id,app_user_id,login_id,auth_email,
          account_type,is_active,popular_filter_enabled,
          created_by_user_id,updated_by_user_id
        ) values (
          ${body.requestId},${data.user.id},${appUserId},${loginId},${authEmail},
          ${body.accountType},true,${body.popularFilterEnabled},${admin.id},${admin.id}
        )
        returning id
      `;
      const managedAccountId = accounts[0].id;
      let enterprisePaymentRequest: { id: string; publicToken: string } | null = null;
      if (body.accountType === "personal" && body.usageMinutes > 0 && serviceAccessUntil) {
        const seconds = body.usageMinutes * 60;
        await tx`
          insert into shorts_mvp.usage_grants (
            user_id,kind,product_code,total_seconds,credited_seconds,carried_seconds,
            valid_from,expires_at,status
          ) values (
            ${appUserId},'addon',${MANAGED_ACCOUNT_PRODUCT_CODE},${seconds},${seconds},0,
            clock_timestamp(),${serviceAccessUntil},'active'
          )
        `;
      }
      if (body.accountType === "enterprise") {
        enterprisePaymentRequest = await insertEnterpriseBillingRequest({
          db: tx,
          createRequestId: body.requestId,
          managedAccountId,
          appUserId,
          createdByUserId: admin.id,
          customerName: body.displayName,
          customerEmail: body.customerEmail || null,
          title: body.paymentTitle,
          blocksServiceAccess: true,
          items: body.paymentItems,
        });
      }
      await tx`
        insert into shorts_mvp.admin_audit_logs (
          actor_user_id,action,entity_type,entity_id,metadata
        ) values (
          ${admin.id},'managed_account.created','managed_login_account',
          ${managedAccountId},
          ${tx.json({
            loginId,
            displayName: body.displayName,
            accountType: body.accountType,
            usageMinutes: body.accountType === "personal" ? body.usageMinutes : null,
            serviceAccessUntil: serviceAccessUntil?.toISOString() || null,
            popularFilterEnabled: body.popularFilterEnabled,
            enterprisePaymentRequestId: enterprisePaymentRequest?.id || null,
            enterprisePaymentItemCount: body.paymentItems.length,
          })}
        )
      `;
      return {
        id: managedAccountId,
        paymentPath: enterprisePaymentRequest
          ? `/enterprise-pay/${encodeURIComponent(enterprisePaymentRequest.publicToken)}`
          : null,
      };
    });

    return NextResponse.json({
      ok: true,
      accountId: account.id,
      paymentPath: account.paymentPath,
      alreadyProcessed: false,
    }, { status: 201 });
  } catch (error) {
    if (createdAuthUserId) {
      await createSupabaseAdminClient().auth.admin
        .deleteUser(createdAuthUserId)
        .catch(() => undefined);
    }
    const code = (error as { code?: string })?.code;
    if (code === "23505") {
      return apiError(
        new HttpError(409, "이미 사용 중인 아이디입니다.", "MANAGED_LOGIN_ID_DUPLICATE"),
      );
    }
    return apiError(error, "발급 계정을 만들지 못했습니다.");
  }
}
