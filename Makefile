.PHONY: build dist test run clean stop check-style fix-style run-unit emojis help update-dependencies

# The CI environment variable is set automatically in CircleCI and GitLab CI
CI ?= false

check-style: node_modules ## Checks JS file for ESLint conformity
	@echo Checking for style guide compliance

	npm run lint

fix-style: node_modules ## Fix JS file ESLint issues
	@echo Fixing lint issues to follow style guide

	npm run fix

check-types: node_modules ## Checks TS file for TypeScript confirmity
	@echo Checking for TypeScript compliance

	npm run check-types

node_modules: package.json package-lock.json
	@echo Getting dependencies using npm

ifeq ($(CI),false)
	npm install
else
	# This runs in CI with NODE_ENV=production which doesn't install devDependencies without this flag
	npm ci --include=dev

endif

	touch $@

build: node_modules ## Builds lib
	@echo Building calls-common lib

	npm run build

clean: ## Clears cached; deletes node_modules and dist directories
	@echo Cleaning Web App

	npm run clean

	rm -f .eslintcache

update-dependencies: # Updates the dependencies
	npm update
	npm audit fix
	@echo Automatic dependency update complete.
	@echo You should manually inspect changes to package.json and pin exact versions of packages where appropriate.
