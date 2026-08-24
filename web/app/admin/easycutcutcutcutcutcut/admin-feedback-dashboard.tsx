import {
  projectFeedbackReasonLabels,
  type ProjectFeedbackDisappointmentReason,
} from "@/lib/project-feedback";

export type AdminProjectFeedback = {
  id: string;
  email: string;
  displayName: string | null;
  satisfactionRating: number;
  disappointmentReason: ProjectFeedbackDisappointmentReason;
  improvementText: string | null;
  promptCompletionCount: number;
  completedProjectCount: number;
  rewardSeconds: number;
  createdAt: string;
};

export type AdminProjectFeedbackMetrics = {
  responseCount: number;
  averageRating: number;
  rewardMinutes: number;
  deferralCount: number;
  permanentlyDismissedCount: number;
};

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function AdminFeedbackDashboard({
  feedback,
  metrics,
  reasonCounts,
  query,
}: {
  feedback: AdminProjectFeedback[];
  metrics: AdminProjectFeedbackMetrics;
  reasonCounts: Array<{ reason: ProjectFeedbackDisappointmentReason; count: number }>;
  query: string;
}) {
  return (
    <div className="mt-7 grid gap-7">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="피드백 요약">
        {[
          ["응답", `${metrics.responseCount.toLocaleString("ko-KR")}건`],
          ["평균 만족도", metrics.responseCount ? `${metrics.averageRating.toFixed(2)} / 5` : "-"],
          ["지급 보상", `${metrics.rewardMinutes.toLocaleString("ko-KR")}분`],
          ["나중에", `${metrics.deferralCount.toLocaleString("ko-KR")}건`],
          ["12회 후 미노출", `${metrics.permanentlyDismissedCount.toLocaleString("ko-KR")}명`],
        ].map(([label, value]) => (
          <article key={label} className="rounded-2xl border border-white/10 bg-[#171a1b] p-5">
            <p className="text-xs font-bold text-neutral-500">{label}</p>
            <p className="mt-3 text-2xl font-black tracking-tight text-white">{value}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#151819] p-5">
        <h2 className="text-lg font-black">가장 아쉬웠던 점</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {reasonCounts.length ? reasonCounts.map(({ reason, count }) => (
            <span key={reason} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-2 text-xs font-bold text-neutral-300">
              {projectFeedbackReasonLabels[reason]} · {count.toLocaleString("ko-KR")}건
            </span>
          )) : (
            <p className="text-sm text-neutral-500">아직 수집된 응답이 없습니다.</p>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#151819]">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 p-5">
          <div>
            <h2 className="text-lg font-black">피드백 응답</h2>
            <p className="mt-1 text-xs text-neutral-500">최근 200건 · 제출과 동시에 처리시간 30분 지급</p>
          </div>
          <form className="flex gap-2" method="get">
            <input type="hidden" name="tab" value="feedback" />
            <input
              name="q"
              defaultValue={query}
              placeholder="이메일·이름·자유 의견"
              className="h-10 w-64 rounded-xl border border-white/10 bg-black/20 px-3 text-sm outline-none placeholder:text-neutral-600 focus:border-[#ff8c7c]"
            />
            <button className="h-10 rounded-xl bg-white px-4 text-sm font-black text-black transition hover:bg-neutral-200">
              조회
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-black/20 text-xs text-neutral-500">
              <tr>
                <th className="px-5 py-3">응답 시각</th>
                <th className="px-4 py-3">회원</th>
                <th className="px-4 py-3">만족도</th>
                <th className="px-4 py-3">가장 아쉬운 점</th>
                <th className="px-4 py-3">리뷰 한 마디</th>
                <th className="px-4 py-3">노출 시점</th>
                <th className="px-5 py-3">보상</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[.06]">
              {feedback.map((item) => (
                <tr key={item.id} className="align-top hover:bg-white/[.02]">
                  <td className="whitespace-nowrap px-5 py-4 text-xs text-neutral-400">{date(item.createdAt)}</td>
                  <td className="px-4 py-4">
                    <p className="font-bold text-white">{item.displayName || "-"}</p>
                    <p className="mt-1 text-xs text-neutral-500">{item.email}</p>
                  </td>
                  <td className="px-4 py-4">
                    <strong className="text-base text-[#ff9b8d]">{item.satisfactionRating} / 5</strong>
                  </td>
                  <td className="px-4 py-4 font-semibold text-neutral-200">
                    {projectFeedbackReasonLabels[item.disappointmentReason]}
                  </td>
                  <td className="max-w-md px-4 py-4 leading-6 text-neutral-300">
                    {item.improvementText || <span className="text-neutral-600">작성 안 함</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-neutral-400">
                    {item.promptCompletionCount}회차
                    {item.completedProjectCount !== item.promptCompletionCount && (
                      <p className="mt-1 text-xs text-neutral-600">실제 완료 {item.completedProjectCount}개</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 font-bold text-emerald-300">
                    {Math.round(item.rewardSeconds / 60)}분
                  </td>
                </tr>
              ))}
              {!feedback.length && (
                <tr>
                  <td colSpan={7} className="px-5 py-14 text-center text-neutral-500">
                    조건에 맞는 피드백이 없습니다.
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
