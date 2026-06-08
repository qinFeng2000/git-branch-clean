# Changelog

All notable changes to Git Branch Clean are documented in this file.

## 0.1.4 - 2026-06-08

### Added

- Added `gitBranchCleanup.fetchRemoteBeforeScan` to optionally run `git fetch --all --prune` before scanning.
- Added remote main branch refs, such as `origin/main`, to merge detection when remote fetching is enabled.

### Changed

- Merged branches are now shown regardless of the stale-hours threshold.
- Unmerged branches still require the configured stale-hours threshold before being shown.
- Updated README documentation for merged-branch cleanup and remote main branch comparison.

## 0.1.3 - 2026-06-01

### Added

- Added a force-delete prompt after safe deletion fails. The extension now asks before running `git branch -D -- <branch>` on failed branches.
- Added test coverage for force deletion and current-branch protection.
- Added this changelog.

### Changed

- Changed the unmerged-branch confirmation flow so users do not need to select the same branches again in the second Quick Pick.
- Fixed the test script to run compiled test files from `dist/test/*.js`.
- Updated English and Simplified Chinese README cleanup behavior documentation.

## 0.1.1 - 2026-06-01

### Changed

- Updated extension metadata for Marketplace publishing.
- Updated the extension display name to `Git Branch Clean`.
- Updated the publisher ID to `flsh`.
- Added Marketplace install links to the README files.

## 0.1.0 - 2026-06-01

### Added

- Initial VS Code extension implementation.
- Added the `gitBranchCleanup.checkStaleBranches` command.
- Added default keybindings: `Cmd+Alt+B` on macOS and `Ctrl+Alt+B` on Windows/Linux.
- Added configurable main branch names with default `main,master`.
- Added configurable stale threshold in hours with default `720`.
- Added include and exclude branch pattern settings.
- Added local branch scanning with merged and unmerged branch status.
- Added Quick Pick cleanup flow with merged stale branches preselected.
- Added safe deletion with `git branch -d -- <branch>`.
- Added GPL-3.0-only license and extension icon.
