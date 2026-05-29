# Git Branch Cleanup

[English](README.md) | [简体中文](README.zh-CN.md)

Git Branch Cleanup 是一个 VS Code 插件，用于检查并安全清理当前工作区里的过期本地 Git 分支。

插件会检查最后提交时间达到过期阈值的本地分支，展示它们是否已经合并到配置的主分支，并允许你通过 `git branch -d` 安全删除选中的分支。

## 功能

- 通过命令面板运行：`Git Branch Cleanup: Check Stale Branches`
- 默认快捷键：
  - macOS：`Cmd+Alt+B`
  - Windows/Linux：`Ctrl+Alt+B`
- 只检查本地分支，不检查或删除远程分支
- 支持多个主分支名称，使用英文逗号分隔。默认：`main,master`
- 过期阈值按小时配置。默认：`720` 小时，也就是 30 天
- 已合并到主分支的过期分支会在 Quick Pick 中默认勾选，按回车即可安全删除
- 未合并到主分支的过期分支需要在第二个 Quick Pick 中再次选择
- 支持 include/exclude 分支模式，并支持 `*` 通配符
- 只执行安全删除：`git branch -d -- <branch>`，不会使用 `git branch -D`

## 设置

```json
{
  "gitBranchCleanup.mainBranch": "main,master",
  "gitBranchCleanup.staleHours": 720,
  "gitBranchCleanup.includeBranchPatterns": "chore/*,feature/*",
  "gitBranchCleanup.excludeBranchPatterns": "chore/keep-*"
}
```

### `gitBranchCleanup.mainBranch`

用于判断本地分支是否已合并的主分支名称，多个分支用英文逗号分隔。

默认：

```json
"main,master"
```

### `gitBranchCleanup.staleHours`

分支最后提交达到或超过多少小时后被视为过期。

默认：

```json
720
```

### `gitBranchCleanup.includeBranchPatterns`

要纳入检查的分支模式，多个模式用英文逗号分隔，支持 `*`。

默认：

```json
"*"
```

### `gitBranchCleanup.excludeBranchPatterns`

要排除的分支模式，多个模式用英文逗号分隔，支持 `*`。

默认：

```json
""
```

## 删除策略

插件只执行 Git 的安全删除命令：

```bash
git branch -d -- <branch>
```

如果 Git 拒绝删除某个分支，通常是因为 Git 不认为该分支已经完全合并，插件会展示失败详情。插件不会强制删除分支。

## 开发

```bash
pnpm install
pnpm run compile
pnpm test
pnpm run package:vsix
```

在 VS Code 中按 `F5` 可以启动 Extension Development Host 进行手动验证。
