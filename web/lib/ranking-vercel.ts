import { rankingVercelProgress } from "./ranking-vercel-contract";
import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db";
import { HttpError } from "./http";
import { rankingCapability } from "./ranking-runtime";
import { rankingUuid } from "./ranking-access";
import { createRankingOutputUpload } from "./ranking-vercel-output";
import {
  leaseRankingVercelRoute,
  releaseRankingVercelRoutes,
} from "./ranking-vercel-egress";
import { rankingVercelResult } from "./ranking-vercel-contract";
export const rankingUsesVercel = () =>
  process.env.RANKING_EXECUTION_BACKEND === "vercel";
const LIFETIME = 30 * 60_000;
type Session = {
  projectId: string;
  generation: string;
  sandboxName: string;
  baseUrl: string;
  status: string;
  expiresAt: Date;
};
function secret(s: Pick<Session, "projectId" | "generation">) {
  const key = process.env.RANKING_TOKEN_SECRET || "";
  if (key.length < 32)
    throw new HttpError(503, "영상 처리 설정을 확인해 주세요.");
  return createHmac("sha256", key)
    .update(`ranking-vercel-v1.${s.projectId}.${s.generation}`)
    .digest("hex");
}
function base(s: Session) {
  const u = new URL(s.baseUrl);
  if (
    u.protocol !== "https:" ||
    !u.hostname.endsWith(".vercel.run") ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/"
  )
    throw new HttpError(503, "영상 처리 주소를 확인해 주세요.");
  return u.origin;
}
export async function rankingVercelSession(
  project: string,
): Promise<Session | null> {
  const rows =
    await getDb()`select * from shorts_mvp.ranking_vercel_sessions where project_id=${rankingUuid(project)} and status='ready' and expires_at>now()+interval '30 seconds'`;
  return (rows[0] as Session) || null;
}
export async function ensureRankingVercel(
  project: string,
  owner: string,
  origin: string,
) {
  const existing = await rankingVercelSession(project);
  if (existing) return existing;
  const snapshot = process.env.RANKING_VERCEL_SNAPSHOT_ID;
  if (!snapshot) throw new HttpError(503, "영상 처리기를 준비 중입니다.");
  const db = getDb(),
    generation = randomUUID();
  const reserved = await db.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(715614823)`;
    const current =
      await tx`select status,expires_at from shorts_mvp.ranking_vercel_sessions where project_id=${project}`;
    if (
      current[0] &&
      ["ready", "starting"].includes(current[0].status) &&
      new Date(current[0].expiresAt).getTime() > Date.now()
    )
      return false;
    const active =
      await tx`select count(*)::int as count from shorts_mvp.ranking_vercel_sessions where status in ('ready','starting') and expires_at>now()`;
    if (active[0].count >= 3)
      throw new HttpError(
        429,
        "다른 영상 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.",
      );
    await tx`insert into shorts_mvp.ranking_vercel_sessions(project_id,generation,status,expires_at) values(${project},${generation},'starting',now()+interval '3 minutes') on conflict(project_id) do update set generation=excluded.generation,status='starting',expires_at=excluded.expires_at,base_url=null,sandbox_name=null,created_at=now()`;
    return true;
  });
  if (!reserved)
    throw new HttpError(
      409,
      "영상 편집 공간을 준비하고 있습니다. 잠시 후 다시 시도해 주세요.",
    );
  let sandbox: Sandbox | undefined;
  try {
    sandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId: snapshot },
      persistent: false,
      timeout: LIFETIME,
      resources: { vcpus: 2 },
      ports: [8080],
      region: "icn1",
      name: `ranking-${generation}`,
    });
    const session: Session = {
      projectId: project,
      generation,
      sandboxName: sandbox.name,
      baseUrl: sandbox.domain(8080),
      status: "ready",
      expiresAt: new Date(Date.now() + LIFETIME - 15_000),
    };
    base(session);
    const root = path.join(process.cwd(), "private/ranking-runtime");
    const manifest = JSON.parse(
      await readFile(path.join(root, "manifest.json"), "utf8"),
    ) as { archiveSha256: string };
    const content = await readFile(path.join(root, "runtime.tar.gz"));
    if (
      createHash("sha256").update(content).digest("hex") !==
      manifest.archiveSha256
    )
      throw new Error("Runtime checksum mismatch");
    await sandbox.writeFiles([
      { path: "/vercel/sandbox/runtime.tar.gz", content },
      {
        path: "/vercel/sandbox/config.json",
        mode: 0o600,
        content: Buffer.from(
          JSON.stringify({
            project,
            owner,
            secret: secret(session),
            origins: [origin],
          }),
        ),
      },
    ]);
    const unpack = await sandbox.runCommand({
      cmd: "/vercel/sandbox/venv/bin/python",
      args: [
        "-c",
        "import tarfile,pathlib; p=pathlib.Path('/vercel/sandbox/app'); p.mkdir(exist_ok=True); tarfile.open('/vercel/sandbox/runtime.tar.gz').extractall(p,filter='data')",
      ],
    });
    if (unpack.exitCode !== 0) throw new Error("Runtime unpack failed");
    await sandbox.runCommand({
      cmd: "/vercel/sandbox/venv/bin/python",
      args: ["-m", "shorts_worker.ranking_vercel_service"],
      cwd: "/vercel/sandbox/app",
      detached: true,
      env: {
        RANKING_STORAGE_ROOT: "/vercel/sandbox/storage/ranking",
        RANKING_CONFIG_FILE: "/vercel/sandbox/config.json",
        RANKING_YOUTUBE_PO_TOKEN_ENABLED: "1",
      },
    });
    let healthy = false;
    for (let i = 0; i < 20; i++) {
      try {
        const r = await fetch(`${base(session)}/health`, {
          signal: AbortSignal.timeout(2000),
          cache: "no-store",
        });
        if (r.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!healthy) throw new Error("Ranking sandbox not ready");
    await db`update shorts_mvp.ranking_vercel_sessions set sandbox_name=${session.sandboxName},base_url=${session.baseUrl},status='ready',expires_at=${session.expiresAt} where project_id=${project} and generation=${generation}`;
    return session;
  } catch {
    await sandbox?.stop().catch(() => undefined);
    await db`update shorts_mvp.ranking_vercel_sessions set status='failed' where project_id=${project} and generation=${generation}`;
    throw new HttpError(
      503,
      "영상 편집 공간을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
}
export async function rankingVercelAccess(
  method: "GET" | "PUT",
  project: string,
  source: string,
  owner: string,
) {
  const session = await rankingVercelSession(project);
  if (!session)
    throw new HttpError(
      410,
      "미리보기가 만료되었습니다. 영상을 다시 가져와 주세요.",
    );
  const token = rankingCapability(
    secret(session),
    method,
    project,
    source,
    owner,
    Math.floor(Date.now() / 1000) + (method === "PUT" ? 600 : 1800),
  );
  const url = `${base(session)}/sources/${rankingUuid(source)}`;
  return method === "GET"
    ? { url: `${url}?token=${encodeURIComponent(token)}` }
    : { url, token };
}
// Prepare each remote independently so another source's retry never downloads
// successful inputs again. Children share the existing per-owner concurrency cap.
async function prepareRenderSources(project: string, operation: string, task: string) {
  const db = getDb();
  const children = await db.begin(async tx => {
    const owners = await tx`select u.id from shorts_mvp.app_users u join shorts_mvp.ranking_projects p on p.user_id=u.id where p.id=${project} and u.is_admin=true for update of u`;
    if (!owners[0]) throw new HttpError(403, "관리자 전용 기능입니다.");
    await tx`select id from shorts_mvp.ranking_projects where id=${project} for update`;
    const parents = await tx`select * from shorts_mvp.ranking_operations where id=${operation} and status='running'`;
    const parent = parents[0];
    if (!parent) return [];
    if (Date.now() - new Date(parent.createdAt).getTime() > 15 * 60_000) {
      await tx`update shorts_mvp.ranking_operations set status='failed',error='영상 준비 제한 시간을 초과했습니다. 잠시 후 다시 시도해 주세요.',finished_at=now() where id=${operation}`;
      return [];
    }
    const sources = await tx`select * from shorts_mvp.ranking_sources where project_id=${project}`;
    const previous = await tx`select * from shorts_mvp.ranking_operations where project_id=${project} and payload->>'renderOperationId'=${operation}`;
    const counts = await tx`select count(*)::int as count from shorts_mvp.ranking_operations o join shorts_mvp.ranking_projects p on p.id=o.project_id where p.user_id=${owners[0].id} and o.executor='vercel' and o.action!='render' and o.status in ('queued','running')`;
    let available = Math.max(0, 3 - counts[0].count);
    const result: {id: string; rank: number}[] = [];
    const seen = new Set<string>();
    for (const clip of parent.payload.clips as {sourceId: string; rank: number}[]) {
      if (seen.has(clip.sourceId)) continue;
      seen.add(clip.sourceId);
      const source = sources.find(row => row.id === clip.sourceId);
      if (source?.taskId === task && source.status === 'ready' && source.metadata?.previewReady) continue;
      const child = previous.find(row => row.sourceId === clip.sourceId);
      if (child?.status === 'failed' || !source?.remoteUrl) {
        await tx`update shorts_mvp.ranking_operations set status='failed',error=${`${clip.rank}위: ${child?.error || "원본 파일을 다시 추가해 주세요."}`},finished_at=now() where id=${operation}`;
        return [];
      }
      if (child) { result.push({id: child.id, rank: clip.rank}); continue; }
      if (available <= 0) continue;
      available--;
      const id = randomUUID();
      await tx`insert into shorts_mvp.ranking_operations(id,project_id,source_id,action,status,payload,request_id,executor) values(${id},${project},${source.id},'preview','running',${tx.json({renderOperationId: operation, rank: clip.rank})},${randomUUID()},'vercel')`;
      result.push({id, rank: clip.rank});
    }
    return result;
  });
  await Promise.allSettled(children.map(child => syncRankingVercelOperation(project, child.id)));
  const rows = await db`select o.status,o.payload,s.id,s.task_id,s.status as source_status,s.metadata from shorts_mvp.ranking_operations o join shorts_mvp.ranking_sources s on s.project_id=o.project_id where o.id=${operation}`;
  if (!rows[0] || rows[0].status !== 'running') return false;
  const clips = rows[0].payload.clips as {sourceId: string; rank: number}[];
  const pending = clips.find(clip => !rows.some(row => row.id === clip.sourceId && row.taskId === task && row.sourceStatus === 'ready' && row.metadata?.previewReady));
  if (!pending) {
    await db`update shorts_mvp.ranking_operations set result=null where id=${operation} and status='running'`;
    return true;
  }
  const attempts = await db`select count(*)::int as count from shorts_mvp.ranking_route_attempts a join shorts_mvp.ranking_operations o on o.id=a.operation_id where o.project_id=${project} and o.source_id=${pending.sourceId} and o.payload->>'renderOperationId'=${operation}`;
  const message = `${pending.rank}위 영상 가져오는 중 · ${Math.min(10, attempts[0].count + 1)}/10회`;
  await db`update shorts_mvp.ranking_operations set result=${db.json({progressMessage: message})},updated_at=now() where id=${operation} and status='running'`;
  return false;
}

export async function dispatchRankingVercel(
  project: string,
  operation: string,
) {
  const db = getDb();
  const rows =
    await db`select o.*,p.user_id from shorts_mvp.ranking_operations o join shorts_mvp.ranking_projects p on p.id=o.project_id join shorts_mvp.app_users u on u.id=p.user_id where o.id=${operation} and o.project_id=${project} and o.executor='vercel' and o.status='running' and p.deleted_at is null and p.expires_at>now() and u.is_admin=true`;
  if (!rows[0]) return;
  const op = rows[0],
    session = await rankingVercelSession(project);
  if (!session)
    throw new HttpError(
      410,
      "작업 공간이 만료되었습니다. 영상을 다시 가져와 주세요.",
    );
  const sources =
    await db`select id,remote_url,metadata,size_bytes,task_id from shorts_mvp.ranking_sources where project_id=${project}`;
  const source = sources.find((s) => s.id === op.sourceId);
  const task = `vercel:${session.generation}`;
  if (op.action === "render" && !(await prepareRenderSources(project, operation, task))) return;
  await db`update shorts_mvp.ranking_operations set task_id=${task} where id=${operation} and status='running'`;
  const needsYoutube = op.action !== "render" && /youtube\.com|youtu\.be/.test(source?.remoteUrl || "");
  const proxy = needsYoutube
    ? await leaseRankingVercelRoute(operation, task)
    : "";
  if (proxy === null) {
    await db`update shorts_mvp.ranking_operations set task_id=null where id=${operation} and status='running'`;
    return;
  }
  const attempts =
    await db`select count(*)::int as count from shorts_mvp.ranking_route_attempts where operation_id=${operation}`;
  const attempt = attempts[0].count;
  const payload =
    op.action === "render"
      ? {
          action: "render",
          spec: op.payload,
          sources: sources
            .filter(
              (s) =>
                op.payload.clips.some(
                  (c: { sourceId: string }) => c.sourceId === s.id,
                ) || op.payload.backgroundMusic?.sourceId === s.id,
            )
            .map((s) => ({ id: s.id, url: s.remoteUrl })),
          ...(await createRankingOutputUpload(project, operation)),
        }
      : {
          action: op.action === "import" ? "import" : "preview",
          sourceId: source?.id,
          url: source?.remoteUrl,
          kind: source?.metadata?.kind,
          size: Number(source?.sizeBytes),
          remote: source?.metadata?.remote,
        };
  const response = await fetch(`${base(session)}/operations/${operation}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret(session)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, proxy, attempt, maxAttempts: op.payload?.renderOperationId && needsYoutube ? 10 : 3 }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(
      503,
      "영상 처리 연결이 지연됩니다. 잠시 후 다시 확인해 주세요.",
    );
  await db`update shorts_mvp.ranking_operations set task_id=${`vercel:${session.generation}`},updated_at=now() where id=${operation} and status='running'`;
}
export async function syncRankingVercelOperation(
  project: string,
  operation: string,
) {
  const db = getDb();
  const rows =
    await db`select o.*,p.deleted_at,p.expires_at,u.is_admin from shorts_mvp.ranking_operations o join shorts_mvp.ranking_projects p on p.id=o.project_id join shorts_mvp.app_users u on u.id=p.user_id where o.id=${operation} and o.project_id=${project} and executor='vercel' and o.status='running'`;
  if (!rows[0]) return;
  const op = rows[0],
    session = await rankingVercelSession(project);
  let state: {
    status: string;
    attempt?: number;
    result?: Record<string, unknown>;
    error?: string;
    failureCategory?: "bot_check" | "network_error" | "terminal";
    failureReason?: string;
    progress?: unknown;
  };
  if (
    !session ||
    op.deletedAt ||
    !op.isAdmin ||
    new Date(op.expiresAt).getTime() < Date.now()
  )
    state = {
      status: "failed",
      error: "작업 공간이 만료되었습니다. 영상을 다시 가져와 주세요.",
    };
  else if (op.taskId && op.taskId !== `vercel:${session.generation}`)
    state = {
      status: "failed",
      error: "작업 공간이 바뀌었습니다. 영상을 다시 가져와 주세요.",
    };
  else {
    if (!op.taskId && op.payload?.renderOperationId && Date.now() - new Date(op.createdAt).getTime() > 10 * 60_000) {
      state = {status: "failed", error: "다운로드 준비 제한 시간을 초과했습니다. 잠시 후 다시 시도해 주세요."};
    } else {
    if (!op.taskId) {
      await dispatchRankingVercel(project, operation);
      return {stage: "preparing" as const};
    }
    const response = await fetch(`${base(session)}/operations/${operation}`, {
      headers: { Authorization: `Bearer ${secret(session)}` },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (response.status === 404) {
      await dispatchRankingVercel(project, operation);
      return;
    }
    if (!response.ok) return;
    state = await response.json();
    }
  }
  if (!["succeeded", "failed"].includes(state.status)) return rankingVercelProgress(state.progress);
  if (
    state.status === "failed" &&
    op.taskId &&
    session &&
    ["bot_check", "network_error"].includes(state.failureCategory || "")
  ) {
    const attempts =
      await db`select count(*)::int as count from shorts_mvp.ranking_route_attempts where operation_id=${operation}`;
    // Compare the worker attempt before releasing: another poll may already have
    // leased the next route. Never release a newer attempt from a stale response.
    if (attempts[0].count === (state.attempt ?? 0))
      await releaseRankingVercelRoutes(
        operation,
        op.taskId,
        state.failureCategory!,
      );
    const after =
      await db`select count(*)::int as count,max(created_at) as last_attempt_at from shorts_mvp.ranking_route_attempts where operation_id=${operation}`;
    const limit = op.payload?.renderOperationId ? 10 : 3;
    if (after[0].count > 0 && after[0].count < limit && Date.now() - new Date(op.createdAt).getTime() < 10 * 60_000) {
      const delay = [5, 10, 15, 20, 30, 40, 50, 60, 60][Math.min(8, after[0].count - 1)] * 1000;
      const jitter = parseInt(createHash("sha256").update(`${operation}.${after[0].count}`).digest("hex").slice(0, 4), 16) % 1000;
      if (after[0].lastAttemptAt && Date.now() < new Date(after[0].lastAttemptAt).getTime() + delay + jitter) return {stage: "preparing" as const};
      await dispatchRankingVercel(project, operation);
      return;
    }
  }

  if (state.status === "failed" && state.failureCategory) {
    const reason = ["rate_limited","bot_challenge","media_forbidden","connection_error","timeout","format_unavailable","restricted_or_unavailable"].includes(state.failureReason || "") ? state.failureReason : "unknown";
    console.warn("ranking_download_failed", {operation, category:state.failureCategory, reason});
    if (state.failureCategory === "bot_check") state.error = reason === "rate_limited"
      ? "영상 제공처에서 요청을 일시적으로 제한했어요. 잠시 후 다시 시도하거나 영상 파일을 넣어 주세요. 다른 순위는 계속 편집할 수 있어요."
      : "영상 제공처의 봇 확인으로 영상을 가져오지 못했어요. 잠시 후 다시 시도하거나 영상 파일을 넣어 주세요. 다른 순위는 계속 편집할 수 있어요.";
  }
  if (state.status === "succeeded") {
    try {
      state.result = rankingVercelResult(
        project,
        operation,
        op.sourceId,
        state.result,
      );
    } catch {
      state = {
        status: "failed",
        error: "영상 처리 결과를 확인하지 못했습니다. 다시 시도해 주세요.",
      };
    }
  }
  if (op.taskId)
    await releaseRankingVercelRoutes(
      operation,
      op.taskId,
      state.status === "succeeded"
        ? "success"
        : state.failureCategory || "terminal",
    );
  await db.begin(async (tx) => {
    const updated =
      await tx`update shorts_mvp.ranking_operations set status=${state.status},result=${state.result ? tx.json(JSON.parse(JSON.stringify(state.result))) : null},error=${state.error || null},finished_at=now(),updated_at=now() where id=${operation} and executor='vercel' and status='running' returning id`;
    if (!updated[0]) return;
    if (op.sourceId) {
      const metadata = state.result?.source as
        | Record<string, unknown>
        | undefined;
      await tx`update shorts_mvp.ranking_sources set status=${metadata ? "ready" : "failed"},metadata=coalesce(${metadata ? tx.json(JSON.parse(JSON.stringify(metadata))) : null},metadata),task_id=${session ? `vercel:${session.generation}` : null},error=${state.error || null},expires_at=${session?.expiresAt || new Date()} where id=${op.sourceId} and project_id=${project}`;
    } else if (state.status === "succeeded")
      await tx`insert into shorts_mvp.ranking_completion_emails(operation_id) values(${operation}) on conflict do nothing`;
  });
  if (op.action === "render" && state.status === "succeeded")
    await stopRankingVercel(project).catch(() => undefined);
}
export async function reconcileRankingVercel() {
  const rows =
    await getDb()`select id,project_id from shorts_mvp.ranking_operations where executor='vercel' and status='running' order by created_at limit 12`;
  await Promise.allSettled(
    rows.map((row) => syncRankingVercelOperation(row.projectId, row.id)),
  );
}
export async function stopRankingVercel(project: string) {
  const session = await rankingVercelSession(project);
  if (!session) return;
  const active =
    await getDb()`select id from shorts_mvp.ranking_operations where project_id=${project} and status in ('queued','running')`;
  if (active[0])
    throw new HttpError(409, "진행 중인 작업이 끝난 뒤 닫아 주세요.");
  const sandbox = await Sandbox.get({
    name: session.sandboxName,
    resume: false,
  });
  await sandbox.stop();
  await getDb()`update shorts_mvp.ranking_vercel_sessions set status='stopped' where project_id=${project} and generation=${session.generation}`;
}
export async function syncRankingVercelProjects(owner: string) {
  const rows =
    await getDb()`select o.id,o.project_id from shorts_mvp.ranking_operations o join shorts_mvp.ranking_projects p on p.id=o.project_id where p.user_id=${owner} and o.executor='vercel' and o.status='running' order by o.created_at limit 12`;
  await Promise.allSettled(
    rows.map((row) => syncRankingVercelOperation(row.projectId, row.id)),
  );
}

export async function cancelRankingVercelUpload(
  project: string,
  operation: string,
) {
  const row = (
    await getDb()`select executor,action from shorts_mvp.ranking_operations where id=${operation} and project_id=${project}`
  )[0];
  if (row?.executor !== "vercel" || row.action !== "import") return;
  const session = await rankingVercelSession(project);
  if (session) {
    const response = await fetch(`${base(session)}/operations/${operation}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secret(session)}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 409)
      throw new HttpError(409, "업로드가 완료되어 처리 중입니다.");
    if (!response.ok && response.status !== 404)
      throw new HttpError(503, "작업 상태를 확인하지 못했습니다.");
  }
  await getDb().begin(async (tx) => {
    const rows =
      await tx`update shorts_mvp.ranking_operations set status='failed',error='업로드가 중단되었습니다.',finished_at=now() where id=${operation} and project_id=${project} and executor='vercel' and action='import' and status='running' returning source_id`;
    if (rows[0])
      await tx`update shorts_mvp.ranking_sources set status='failed' where id=${rows[0].sourceId} and project_id=${project}`;
  });
}
