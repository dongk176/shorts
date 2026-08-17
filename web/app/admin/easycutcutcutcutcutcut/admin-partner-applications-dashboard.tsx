import Link from "next/link";
import {
  partnerApplicationAudienceLabels,
  partnerApplicationChannelLabels,
  partnerApplicationIncomeLabels,
  partnerApplicationStatusLabels,
  type PartnerApplicationAudienceSize,
  type PartnerApplicationChannelType,
  type PartnerApplicationIncomeGoal,
  type PartnerApplicationStatus,
} from "@/lib/partner-application";
import { updatePartnerApplication } from "./partner-application-actions";

export type AdminPartnerApplication = {
  id: string;
  displayName: string;
  email: string;
  phone: string;
  channelTypes: PartnerApplicationChannelType[];
  channelUrl: string;
  audienceSize: PartnerApplicationAudienceSize;
  promotionPlan: string;
  incomeGoal: PartnerApplicationIncomeGoal;
  status: PartnerApplicationStatus;
  adminNote: string | null;
  consentVersion: string;
  consentedAt: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
  memberEmail: string | null;
  memberDisplayName: string | null;
};

export type AdminPartnerApplicationMetrics = {
  totalCount: number;
  newCount: number;
  reviewingCount: number;
  contactedCount: number;
  acceptedCount: number;
};

const statusClasses: Record<PartnerApplicationStatus, string> = {
  new: "border-rose-300/20 bg-rose-300/10 text-rose-200",
  reviewing: "border-sky-300/20 bg-sky-300/10 text-sky-200",
  contacted: "border-amber-300/20 bg-amber-300/10 text-amber-200",
  accepted: "border-emerald-300/20 bg-emerald-300/10 text-emerald-200",
  rejected: "border-white/10 bg-white/[.04] text-neutral-400",
};

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value)) : "-";
}

function referenceCode(id: string) {
  return `PA-${id.slice(0, 8).toUpperCase()}`;
}

function displayPhone(value: string) {
  if (/^010\d{8}$/.test(value)) {
    return value.replace(/^(010)(\d{4})(\d{4})$/, "$1-$2-$3");
  }
  return value;
}

export function AdminPartnerApplicationsDashboard({
  applications,
  metrics,
  schemaReady,
  initialFilters,
}: {
  applications: AdminPartnerApplication[];
  metrics: AdminPartnerApplicationMetrics;
  schemaReady: boolean;
  initialFilters: { query: string; status: string };
}) {
  if (!schemaReady) {
    return (
      <section className="mt-7 rounded-2xl border border-amber-300/15 bg-amber-300/[.06] p-7">
        <p className="text-sm font-black text-amber-100">파트너 신청 테이블이 아직 준비되지 않았습니다.</p>
        <p className="mt-2 text-xs leading-6 text-amber-100/60">
          로컬 코드에는 접수 기능이 준비되어 있으며, DB 마이그레이션 적용 후 이 화면에 신청 내역이 표시됩니다.
        </p>
      </section>
    );
  }

  return (
    <div className="mt-7 grid gap-7">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="파트너 신청 요약">
        {[
          ["전체 신청", metrics.totalCount],
          ["신규", metrics.newCount],
          ["검토 중", metrics.reviewingCount],
          ["연락 완료", metrics.contactedCount],
          ["선정", metrics.acceptedCount],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
            <p className="text-xs font-bold text-neutral-500">{label}</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-white">
              {Number(value).toLocaleString("ko-KR")}건
            </p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="border-b border-white/10 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-black">파트너 신청</h2>
              <p className="mt-1 text-xs text-neutral-500">
                조건에 맞는 최근 신청 {applications.length.toLocaleString("ko-KR")}건
              </p>
            </div>
            <form className="flex flex-wrap gap-2" method="get">
              <input type="hidden" name="tab" value="partner-applications" />
              <input
                name="q"
                defaultValue={initialFilters.query}
                placeholder="이름·이메일·전화번호"
                className="h-10 w-64 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
              />
              <select
                name="partnerApplicationStatus"
                defaultValue={initialFilters.status}
                aria-label="파트너 신청 상태"
                className="h-10 rounded-xl border border-white/10 bg-[#191c1d] px-3 text-sm"
              >
                <option value="open">진행 중 전체</option>
                <option value="all">모든 상태</option>
                <option value="new">신규</option>
                <option value="reviewing">검토 중</option>
                <option value="contacted">연락 완료</option>
                <option value="accepted">선정</option>
                <option value="rejected">미선정</option>
              </select>
              <button className="h-10 rounded-xl bg-white px-4 text-sm font-black text-black transition hover:bg-neutral-200">
                조회
              </button>
            </form>
          </div>
        </div>

        <div className="divide-y divide-white/[.06]">
          {applications.map((application) => (
            <article key={application.id} className="p-5 transition hover:bg-white/[.02]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClasses[application.status]}`}>
                      {partnerApplicationStatusLabels[application.status]}
                    </span>
                    {application.channelTypes.map((channel) => (
                      <span key={channel} className="rounded-full border border-white/10 bg-white/[.04] px-2.5 py-1 text-xs font-bold text-neutral-300">
                        {partnerApplicationChannelLabels[channel]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-neutral-500">
                    {date(application.createdAt)} · 접수번호 {referenceCode(application.id)}
                  </p>
                </div>
                <p className="text-xs text-neutral-600">최근 갱신 {date(application.updatedAt)}</p>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(280px,.65fr)_320px]">
                <div className="min-w-0 rounded-2xl border border-white/[.07] bg-black/20 p-4">
                  <p className="text-xs font-bold text-neutral-500">활동 계획</p>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-neutral-100">
                    {application.promotionPlan}
                  </p>
                </div>

                <dl className="grid content-start gap-3 text-sm">
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">신청자</dt>
                    <dd className="mt-1 font-black text-white">{application.displayName}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">이메일</dt>
                    <dd className="mt-1 break-all">
                      <a href={`mailto:${application.email}`} className="font-bold text-[#ffac9f] underline decoration-white/20 underline-offset-4 hover:text-white">
                        {application.email}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">전화번호</dt>
                    <dd className="mt-1">
                      <a href={`tel:${application.phone}`} className="font-bold text-[#ffac9f] underline decoration-white/20 underline-offset-4 hover:text-white">
                        {displayPhone(application.phone)}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">대표 채널</dt>
                    <dd className="mt-1 break-all">
                      <a href={application.channelUrl} target="_blank" rel="noreferrer" className="font-bold text-[#ffac9f] underline decoration-white/20 underline-offset-4 hover:text-white">
                        {application.channelUrl}
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">규모 · 목표</dt>
                    <dd className="mt-1 text-neutral-300">
                      {partnerApplicationAudienceLabels[application.audienceSize]} · {partnerApplicationIncomeLabels[application.incomeGoal]}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">회원 연결</dt>
                    <dd className="mt-1 text-neutral-300">
                      {application.memberEmail ? (
                        <Link
                          href={`/admin/easycutcutcutcutcutcut?tab=members&q=${encodeURIComponent(application.memberEmail)}`}
                          className="font-bold text-[#ffac9f] underline decoration-white/20 underline-offset-4 hover:text-white"
                        >
                          {application.memberDisplayName || application.memberEmail}
                        </Link>
                      ) : <span className="text-neutral-500">비회원 또는 이메일 미일치</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-neutral-500">동의 기록</dt>
                    <dd className="mt-1 text-xs text-neutral-500">
                      {application.consentVersion} · {date(application.consentedAt)}
                    </dd>
                  </div>
                </dl>

                <form action={updatePartnerApplication.bind(null, application.id)} className="rounded-2xl border border-white/[.07] bg-black/20 p-4">
                  <label className="block text-xs font-bold text-neutral-500" htmlFor={`partner-status-${application.id}`}>검토 상태</label>
                  <select
                    id={`partner-status-${application.id}`}
                    name="status"
                    defaultValue={application.status}
                    className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-[#191c1d] px-3 text-sm"
                  >
                    {Object.entries(partnerApplicationStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <label className="mt-4 block text-xs font-bold text-neutral-500" htmlFor={`partner-note-${application.id}`}>관리자 메모</label>
                  <textarea
                    id={`partner-note-${application.id}`}
                    name="adminNote"
                    defaultValue={application.adminNote || ""}
                    maxLength={1000}
                    rows={4}
                    placeholder="연락 결과, 검토 의견 등을 기록하세요."
                    className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-[#101314] px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
                  />
                  <button type="submit" className="mt-3 h-10 w-full rounded-xl bg-white text-xs font-black text-black transition hover:bg-neutral-200">
                    상태·메모 저장
                  </button>
                  {application.reviewedAt ? (
                    <p className="mt-3 text-[10px] leading-4 text-neutral-600">
                      {date(application.reviewedAt)}{application.reviewedByEmail ? ` · ${application.reviewedByEmail}` : ""}
                    </p>
                  ) : null}
                </form>
              </div>
            </article>
          ))}
          {!applications.length ? (
            <p className="px-5 py-16 text-center text-sm text-neutral-500">조건에 맞는 파트너 신청이 없습니다.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
