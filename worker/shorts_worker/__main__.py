from __future__ import annotations

import argparse

from .config import Settings
from .worker_pipeline import BatchWorker


def main() -> None:
    parser = argparse.ArgumentParser(description="Shorts MVP AWS Batch worker")
    subparsers = parser.add_subparsers(dest="command", required=True)
    initial = subparsers.add_parser("initial")
    initial.add_argument("--job-id", required=True)
    rerender = subparsers.add_parser("rerender")
    rerender.add_argument("--short-id", required=True)
    args = parser.parse_args()
    worker = BatchWorker(Settings())
    if args.command == "initial":
        worker.initial(args.job_id)
    elif args.command == "rerender":
        worker.rerender(args.short_id)


if __name__ == "__main__":
    main()
