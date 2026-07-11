.PHONY: dev test lint clean

dev:
	docker compose up --build

test:
	docker compose build api web-check web
	docker compose run --rm api pytest -q
	docker compose run --rm web-check npm run typecheck
	docker compose run --rm web-check npm run lint

lint:
	docker compose build api web-check
	docker compose run --rm api ruff check .
	docker compose run --rm web-check npm run lint
	docker compose run --rm web-check npm run typecheck

clean:
	docker compose down --remove-orphans
	find storage -mindepth 1 ! -name .gitkeep -delete
	find api -type d \( -name __pycache__ -o -name .pytest_cache -o -name .ruff_cache \) -prune -exec rm -rf {} +
	rm -rf .ruff_cache web/.next web/out web/*.tsbuildinfo
