# Thin wrapper — all logic lives in scripts/*.js and package.json.
# Works in any shell where make + node are available.

.PHONY: dev build test lint release tag dist version clean help major minor patch

# No-op targets so "make release minor" works
major minor patch:
	@node -e ""

# Detect bump type
ifneq ($(filter major,$(MAKECMDGOALS)),)
BUMP := major
else ifneq ($(filter minor,$(MAKECMDGOALS)),)
BUMP := minor
else
BUMP := patch
endif

.DEFAULT_GOAL := help

help:
	@node -e "console.log(['','  WinRaid','','  Dev','    make dev            Start electron-vite dev server','    make build          Build renderer + main','    make test           Run Vitest unit tests','    make lint           Run ESLint','','  Release (CI builds + publishes on the pushed v* tag)','    make release              Lint+test gate, bump patch, tag, push','    make release minor        Bump minor version','    make release major        Bump major version','    make tag                  Bump, tag, push (no quality gate)','    make dist                 Build installer locally (smoke test)','','  Helpers','    make version        Show latest release tag','    make clean          Remove build output',''].join('\n'))"

dev:
	npx electron-vite dev

build:
	npx electron-vite build

test:
	npx vitest run

lint:
	npx eslint src electron

release:
	node scripts/release.js $(BUMP)

tag:
	node scripts/tag.js $(BUMP)

dist:
	npm run dist

version:
	node scripts/version.js

clean:
	node scripts/clean.js
