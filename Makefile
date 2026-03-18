# Version resolution — all parsing done via node (no grep/sed/bash dependency).
#   make release              → auto-bumps patch: v0.2.1 → v0.2.2
#   make release patch        → same as above (default)
#   make release minor        → v0.2.1 → v0.3.0
#   make release major        → v0.2.1 → v1.0.0
#   make release TAG=v1.0.0   → uses supplied tag exactly (escape hatch)

# Detect bump type from positional goal: "make release major" passes "major" as a goal.
# If major/minor/patch appears as a goal, capture it; otherwise default to patch.
ifneq ($(filter major,$(MAKECMDGOALS)),)
TYPE := major
else ifneq ($(filter minor,$(MAKECMDGOALS)),)
TYPE := minor
else
TYPE := patch
endif

# No-op targets so "make release major" doesn't error with "No rule to make target 'major'"
.PHONY: major minor patch
major minor patch:
	@rem

# Compute last tag and next tag entirely via node to avoid grep/sed/bash.
_LAST_TAG   := $(shell node -e "const t=require('child_process').execSync('git tag --sort=-v:refname',{encoding:'utf8'}).split('\n').find(l=>/^v\d+\.\d+\.\d+$$/.test(l))||'';process.stdout.write(t)")
RELEASE_TAG := $(if $(TAG),$(TAG),$(shell node -e "const last='$(_LAST_TAG)';const type='$(TYPE)';if(!last){process.stdout.write('v0.1.0');process.exit()}const[M,m,p]=last.slice(1).split('.').map(Number);const next=type==='major'?[M+1,0,0]:type==='minor'?[M,m+1,0]:[M,m,p+1];process.stdout.write('v'+next.join('.'))"))
RELEASE_VER := $(shell node -e "process.stdout.write('$(RELEASE_TAG)'.replace(/^v/,''))")

.DEFAULT_GOAL := help

# ─── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help:
	@node -e "console.log(['','  WinRaid - development and release commands','','  Dev','    make dev            Start electron-vite dev server','    make build          Build renderer + main (no installer)','    make lint           Run ESLint on src/ and electron/','','  Release','    make release              Bump patch, build + push + GitHub Release','    make release minor        Bump minor version','    make release major        Bump major version','    make release TAG=v1.0.0   Use an explicit tag','    make tag                  Tag + push only (no build, no GH release)','    make dist                 Build installer only (no tag, no publish)','','  Helpers','    make version        Show latest release tag','    make clean          Remove build output (out/ and release/)','    make install        Install npm dependencies','','  Current: $(_LAST_TAG)  Next: $(RELEASE_TAG)',''].join('\n'))"

# ─── Dev ──────────────────────────────────────────────────────────────────────

.PHONY: dev
dev:
	npx electron-vite dev

.PHONY: build
build:
	npx electron-vite build

.PHONY: lint
lint:
	npx eslint src electron

.PHONY: install
install:
	npm install

# ─── Release ──────────────────────────────────────────────────────────────────

# release — full pipeline: validate, bump version, build installer, tag, push, publish GH release.
.PHONY: release
release:
	@node -e "if(!/^v\d+\.\d+\.\d+$$/.test('$(RELEASE_TAG)')){console.error('  ERROR: TAG must match vMAJOR.MINOR.PATCH (got: $(RELEASE_TAG))');process.exit(1)}"
	@node -e "const t=require('child_process').execSync('git tag',{encoding:'utf8'}).split('\n');if(t.includes('$(RELEASE_TAG)')){console.error('  ERROR: tag $(RELEASE_TAG) already exists');process.exit(1)}"
	@echo.
	@echo   Releasing $(RELEASE_TAG)
	@echo.
	@echo   Bumping package.json to $(RELEASE_VER)
	@node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='$(RELEASE_VER)';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
	@git add package.json
	@git diff --cached --quiet || git commit -m "Bump version to $(RELEASE_VER)"
	@echo   Cleaning previous build...
	@if exist release rmdir /s /q release
	@if exist out rmdir /s /q out
	@echo   Building installer...
	npm run dist
	git tag $(RELEASE_TAG)
	git push origin master
	git push origin $(RELEASE_TAG)
	@echo.
	@echo   Publishing GitHub Release $(RELEASE_TAG)...
	node -e "const g=require('child_process');const fs=require('fs');const exe=fs.readdirSync('release').find(n=>n.endsWith('.exe')&&!n.endsWith('.blockmap'));if(!exe){console.error('No .exe found in release/');process.exit(1)}const assets=['\"release/'+exe+'\"'];if(fs.existsSync('release/latest.yml'))assets.push('\"release/latest.yml\"');g.execSync('gh release create $(RELEASE_TAG) --title \"WinRaid $(RELEASE_TAG)\" --generate-notes '+assets.join(' '),{stdio:'inherit'})"
	@echo.
	@echo   Released $(RELEASE_TAG)
	@echo.

# tag — push tag only (useful when CI builds, or you already built locally).
.PHONY: tag
tag:
	@node -e "if(!/^v\d+\.\d+\.\d+$$/.test('$(RELEASE_TAG)')){console.error('  ERROR: TAG must match vMAJOR.MINOR.PATCH (got: $(RELEASE_TAG))');process.exit(1)}"
	@node -e "const t=require('child_process').execSync('git tag',{encoding:'utf8'}).split('\n');if(t.includes('$(RELEASE_TAG)')){console.error('  ERROR: tag $(RELEASE_TAG) already exists');process.exit(1)}"
	@echo.
	@echo   Tagging $(RELEASE_TAG)
	@echo.
	@node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='$(RELEASE_VER)';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
	@git add package.json
	@git diff --cached --quiet || git commit -m "Bump version to $(RELEASE_VER)"
	git tag $(RELEASE_TAG)
	git push origin master
	git push origin $(RELEASE_TAG)
	@echo.
	@echo   Tag $(RELEASE_TAG) pushed
	@echo.

# dist — build the installer without tagging or publishing.
.PHONY: dist
dist:
	npm run dist
	@echo.
	@echo   Installer built in release/
	@echo.

# ─── Helpers ──────────────────────────────────────────────────────────────────

.PHONY: version
version:
	@node -e "console.log('$(_LAST_TAG)' || '(no tags yet)')"

.PHONY: clean
clean:
	@if exist out rmdir /s /q out
	@if exist release rmdir /s /q release
	@echo   Cleaned out/ and release/
