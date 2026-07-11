.PHONY: dev test lint build verify clean

dev:
	cd web && npm run dev

test:
	cd worker && .venv/bin/python -m pytest -q
	cd web && npm run test
	cd web && npm run typecheck

lint:
	cd worker && .venv/bin/ruff check .
	cd web && npm run lint
	cd web && npm run typecheck

build:
	cd web && npm run build
	cd infra/aws && npm run synth

verify: lint test build

clean:
	find worker -type d \( -name __pycache__ -o -name .pytest_cache -o -name .ruff_cache \) -prune -exec rm -rf {} +
	rm -rf .ruff_cache web/.next web/out web/*.tsbuildinfo infra/aws/cdk.out
