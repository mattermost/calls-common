# calls common

This repository exists to share common code between the webapp and mobile clients of the [Mattermost Calls product](https://github.com/mattermost/mattermost-plugin-calls). 

Run `make build` before committing, and commit the `lib` directory. CI will fail if the `lib` directory is out of date.

To publish a new version of the package on npm:
1. Update the package.json version field
2. run `npm publish --dry-run` to see what will be packaged
3. run `npm publish --access=public` to publish
