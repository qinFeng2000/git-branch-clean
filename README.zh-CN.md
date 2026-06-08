# Git Branch Clean

[English](README.md) | [简体中文](README.zh-CN.md)

Git Branch Clean 是一个 VS Code 插件，用于检查并安全清理当前工作区里的过期本地 Git 分支。

从 Visual Studio Marketplace 安装：

[点击打开 Git Branch Clean 市场页面](https://marketplace.visualstudio.com/items?itemName=flsh.git-branch-clean)

打开链接后点击 **Install**，即可在 VS Code 中直接使用。

插件会检查已经合并到配置主分支的本地分支，以及最后提交时间达到过期阈值的未合并分支，并允许你通过 `git branch -d` 安全删除选中的分支。

版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 功能

- 通过命令面板运行：`Git Branch Clean: 检查过期分支`
- 默认快捷键：
  - macOS：`Cmd+Alt+B`
  - Windows/Linux：`Ctrl+Alt+B`
- 只检查本地分支，不检查或删除远程分支
- 支持多个主分支名称，使用英文逗号分隔。默认：`main,master`
- 已合并到主分支的分支不受过期时间限制，并会在 Quick Pick 中默认勾选，按回车即可安全删除
- 未合并分支达到过期阈值后才会展示。默认：`720` 小时，也就是 30 天
- 可选在检查前执行 `git fetch --all --prune`，并使用 `origin/main` 这类远程主分支参与已合并判断
- 未合并到主分支的过期分支需要第二个 Quick Pick 确认，但不用再次勾选
- 支持 include/exclude 分支模式，并支持 `*` 通配符
- 优先执行安全删除：`git branch -d -- <branch>`
- 安全删除失败后，会询问是否对失败分支执行强制删除：`git branch -D -- <branch>`

## 设置

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

### `gitBranchCleanup.fetchRemoteBeforeScan`

检查前是否执行 `git fetch --all --prune`，并使用远程主分支引用参与已合并判断。

默认：

```json
false
```

## 删除策略

插件总是优先执行 Git 的安全删除命令：

```bash
git branch -d -- <branch>
```

如果 Git 拒绝删除某个分支，通常是因为 Git 不认为该分支已经完全合并，插件会提示是否只对这些失败分支执行强制删除：

```bash
git branch -D -- <branch>
```

强制删除只会在你明确确认后执行。

## 开发

```bash
pnpm install
pnpm run compile
pnpm test
pnpm run package:vsix
```

在 VS Code 中按 `F5` 可以启动 Extension Development Host 进行手动验证。

## Release 发布

GitHub Release 由 `.github/workflows/release.yml` 自动发布。

1. 更新 `package.json` 版本号和 `CHANGELOG.md`
2. 提交发布相关改动
3. 创建并推送匹配版本号的 tag：

```bash
git tag v0.1.5
git push origin v0.1.5
```

工作流会校验 tag 与插件版本号是否一致，运行测试，打包扩展，并把生成的 VSIX 上传到 GitHub Release。
