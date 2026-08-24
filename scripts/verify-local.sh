#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run test
npm --prefix web run build
node --test scripts/*.test.mjs
worker/.venv/bin/ruff check worker infra/aws/lambda
worker/.venv/bin/python -m pytest -q worker/tests
npm --prefix infra/aws run test
npm --prefix infra/aws run synth
