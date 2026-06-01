import * as vscode from 'vscode';
import { deleteLocalBranch, forceDeleteLocalBranch, scanStaleBranches, type DeleteBranchResult, type StaleBranch } from './git';
import { formatBranchAge } from './time';

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
  const includeBranchPatterns = normalizeCommaSeparatedList(config.get<string>('includeBranchPatterns', '*'), ['*']);
  const excludeBranchPatterns = normalizeCommaSeparatedList(config.get<string>('excludeBranchPatterns', ''), []);
  const staleHours = normalizeStaleHours(config.get<number>('staleHours', 720));

  try {
    const branches = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '正在检查过期分支...',
        cancellable: false
      },
      () => scanStaleBranches({
        repoPath: workspaceFolder.uri.fsPath,
        mainBranches,
        includeBranchPatterns,
        excludeBranchPatterns,
        staleHours
      })
    );

    if (branches.length === 0) {
      void vscode.window.showInformationMessage(`没有发现超过 ${staleHours} 小时、匹配 ${formatBranchFilters(includeBranchPatterns, excludeBranchPatterns)} 的本地分支。`);
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
    placeHolder: '已合并分支已默认勾选，回车执行安全删除；未合并分支会追加一次确认',
    title: `发现 ${branches.length} 个过期本地分支`
  });

  if (!selected || selected.length === 0) {
    return;
  }

  const selectedDeletableItems = selected.filter((item) => item.deletable);
  const skippedItems = selected.filter((item) => !item.deletable);
  const mergedItems = selectedDeletableItems.filter((item) => item.branch.isMerged);
  const selectedUnmergedItems = selectedDeletableItems.filter((item) => !item.branch.isMerged);
  const confirmedUnmergedItems = selectedUnmergedItems.length > 0 ? await showUnmergedBranchPicker(selectedUnmergedItems) : [];
  const deletableItems = [...mergedItems, ...confirmedUnmergedItems];
  const unconfirmedUnmergedCount = selectedUnmergedItems.length - confirmedUnmergedItems.length;

  if (deletableItems.length === 0) {
    const skippedText = skippedItems.length > 0 ? '当前所在分支需要先切换到其他分支后再清理。' : '未选择可删除分支。';
    void vscode.window.showWarningMessage(skippedText);
    return;
  }

  const safeResults: DeleteBranchResult[] = [];
  for (const item of deletableItems) {
    safeResults.push(await deleteLocalBranch(repoPath, item.branch.name));
  }

  const successCount = safeResults.filter((result) => result.success).length;
  const failedResults = safeResults.filter((result) => !result.success);
  const skippedText = skippedItems.length > 0 ? `，跳过 ${skippedItems.length} 个不可删除分支` : '';
  const unconfirmedText = unconfirmedUnmergedCount > 0 ? `，未确认 ${unconfirmedUnmergedCount} 个未合并分支` : '';

  if (failedResults.length === 0) {
    void vscode.window.showInformationMessage(`分支清理完成：成功删除 ${successCount} 个${skippedText}${unconfirmedText}。`);
    return;
  }

  writeDeleteReport(output, safeResults, skippedItems);
  const forceAction = await vscode.window.showWarningMessage(
    `安全删除完成：成功 ${successCount} 个，失败 ${failedResults.length} 个${skippedText}${unconfirmedText}。是否强制删除失败分支？`,
    {
      modal: true,
      detail: `强制删除会执行 git branch -D -- <branch>，可能丢失未合并提交。失败分支：${formatBranchNameList(failedResults.map((result) => result.branchName))}`
    },
    '强制删除',
    '查看详情'
  );

  if (forceAction === '查看详情') {
    output.show(true);
    return;
  }

  if (forceAction !== '强制删除') {
    return;
  }

  const forceResults: DeleteBranchResult[] = [];
  for (const result of failedResults) {
    forceResults.push(await forceDeleteLocalBranch(repoPath, result.branchName));
  }

  writeDeleteReport(output, safeResults, skippedItems, forceResults);
  const forceSuccessCount = forceResults.filter((result) => result.success).length;
  const forceFailedResults = forceResults.filter((result) => !result.success);

  if (forceFailedResults.length === 0) {
    void vscode.window.showInformationMessage(`强制删除完成：成功删除 ${forceSuccessCount} 个分支。`);
    return;
  }

  const detailAction = await vscode.window.showWarningMessage(
    `强制删除完成：成功 ${forceSuccessCount} 个，失败 ${forceFailedResults.length} 个。`,
    '查看详情'
  );

  if (detailAction === '查看详情') {
    output.show(true);
  }
}

async function showUnmergedBranchPicker(items: BranchQuickPickItem[]): Promise<BranchQuickPickItem[]> {
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: `$(warning) 确认删除 ${items.length} 个未合并分支`,
        description: '继续使用 git branch -d 安全删除',
        detail: formatBranchNameList(items.map((item) => item.branch.name)),
        confirm: true
      },
      {
        label: '取消',
        description: '不删除这些未合并分支',
        detail: formatBranchNameList(items.map((item) => item.branch.name)),
        confirm: false
      }
    ],
    {
      ignoreFocusOut: true,
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: '这些分支未合并到主分支；按回车确认继续，或选择取消',
      title: '确认未合并分支'
    }
  );

  return selected?.confirm ? items : [];
}

function toQuickPickItem(branch: StaleBranch): BranchQuickPickItem {
  const dateText = formatDate(branch.lastCommitDate);
  const currentText = branch.isCurrent ? ' · 当前分支不可删除' : '';
  const mergedText = branch.isMerged ? `已合并到 ${formatMainBranches(branch.mergedMainBranches)}` : `未合并到 ${formatMainBranches(branch.mainBranches)}`;

  return {
    label: `$(git-branch) ${branch.name}`,
    description: `${formatBranchAge(branch.ageHours)} · ${branch.shortHash}`,
    detail: `最后提交 ${dateText} · ${mergedText}${currentText}`,
    picked: branch.isMerged && !branch.isCurrent,
    branch,
    deletable: !branch.isCurrent
  };
}

function writeDeleteReport(
  output: vscode.OutputChannel,
  safeResults: DeleteBranchResult[],
  skippedItems: BranchQuickPickItem[],
  forceResults: DeleteBranchResult[] = []
): void {
  output.clear();
  output.appendLine('Git Branch Cleanup 删除结果');
  output.appendLine('');

  for (const item of skippedItems) {
    output.appendLine(`SKIP ${item.branch.name}`);
    output.appendLine('  当前所在分支不可删除。');
  }

  appendDeleteResults(output, '安全删除', safeResults);

  if (forceResults.length > 0) {
    appendDeleteResults(output, '强制删除', forceResults);
  }
}

function appendDeleteResults(output: vscode.OutputChannel, title: string, results: DeleteBranchResult[]): void {
  if (results.length === 0) {
    return;
  }

  output.appendLine(title);
  for (const result of results) {
    output.appendLine(`${result.success ? 'OK' : 'FAIL'} ${result.branchName}`);
    output.appendLine(`  ${result.message}`);
    if (result.stderr) {
      output.appendLine(`  ${result.stderr}`);
    }
  }
  output.appendLine('');
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
  return normalizeCommaSeparatedList(value, ['main', 'master']);
}

function normalizeCommaSeparatedList(value: string, fallback: string[]): string[] {
  const values = Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));
  return values.length > 0 ? values : fallback;
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

function formatBranchFilters(includeBranchPatterns: string[], excludeBranchPatterns: string[]): string {
  if (excludeBranchPatterns.length === 0) {
    return `include: ${includeBranchPatterns.join(', ')}`;
  }

  return `include: ${includeBranchPatterns.join(', ')} / exclude: ${excludeBranchPatterns.join(', ')}`;
}

function formatBranchNameList(branchNames: string[]): string {
  const visibleBranchNames = branchNames.slice(0, 8);
  const remainingCount = branchNames.length - visibleBranchNames.length;
  const suffix = remainingCount > 0 ? ` 等 ${branchNames.length} 个` : '';
  return `${visibleBranchNames.join(', ')}${suffix}`;
}

function toUserMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return '检查分支时发生未知错误。';
}
