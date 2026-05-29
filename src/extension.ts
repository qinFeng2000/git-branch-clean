import * as vscode from 'vscode';
import { deleteLocalBranch, scanStaleBranches, type DeleteBranchResult, type StaleBranch } from './git';

const COMMAND_CHECK_STALE_BRANCHES = 'gitBranchCleanup.checkStaleBranches';

interface BranchQuickPickItem extends vscode.QuickPickItem {
  branch: StaleBranch;
  deletable: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Git Branch Cleanup');
  const command = vscode.commands.registerCommand(COMMAND_CHECK_STALE_BRANCHES, async () => {
    await runBranchCleanup(output);
  });

  context.subscriptions.push(command, output);
}

export function deactivate(): void {
  // Nothing to dispose manually. VS Code disposes subscriptions from activate().
}

async function runBranchCleanup(output: vscode.OutputChannel): Promise<void> {
  const workspaceFolder = getTargetWorkspaceFolder();
  if (!workspaceFolder) {
    void vscode.window.showWarningMessage('请先打开一个包含 Git 仓库的工作区。');
    return;
  }

  const config = vscode.workspace.getConfiguration('gitBranchCleanup');
  const mainBranches = normalizeMainBranches(config.get<string>('mainBranch', 'main,master'));
  const staleHours = normalizeStaleHours(config.get<number>('staleHours', 720));

  try {
    const branches = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '正在检查过期未合并分支...',
        cancellable: false
      },
      () => scanStaleBranches({
        repoPath: workspaceFolder.uri.fsPath,
        mainBranches,
        staleHours
      })
    );

    if (branches.length === 0) {
      void vscode.window.showInformationMessage(`没有发现超过 ${staleHours} 小时且未合并到 ${formatMainBranches(mainBranches)} 的本地分支。`);
      return;
    }

    await showBranchPicker(workspaceFolder.uri.fsPath, branches, output);
  } catch (error) {
    void vscode.window.showErrorMessage(toUserMessage(error));
  }
}

async function showBranchPicker(repoPath: string, branches: StaleBranch[], output: vscode.OutputChannel): Promise<void> {
  const items = branches.map(toQuickPickItem);
  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true,
    placeHolder: '选择要安全删除的本地分支；按 Esc 仅查看后退出',
    title: `发现 ${branches.length} 个过期且未合并的本地分支`
  });

  if (!selected || selected.length === 0) {
    return;
  }

  const deletableItems = selected.filter((item) => item.deletable);
  const skippedItems = selected.filter((item) => !item.deletable);

  if (deletableItems.length === 0) {
    void vscode.window.showWarningMessage('所选分支均不可删除。当前所在分支需要先切换到其他分支后再清理。');
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    `将执行 git branch -d 安全删除 ${deletableItems.length} 个本地分支。Git 可能会拒绝删除尚未完全合并的分支。`,
    { modal: true },
    '删除'
  );

  if (confirmed !== '删除') {
    return;
  }

  const results: DeleteBranchResult[] = [];
  for (const item of deletableItems) {
    results.push(await deleteLocalBranch(repoPath, item.branch.name));
  }

  const successCount = results.filter((result) => result.success).length;
  const failedResults = results.filter((result) => !result.success);
  const skippedText = skippedItems.length > 0 ? `，跳过 ${skippedItems.length} 个不可删除分支` : '';

  if (failedResults.length === 0) {
    void vscode.window.showInformationMessage(`分支清理完成：成功删除 ${successCount} 个${skippedText}。`);
    return;
  }

  writeDeleteFailures(output, results, skippedItems);
  const action = await vscode.window.showWarningMessage(
    `分支清理完成：成功 ${successCount} 个，失败 ${failedResults.length} 个${skippedText}。`,
    '查看详情'
  );

  if (action === '查看详情') {
    output.show(true);
  }
}

function toQuickPickItem(branch: StaleBranch): BranchQuickPickItem {
  const dateText = formatDate(branch.lastCommitDate);
  const currentText = branch.isCurrent ? ' · 当前分支不可删除' : '';

  return {
    label: `$(git-branch) ${branch.name}`,
    description: `${branch.ageHours} 小时前 · ${branch.shortHash}`,
    detail: `最后提交 ${dateText} · 未合并到 ${formatMainBranches(branch.mainBranches)}${currentText}`,
    branch,
    deletable: !branch.isCurrent
  };
}

function writeDeleteFailures(output: vscode.OutputChannel, results: DeleteBranchResult[], skippedItems: BranchQuickPickItem[]): void {
  output.clear();
  output.appendLine('Git Branch Cleanup 删除结果');
  output.appendLine('');

  for (const item of skippedItems) {
    output.appendLine(`SKIP ${item.branch.name}`);
    output.appendLine('  当前所在分支不可删除。');
  }

  for (const result of results) {
    output.appendLine(`${result.success ? 'OK' : 'FAIL'} ${result.branchName}`);
    output.appendLine(`  ${result.message}`);
    if (result.stderr) {
      output.appendLine(`  ${result.stderr}`);
    }
  }
}

function getTargetWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);
    if (activeFolder) {
      return activeFolder;
    }
  }

  return folders[0];
}

function normalizeMainBranches(value: string): string[] {
  const mainBranches = Array.from(new Set(value.split(',').map((mainBranch) => mainBranch.trim()).filter(Boolean)));
  return mainBranches.length > 0 ? mainBranches : ['main', 'master'];
}

function normalizeStaleHours(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 720;
  }

  return Math.floor(value);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function formatMainBranches(mainBranches: string[]): string {
  return mainBranches.join(', ');
}

function toUserMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return '检查分支时发生未知错误。';
}
