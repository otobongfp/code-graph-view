# Build helpers for Code Graph View.
VERSION := $(shell node -p "require('./package.json').version")
VSIX    := code-graph-view-$(VERSION).vsix
VSCE    := npx --yes @vscode/vsce

.PHONY: vsix release install compile test clean

vsix: node_modules
	$(VSCE) package --out $(VSIX)
	@echo "Built $(VSIX)"

release: test vsix  ## Run every test, then package

install: node_modules  ## Install dependencies

node_modules: package-lock.json
	npm ci
	@touch node_modules

compile: node_modules  ## Development build into out/
	npm run compile

test: node_modules  ## Type-check, unit and integration tests
	npm test

clean:
	rm -rf out *.vsix
