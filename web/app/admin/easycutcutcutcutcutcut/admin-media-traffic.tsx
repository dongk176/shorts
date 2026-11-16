import { getDb } from "@/lib/db";
import { requireAdminUser } from "@/lib/admin";
import { revalidatePath } from "next/cache";
import { formatTrafficBytes } from "@/lib/media-traffic";
const path = "/admin/easycutcutcutcutcutcut";
async function setTestAccount(form: FormData) {
  "use server";
  const admin = await requireAdminUser();
  const email = String(form.get("email") || "")
    .trim()
    .toLowerCase();
  const label =
    String(form.get("label") || "내부 테스트")
      .trim()
      .slice(0, 100) || "내부 테스트";
  if (!email || email.length > 254) return;
  const db = getDb();
  const users =
    await db`select id from shorts_mvp.app_users where lower(email)=${email} limit 1`;
  if (!users[0]) return;
  if (form.get("remove") === "1")
    await db`delete from shorts_mvp.media_traffic_test_accounts where user_id=${users[0].id}`;
  else
    await db`insert into shorts_mvp.media_traffic_test_accounts(user_id,label,updated_by) values(${users[0].id},${label},${admin.id}) on conflict(user_id) do update set label=excluded.label,updated_by=excluded.updated_by,updated_at=now()`;
  revalidatePath(path);
}
const names: Record<string, string> = {
  downloader_report: "다운로더 측정",
  source_download: "링크 원본 받기 (들어온 양)",
  source_preview: "구간 선택·원본 미리보기",
  sequence_preview: "전체 미리보기",
  thumbnail: "썸네일 미리보기",
  upload: "업로드 (서버로 들어온 양)",
  render_output: "완성본 AWS 저장",
  home_example: "홈 예시",
  result_playback: "완성본 재생",
  result_download: "완성본 다운로드",
  vercel_sandbox: "Vercel 영상 처리",
  aws_cloudfront: "AWS 영상 전달",
  aws_storage: "AWS 저장",
  server_write: "서버 측정",
  browser_resource: "브라우저 측정",
  unmeasured: "미측정",
  production: "운영",
  candidate: "배포 후보",
};
export async function AdminMediaTraffic({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  await requireAdminUser();
  const first = (x: string | string[] | undefined) =>
    Array.isArray(x) ? x[0] || "" : x || "";
  const days = [1, 7, 30].includes(Number(first(params.days)))
    ? Number(first(params.days))
    : 7;
  const search = first(params.trafficSearch).trim().slice(0, 100);
  const audience = ["customer", "test", "guest"].includes(
    first(params.audience),
  )
    ? first(params.audience)
    : "all";
  const db = getDb();
  const rows = await db`
 with classified as (
 select e.*,u.email,u.display_name,p.draft->>'title' as title,
 case when t.user_id is not null or e.environment='candidate' then 'test' when e.user_id is null then 'guest' else 'customer' end as audience
 from shorts_mvp.media_traffic_events e left join shorts_mvp.app_users u on u.id=e.user_id
 left join shorts_mvp.ranking_projects p on p.id=e.project_id
 left join shorts_mvp.media_traffic_test_accounts t on t.user_id=e.user_id
 where e.recorded_at>=now()-(${days}::int*interval '1 day')
 ) select user_id,email,display_name,project_id,title,resource,provider,purpose,measurement,environment,audience,
 sum(bytes)::text as bytes,sum(requests)::int as requests,count(*) filter(where interrupted)::int as interrupted,max(recorded_at) as last_seen
 from classified where (${search}='' or email ilike ${"%" + search + "%"} or project_id::text=${search})
 and (${audience}='all' or audience=${audience})
 group by user_id,email,display_name,project_id,title,resource,provider,purpose,measurement,environment,audience
 order by sum(bytes) desc nulls last limit 201`;
  const accounts =
    await db`select u.email,t.label from shorts_mvp.media_traffic_test_accounts t join shorts_mvp.app_users u on u.id=t.user_id order by t.updated_at desc limit 100`;
  const firstRecord =
    await db`select min(recorded_at) as since from shorts_mvp.media_traffic_events`;
  const totals = rows.slice(0, 200).reduce(
    (a, x) => {
      if (["server_write", "downloader_report"].includes(x.measurement))
        a.server += Number(x.bytes || 0);
      if (x.measurement === "browser_resource")
        a.browser += Number(x.bytes || 0);
      if (x.measurement === "unmeasured") a.unknown += x.requests;
      return a;
    },
    { server: 0, browser: 0, unknown: 0 },
  );
  return (
    <section className="space-y-6 p-6 text-slate-100">
      <h1 className="text-2xl font-semibold">영상 트래픽</h1>
      <p className="text-sm text-slate-400">
        랭킹쇼츠와 홈 예시의 전송 기록입니다. 수집 시작:{" "}
        {firstRecord[0]?.since
          ? new Date(firstRecord[0].since).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })
          : "첫 기록 대기"}
        . 기록은 90일 보관하며 이전 사용량은 소급 집계되지 않습니다.
      </p>
      <form className="flex flex-wrap gap-3" method="get">
        <input type="hidden" name="tab" value="traffic" />
        <select
          aria-label="조회 기간"
          name="days"
          defaultValue={days}
          className="rounded bg-slate-800 p-2"
        >
          <option value="1">최근 24시간</option>
          <option value="7">최근 7일</option>
          <option value="30">최근 30일</option>
        </select>
        <select
          aria-label="사용 구분"
          name="audience"
          defaultValue={audience}
          className="rounded bg-slate-800 p-2"
        >
          <option value="all">전체</option>
          <option value="customer">고객</option>
          <option value="test">테스트</option>
          <option value="guest">비로그인</option>
        </select>
        <input
          name="trafficSearch"
          aria-label="고객 이메일 또는 프로젝트 ID"
          placeholder="고객 이메일 또는 프로젝트 ID"
          defaultValue={search}
          className="min-w-64 rounded bg-slate-800 p-2"
        />
        <button className="rounded bg-indigo-600 px-4 py-2">조회</button>
      </form>
      <div className="flex flex-wrap gap-6 rounded bg-slate-800 p-4">
        <span>
          표에 표시된 서버 측정:{" "}
          <strong>{formatTrafficBytes(totals.server)}</strong>
        </span>
        <span>
          브라우저 측정: <strong>{formatTrafficBytes(totals.browser)}</strong>
        </span>
        <span>
          바이트 미측정: <strong>{totals.unknown}건</strong>
        </span>
      </div>
      <p className="text-sm text-slate-400">
        서버 측정은 전송에 성공한 본문 바이트입니다. 네트워크 헤더·재전송·청구
        조정은 포함하지 않습니다. 링크 원본 받기·업로드는 들어온 양, 나머지는
        나간 양입니다. 브라우저 기록은 차단·종료 시 누락될 수 있으며 청구량과
        동일하지 않습니다. 완성본 재생·다운로드는 요청을 기록하며 실제 바이트는
        미측정입니다. 기존에 실행 중이던 영상 처리 공간은 새로 생성된 뒤부터
        측정합니다. 서버와 브라우저 수치를 합쳐 청구량으로 해석하지 마세요.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {[
                "고객 / 구분",
                "프로젝트·영상",
                "전송 위치 / 목적",
                "측정 방식",
                "전송량",
                "요청 / 중단",
                "최근 기록",
              ].map((t) => (
                <th key={t} className="border-b border-slate-700 p-3">
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((x, i) => (
              <tr key={i}>
                <td className="border-b border-slate-800 p-3">
                  {x.displayName || x.email || "비로그인"}
                  <br />
                  <span className="text-slate-400">
                    {x.email}
                    <br />
                    {x.audience === "test"
                      ? "테스트"
                      : x.audience === "guest"
                        ? "비로그인"
                        : "고객"}{" "}
                    · {names[x.environment]}
                  </span>
                </td>
                <td className="max-w-xs break-all border-b border-slate-800 p-3">
                  {x.title || x.projectId || "홈 예시"}
                  <br />
                  <span className="text-xs text-slate-400">
                    {x.projectId}
                    <br />
                    {x.resource}
                  </span>
                </td>
                <td className="border-b border-slate-800 p-3">
                  {names[x.provider]}
                  <br />
                  {names[x.purpose] || x.purpose}
                </td>
                <td className="border-b border-slate-800 p-3">
                  {names[x.measurement]}
                </td>
                <td className="whitespace-nowrap border-b border-slate-800 p-3">
                  {formatTrafficBytes(
                    x.bytes === null ? null : Number(x.bytes),
                  )}
                </td>
                <td className="border-b border-slate-800 p-3">
                  {x.requests} / {x.interrupted}
                </td>
                <td className="border-b border-slate-800 p-3">
                  {new Date(x.lastSeen).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="p-8 text-slate-400">
            선택한 조건의 기록이 아직 없습니다. 미수집은 전송량 0을 의미하지
            않습니다.
          </p>
        )}
        {rows.length > 200 && (
          <p>상위 200개 항목입니다. 고객 또는 기간을 좁혀 조회해 주세요.</p>
        )}
      </div>
      <details className="rounded border border-slate-700 p-4">
        <summary>테스트 계정 관리 ({accounts.length})</summary>
        <p className="my-3 text-sm text-slate-400">
          지정 계정의 기록을 테스트로 분류합니다. 지정 해제하면 고객 사용으로
          다시 표시됩니다. 배포 후보에서 발생한 기록은 항상 테스트로 표시됩니다.
        </p>
        <form action={setTestAccount} className="flex flex-wrap gap-2">
          <input
            name="email"
            type="email"
            required
            placeholder="테스트 계정 이메일"
            aria-label="테스트 계정 이메일"
            className="rounded bg-slate-800 p-2"
          />
          <input
            name="label"
            placeholder="테스트 이름"
            aria-label="테스트 이름"
            className="rounded bg-slate-800 p-2"
          />
          <button className="rounded bg-indigo-600 px-3">테스트로 지정</button>
        </form>
        {accounts.map((x) => (
          <form
            action={setTestAccount}
            key={x.email}
            className="mt-3 flex gap-3"
          >
            <input type="hidden" name="email" value={x.email} />
            <input type="hidden" name="remove" value="1" />
            <span>
              {x.email} · {x.label}
            </span>
            <button className="underline">지정 해제</button>
          </form>
        ))}
      </details>
    </section>
  );
}
