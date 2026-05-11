# calls common

This repository exists to share common code between the webapp and mobile clients of the [Mattermost Calls product](https://github.com/mattermost/mattermost-plugin-calls). 

Run `make build` before committing, and commit the `lib` directory. CI will fail if the `lib` directory is out of date.

To publish a new version of the package on npm:
1. Update the package.json version field
2. run `npm publish --dry-run` to see what will be packaged
3. run `npm publish --access=public` to publish

## `calls-mobile` branch

The `calls-mobile` branch is the pre-video maintenance line consumed by the Mattermost mobile app. It was forked before the Calls v1 video work landed on `master`, and the mobile app does not want those changes. Only low-risk maintenance (dependency declarations, bug fixes that apply to the pre-video signaling code) should be cherry-picked onto this branch. Do not merge `master` into it.

Mobile pins to a tag (or commit) on this branch. When updating the pin, prefer cutting a new `vX.Y.Z-mobile.N` tag from `calls-mobile` rather than referencing a bare commit.
