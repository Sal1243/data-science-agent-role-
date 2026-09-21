.PHONY: install dev build start test test-e2e check

install:
	python -m venv .venv
	.venv/bin/pip install -r requirements-dev.txt -c requirements.lock.txt
	npm ci

dev:
	./scripts/dev.sh

build:
	npm run build

start: build
	.venv/bin/python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000

test:
	.venv/bin/pytest -q

test-e2e: build
	PATH="$(CURDIR)/.venv/bin:$$PATH" npm run test:e2e

check:
	.venv/bin/ruff check backend tests
	.venv/bin/ruff format --check backend tests
	npm run format:check
	npm run build
	.venv/bin/pytest -q
