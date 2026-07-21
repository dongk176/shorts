from __future__ import annotations

import argparse
import socket
import time

from .config import Settings
from .worker_pipeline import BatchWorker


def main() -> None:
    parser = argparse.ArgumentParser(description="Shorts MVP AWS Batch worker")
    subparsers = parser.add_subparsers(dest="command", required=True)
    initial = subparsers.add_parser("initial")
    initial.add_argument("--job-id", required=True)
    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--job-id", required=True)
    prepare.add_argument("--attempt", type=int)
    prepare_array = subparsers.add_parser("prepare-array")
    prepare_array.add_argument("--dispatch-batch-id", required=True)
    project = subparsers.add_parser("project")
    project.add_argument("--job-id", required=True)
    project.add_argument("--resume", action="store_true")
    render = subparsers.add_parser("render-shard")
    render.add_argument("--job-id", required=True)
    render.add_argument("--shard-index", type=int)
    rerender = subparsers.add_parser("rerender")
    rerender.add_argument("--short-id", required=True)
    pull = subparsers.add_parser("pull")
    pull.add_argument("--worker-id", default=socket.gethostname())
    pull.add_argument("--poll-seconds", type=float, default=5.0)
    pull.add_argument("--once", action="store_true")
    pull.add_argument("--max-jobs", type=int, default=0)
    pull.add_argument("--idle-timeout", type=float, default=0)
    args = parser.parse_args()
    worker = BatchWorker(Settings())
    if args.command == "initial":
        worker.initial(args.job_id)
    elif args.command == "prepare":
        worker.initial(args.job_id, attempt_override=args.attempt)
    elif args.command == "prepare-array":
        import os

        array_index = int(os.getenv("AWS_BATCH_JOB_ARRAY_INDEX", "0"))
        job_id = worker.repository.get_dispatch_job(args.dispatch_batch_id, array_index)
        if not job_id:
            raise KeyError(f"{args.dispatch_batch_id}:{array_index}")
        worker.prepare(job_id)
    elif args.command == "project":
        worker.project(args.job_id, resume=args.resume)
    elif args.command == "render-shard":
        import os

        shard_index = args.shard_index
        if shard_index is None:
            shard_index = int(os.getenv("AWS_BATCH_JOB_ARRAY_INDEX", "0"))
        worker.render_shard(args.job_id, shard_index)
    elif args.command == "rerender":
        worker.rerender(args.short_id)
    elif args.command == "pull":
        processed = 0
        idle_started = time.monotonic()
        while True:
            claimed = worker.repository.claim_next_mac_job(args.worker_id)
            if claimed:
                idle_started = time.monotonic()
                print(
                    f"Mac worker {args.worker_id} claimed job {claimed['id']} "
                    f"attempt {claimed['attempt_count']}",
                    flush=True,
                )
                try:
                    worker.initial(
                        str(claimed["id"]),
                        attempt_override=int(claimed["attempt_count"]),
                    )
                except Exception as exc:
                    print(f"Job {claimed['id']} failed: {type(exc).__name__}", flush=True)
                processed += 1
                if args.once or (args.max_jobs > 0 and processed >= args.max_jobs):
                    return
            elif args.once:
                return
            elif args.idle_timeout > 0 and (
                time.monotonic() - idle_started >= args.idle_timeout
            ):
                return
            else:
                time.sleep(max(1.0, args.poll_seconds))


if __name__ == "__main__":
    main()
