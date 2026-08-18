WORKER_PYTHON ?= .venv/bin/python
WORKER_RUFF ?= .venv/bin/ruff

.PHONY: dev test lint build verify clean

dev:
	cd web && npm run dev

test:
	node --test scripts/*.test.mjs
	cd worker && $(WORKER_PYTHON) -m pytest -q
	cd web && npm run test
	cd web && npm run typecheck
	cd infra/aws && npm run test

lint:
	cd worker && $(WORKER_RUFF) check .
	cd worker && $(WORKER_RUFF) check ../infra/aws/lambda
	cd web && npm run lint
	cd web && npm run typecheck

build:
	cd web && npm run build
	node scripts/synth-production-infrastructure.mjs

verify: lint test build

clean:
	find worker -type d \( -name __pycache__ -o -name .pytest_cache -o -name .ruff_cache \) -prune -exec rm -rf {} +
	rm -rf .ruff_cache web/.next web/.next-dev web/out web/*.tsbuildinfo infra/aws/cdk.out
