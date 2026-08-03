import {
  userDiscoverySourceOptions,
  userOccupationOptions,
  userUsagePurposeOptions,
  type UserDiscoverySource,
  type UserOccupation,
  type UserUsagePurpose,
} from "@/lib/user-onboarding";

export type AdminUserOnboardingResponse = {
  userId: string;
  email: string;
  displayName: string | null;
  occupation: UserOccupation;
  occupationOther: string | null;
  usagePurposes: UserUsagePurpose[];
  usagePurposeOther: string | null;
  discoverySource: UserDiscoverySource | null;
  discoverySourceOther: string | null;
  onboardingVersion: number;
  completedAt: string;
};

export type AdminUserOnboardingMetrics = {
  responseCount: number;
  totalMemberCount: number;
};

const occupationLabels = new Map<string, string>(
  userOccupationOptions.map((option) => [option.value, option.label]),
);
const usagePurposeLabels = new Map<string, string>(
  userUsagePurposeOptions.map((option) => [option.value, option.label]),
);
const discoverySourceLabels = new Map<string, string>(
  userDiscoverySourceOptions.map((option) => [option.value, option.label]),
);

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function percentage(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0%";
}

export function AdminOnboardingDashboard({
  responses,
  metrics,
  occupationCounts,
  usagePurposeCounts,
  discoverySourceCounts,
  query,
}: {
  responses: AdminUserOnboardingResponse[];
  metrics: AdminUserOnboardingMetrics;
  occupationCounts: Array<{ occupation: UserOccupation; count: number }>;
  usagePurposeCounts: Array<{ purpose: UserUsagePurpose; count: number }>;
  discoverySourceCounts: Array<{ discoverySource: UserDiscoverySource; count: number }>;
  query: string;
}) {
  const unansweredCount = Math.max(metrics.totalMemberCount - metrics.responseCount, 0);

  return (
    <div className="mt-7 grid gap-7">
      <section className="grid gap-3 sm:grid-cols-3" aria-label="온보딩 응답 요약">
        {[
          ["응답 완료", `${metrics.responseCount.toLocaleString("ko-KR")}명`],
          ["미응답", `${unansweredCount.toLocaleString("ko-KR")}명`],
          ["응답률", percentage(metrics.responseCount, metrics.totalMemberCount)],
        ].map(([label, value]) => (
          <article key={label} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
            <p className="text-xs font-bold text-neutral-500">{label}</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-white">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3" aria-label="온보딩 응답 분포">
        <article className="rounded-2xl border border-white/10 bg-[#151819] p-5">
          <h2 className="text-lg font-black">직업 분포</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {occupationCounts.length ? occupationCounts.map(({ occupation, count }) => (
              <span
                key={occupation}
                className="rounded-full border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-bold text-neutral-300"
              >
                {occupationLabels.get(occupation) || occupation} · {count.toLocaleString("ko-KR")}명
              </span>
            )) : (
              <p className="text-sm text-neutral-500">아직 수집된 응답이 없습니다.</p>
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-[#151819] p-5">
          <h2 className="text-lg font-black">이용 목적 분포</h2>
          <p className="mt-1 text-xs text-neutral-500">복수 선택이므로 응답자 수보다 합계가 클 수 있습니다.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {usagePurposeCounts.length ? usagePurposeCounts.map(({ purpose, count }) => (
              <span
                key={purpose}
                className="rounded-full border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-bold text-neutral-300"
              >
                {usagePurposeLabels.get(purpose) || purpose} · {count.toLocaleString("ko-KR")}명
              </span>
            )) : (
              <p className="text-sm text-neutral-500">아직 수집된 응답이 없습니다.</p>
            )}
          </div>
        </article>

        <article className="rounded-2xl border border-white/10 bg-[#151819] p-5">
          <h2 className="text-lg font-black">유입 경로 분포</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {discoverySourceCounts.length
              ? discoverySourceCounts.map(({ discoverySource, count }) => (
                <span
                  key={discoverySource}
                  className="rounded-full border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-bold text-neutral-300"
                >
                  {discoverySourceLabels.get(discoverySource) || discoverySource}
                  {" · "}
                  {count.toLocaleString("ko-KR")}명
                </span>
              ))
              : (
                <p className="text-sm text-neutral-500">아직 수집된 응답이 없습니다.</p>
              )}
          </div>
        </article>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <h2 className="text-lg font-black">온보딩 응답</h2>
            <p className="mt-1 text-xs text-neutral-500">최근 응답순 최대 200명</p>
          </div>
          <form className="flex w-full gap-2 sm:w-auto" method="get">
            <input type="hidden" name="tab" value="onboarding" />
            <input
              name="q"
              defaultValue={query}
              placeholder="이메일·이름·기타 답변"
              className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c] sm:w-64"
            />
            <button className="h-10 rounded-xl bg-white px-4 text-sm font-black text-black transition hover:bg-neutral-200">
              조회
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500">
              <tr>
                <th className="px-5 py-3">응답 시각</th>
                <th className="px-4 py-3">회원</th>
                <th className="px-4 py-3">직업</th>
                <th className="px-4 py-3">이용 목적</th>
                <th className="px-4 py-3">유입 경로</th>
                <th className="px-5 py-3">설문 버전</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.06]">
              {responses.map((response) => (
                <tr key={response.userId} className="align-top hover:bg-white/[.02]">
                  <td className="whitespace-nowrap px-5 py-4 text-xs text-neutral-400">
                    {date(response.completedAt)}
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-bold text-white">{response.displayName || "-"}</p>
                    <p className="mt-1 text-xs text-neutral-500">{response.email}</p>
                  </td>
                  <td className="px-4 py-4 font-semibold text-neutral-200">
                    <p>{occupationLabels.get(response.occupation) || response.occupation}</p>
                    {response.occupationOther && (
                      <p className="mt-1 text-xs font-normal text-[#ffb4a8]">{response.occupationOther}</p>
                    )}
                  </td>
                  <td className="max-w-xl px-4 py-4">
                    <div className="flex flex-wrap gap-1.5">
                      {response.usagePurposes.map((purpose) => (
                        <span
                          key={purpose}
                          className="rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-xs font-bold text-neutral-300"
                        >
                          {usagePurposeLabels.get(purpose) || purpose}
                        </span>
                      ))}
                    </div>
                    {response.usagePurposeOther && (
                      <p className="mt-2 text-xs text-[#ffb4a8]">기타: {response.usagePurposeOther}</p>
                    )}
                  </td>
                  <td className="px-4 py-4 font-semibold text-neutral-200">
                    <p>
                      {response.discoverySource
                        ? discoverySourceLabels.get(response.discoverySource)
                          || response.discoverySource
                        : "-"}
                    </p>
                    {response.discoverySourceOther && (
                      <p className="mt-1 text-xs font-normal text-[#ffb4a8]">
                        {response.discoverySourceOther}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-neutral-400">
                    v{response.onboardingVersion}
                  </td>
                </tr>
              ))}
              {!responses.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-14 text-center text-neutral-500">
                    조건에 맞는 온보딩 응답이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
