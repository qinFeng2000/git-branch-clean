# Git Branch Clean

[English](README.md) | [简体中文](README.zh-CN.md)

Git Branch Clean is a VS Code extension for finding and safely cleaning up stale local Git branches in the current workspace.

Install from Visual Studio Marketplace:

[Open Git Branch Clean in Marketplace](https://marketplace.visualstudio.com/items?itemName=flsh.git-branch-clean)

Open the link, click **Install**, and start using the command in VS Code.

It checks local branches that have already been merged into your configured main branches, plus unmerged branches whose latest commit age reaches the configured threshold, and lets you safely delete selected branches with `git branch -d`.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Features

- Run from the Command Palette: `Git Branch Clean: 检查过期分支`
- Default keybinding:
  - macOS: `Cmd+Alt+B`
  - Windows/Linux: `Ctrl+Alt+B`
- Checks local branches only. Remote branches are not scanned or deleted.
- Supports multiple main branch names, separated by commas. Default: `main,master`
- Merged branches are not limited by the stale threshold and are preselected in Quick Pick, so pressing Enter safely deletes them.
- Unmerged branches are shown only after they reach the stale threshold. Default: `720` hours, equal to 30 days.
- Optionally fetches remote refs before scanning and uses remote main branches, such as `origin/main`, for merge detection.
- Unmerged stale branches require a second Quick Pick confirmation, without selecting the same branches again.
- Supports include and exclude branch patterns with `*` wildcards.
- Uses safe deletion first: `git branch -d -- <branch>`.
- If safe deletion fails, it asks before force deleting failed branches with `git branch -D -- <branch>`.

## Settings

```json
{
  "gitBranchCleanup.mainBranch": "main,master",
  "gitBranchCleanup.staleHours": 720,
  "gitBranchCleanup.includeBranchPatterns": "chore/*,feature/*",
  "gitBranchCleanup.excludeBranchPatterns": "chore/keep-*",
  "gitBranchCleanup.fetchRemoteBeforeScan": false
}
```

### `gitBranchCleanup.mainBranch`

Comma-separated main branch names used to determine whether a local branch has been merged.

Default:

```json
"main,master"
```

### `gitBranchCleanup.staleHours`

How many hours since the latest commit before a local branch is considered stale.

Default:

```json
720
```

### `gitBranchCleanup.includeBranchPatterns`

Comma-separated branch patterns to include in the scan. Supports `*`.

Default:

```json
"*"
```

### `gitBranchCleanup.excludeBranchPatterns`

Comma-separated branch patterns to exclude from the scan. Supports `*`.

Default:

```json
""
```

### `gitBranchCleanup.fetchRemoteBeforeScan`

Whether to run `git fetch --all --prune` before scanning and include remote main branch refs in merge detection.

Default:

```json
false
```

## Cleanup Behavior

The extension always tries Git's safe delete command first:

```bash
git branch -d -- <branch>
```

If Git refuses to delete a branch, usually because it is not considered fully merged, the extension shows the failure and asks whether to force delete only those failed branches:

```bash
git branch -D -- <branch>
```

Force delete only runs after explicit confirmation.

## Development

```bash
pnpm install
pnpm run compile
pnpm test
pnpm run package:vsix
```

Press `F5` in VS Code to start an Extension Development Host for manual testing.
