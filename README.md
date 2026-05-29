# Git Branch Cleanup

一个用于 VS Code 的本地 Git 分支清理插件。它会检查当前工作区仓库中未合并到主分支、并且最后提交时间达到过期阈值的本地分支。

## 功能

- 通过命令面板运行 `Git Branch Cleanup: 检查过期未合并分支`
- 默认快捷键：
  - macOS: `Cmd+Alt+B`
  - Windows/Linux: `Ctrl+Alt+B`
- 只检查本地分支，不检查远程分支
- 主分支名称可配置，多个分支用英文逗号分隔，默认 `main,master`
- 过期小时数可配置，默认 `720`，等于 30 天
- 使用 Quick Pick 展示过期且未合并的分支
- 支持多选后执行安全删除：`git branch -d -- <branch>`

## 设置

```json
{
  "gitBranchCleanup.mainBranch": "main,master",
  "gitBranchCleanup.staleHours": 720
}
```

## 删除策略

插件只执行 Git 的安全删除命令 `git branch -d`。如果分支没有被 Git 认为可以安全删除，删除会失败并展示失败详情；插件不会使用 `git branch -D` 强制删除。

## 开发

```bash
pnpm install
pnpm run compile
pnpm test
```

在 VS Code 中按 `F5` 可启动 Extension Development Host 进行手动验证。
