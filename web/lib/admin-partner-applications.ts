import "server-only";

import type {
  AdminPartnerApplication,
  AdminPartnerApplicationMetrics,
} from "@/app/admin/easycutcutcutcutcutcut/admin-partner-applications-dashboard";
import { getDb } from "@/lib/db";
import type {
  PartnerApplicationAudienceSize,
  PartnerApplicationChannelType,
  PartnerApplicationIncomeGoal,
  PartnerApplicationStatus,
} from "@/lib/partner-application";

export type AdminPartnerApplicationPage = {
  applications: AdminPartnerApplication[];
  metrics: AdminPartnerApplicationMetrics;
  schemaReady: boolean;
};

function iso(value: unknown) {
  return value instanceof Date ? value.toISOString() : value ? new Date(String(value)).toISOString() : null;
}

function emptyPage(schemaReady: boolean): AdminPartnerApplicationPage {
  return {
    applications: [],
    metrics: { totalCount: 0, newCount: 0, reviewingCount: 0, contactedCount: 0, acceptedCount: 0 },
    schemaReady,
  };
}

export async function loadAdminPartnerApplications(filters: {
  query: string;
  status: string;
}): Promise<AdminPartnerApplicationPage> {
  const db = getDb();
  try {
    const [rows, metricRows] = await Promise.all([
      db`
        select
          application.id,application.display_name,application.applicant_email,
          application.phone,application.channel_types,application.channel_url,
          application.audience_size,application.promotion_plan,application.income_goal,
          application.status,application.admin_note,application.consent_version,
          application.consented_at,application.created_at,application.updated_at,
          application.reviewed_at,reviewer.email as reviewed_by_email,
          member.email as member_email,member.display_name as member_display_name
        from shorts_mvp.partner_applications application
        left join shorts_mvp.app_users member on member.id=application.user_id
        left join shorts_mvp.app_users reviewer on reviewer.id=application.reviewed_by_user_id
        where (
          (${filters.status}='open' and application.status in ('new','reviewing','contacted'))
          or ${filters.status}='all'
          or (${filters.status} not in ('open','all') and application.status=${filters.status})
        )
          and (
            ${filters.query}=''
            or lower(application.display_name) like ${`%${filters.query.toLowerCase()}%`}
            or lower(application.applicant_email) like ${`%${filters.query.toLowerCase()}%`}
            or application.phone like ${`%${filters.query.replace(/\D/g, "")}%`}
            or lower(application.channel_url) like ${`%${filters.query.toLowerCase()}%`}
            or application.id::text=${filters.query}
          )
        order by application.created_at desc
        limit 200
      `,
      db`
        select
          count(*)::integer as total_count,
          count(*) filter (where status='new')::integer as new_count,
          count(*) filter (where status='reviewing')::integer as reviewing_count,
          count(*) filter (where status='contacted')::integer as contacted_count,
          count(*) filter (where status='accepted')::integer as accepted_count
        from shorts_mvp.partner_applications
      `,
    ]);

    return {
      schemaReady: true,
      applications: rows.map((row) => ({
        id: String(row.id),
        displayName: String(row.displayName),
        email: String(row.applicantEmail),
        phone: String(row.phone),
        channelTypes: (row.channelTypes || []) as PartnerApplicationChannelType[],
        channelUrl: String(row.channelUrl),
        audienceSize: row.audienceSize as PartnerApplicationAudienceSize,
        promotionPlan: String(row.promotionPlan),
        incomeGoal: row.incomeGoal as PartnerApplicationIncomeGoal,
        status: row.status as PartnerApplicationStatus,
        adminNote: row.adminNote ? String(row.adminNote) : null,
        consentVersion: String(row.consentVersion),
        consentedAt: iso(row.consentedAt)!,
        createdAt: iso(row.createdAt)!,
        updatedAt: iso(row.updatedAt)!,
        reviewedAt: iso(row.reviewedAt),
        reviewedByEmail: row.reviewedByEmail ? String(row.reviewedByEmail) : null,
        memberEmail: row.memberEmail ? String(row.memberEmail) : null,
        memberDisplayName: row.memberDisplayName ? String(row.memberDisplayName) : null,
      })),
      metrics: {
        totalCount: Number(metricRows[0]?.totalCount || 0),
        newCount: Number(metricRows[0]?.newCount || 0),
        reviewingCount: Number(metricRows[0]?.reviewingCount || 0),
        contactedCount: Number(metricRows[0]?.contactedCount || 0),
        acceptedCount: Number(metricRows[0]?.acceptedCount || 0),
      },
    };
  } catch (error) {
    if ((error as { code?: string })?.code === "42P01") return emptyPage(false);
    throw error;
  }
}
