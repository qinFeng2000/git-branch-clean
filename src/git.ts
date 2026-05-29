import { execFile, type ExecFileException } from 'node:child_process';

const HOUR_MS = 60 * 60 * 1000;

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface BranchInfo {
  name: string;
  shortHash: string;
  lastCommitDate: Date;
  ageHours: number;
  isCurrent: boolean;
}

export interface StaleBranch extends BranchInfo {
  mainBranches: string[];
}

export interface ScanOptions {
  repoPath: string;
  mainBranches: string[];
  staleHours: number;
  now?: Date;
}

export interface DeleteBranchResult {
  branchName: string;
  success: boolean;
  message: string;
  stderr?: string;
}

export class GitCommandError extends Error {
  public readonly args: string[];
  public readonly code: number;
  public readonly stdout: string;
  public readonly stderr: string;

  public constructor(args: string[], result: GitResult, message?: string) {
    super(message ?? buildGitErrorMessage(args, result));
    this.name = 'GitCommandError';
    this.args = args;
    this.code = result.code;
    this.stdout = result.stdout;
    this.stderr = result.stderr;
  }
}

export async function scanStaleBranches(options: ScanOptions): Promise<StaleBranch[]> {
  const requestedMainBranches = normalizeMainBranches(options.mainBranches);
  const staleHours = normalizeStaleHours(options.staleHours);
  const now = options.now ?? new Date();

  if (requestedMainBranches.length === 0) {
    throw new Error('主分支名称不能为空。');
  }

  await assertGitRepository(options.repoPath);

  const currentBranch = await getCurrentBranch(options.repoPath);
  const branches = await listLocalBranches(options.repoPath, currentBranch, now);
  const existingMainBranches = requestedMainBranches.filter((mainBranch) => {
    return branches.some((branch) => branch.name === mainBranch);
  });

  if (existingMainBranches.length === 0) {
    throw new Error(`找不到主分支 ${requestedMainBranches.join(', ')}。请检查 gitBranchCleanup.mainBranch 设置。`);
  }

  const staleBranches: StaleBranch[] = [];

  for (const branch of branches) {
    if (existingMainBranches.includes(branch.name)) {
      continue;
    }

    const merged = await isBranchMergedIntoAnyMain(options.repoPath, branch.name, existingMainBranches);
    const ageMs = now.getTime() - branch.lastCommitDate.getTime();

    if (!merged && ageMs >= staleHours * HOUR_MS) {
      staleBranches.push({
        ...branch,
        mainBranches: existingMainBranches
      });
    }
  }

  return staleBranches.sort((left, right) => {
    return right.ageHours - left.ageHours || left.name.localeCompare(right.name);
  });
}

export async function deleteLocalBranch(repoPath: string, branchName: string): Promise<DeleteBranchResult> {
  const trimmedBranchName = branchName.trim();

  if (!trimmedBranchName) {
    return {
      branchName,
      success: false,
      message: '分支名称不能为空。'
    };
  }

  const currentBranch = await getCurrentBranch(repoPath);
  if (currentBranch === trimmedBranchName) {
    return {
      branchName: trimmedBranchName,
      success: false,
      message: `不能删除当前所在分支 ${trimmedBranchName}。`
    };
  }

  const result = await runGit(repoPath, ['branch', '-d', '--', trimmedBranchName]);
  if (result.code === 0) {
    return {
      branchName: trimmedBranchName,
      success: true,
      message: `已删除分支 ${trimmedBranchName}。`
    };
  }

  return {
    branchName: trimmedBranchName,
    success: false,
    message: `无法安全删除分支 ${trimmedBranchName}。Git 拒绝删除，可能因为该分支尚未完全合并。`,
    stderr: result.stderr.trim() || result.stdout.trim()
  };
}

async function assertGitRepository(repoPath: string): Promise<void> {
  const result = await runGit(repoPath, ['rev-parse', '--is-inside-work-tree']);
  if (result.code !== 0 || result.stdout.trim() !== 'true') {
    throw new Error('当前工作区不是 Git 仓库。');
  }
}

async function getCurrentBranch(repoPath: string): Promise<string> {
  const result = await mustRunGit(repoPath, ['branch', '--show-current']);
  return result.stdout.trim();
}

async function listLocalBranches(repoPath: string, currentBranch: string, now: Date): Promise<BranchInfo[]> {
  const result = await mustRunGit(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)%09%(objectname:short)%09%(committerdate:iso-strict)',
    'refs/heads'
  ]);

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseBranchLine(line, currentBranch, now));
}

async function isBranchMergedIntoAnyMain(repoPath: string, branchName: string, mainBranches: string[]): Promise<boolean> {
  for (const mainBranch of mainBranches) {
    const result = await runGit(repoPath, ['merge-base', '--is-ancestor', branchName, mainBranch]);
    if (result.code === 0) {
      return true;
    }

    if (result.code === 1) {
      continue;
    }

    throw new GitCommandError(['merge-base', '--is-ancestor', branchName, mainBranch], result);
  }

  return false;
}

function parseBranchLine(line: string, currentBranch: string, now: Date): BranchInfo {
  const [name, shortHash, commitDateText] = line.split('\t');
  if (!name || !shortHash || !commitDateText) {
    throw new Error(`无法解析 Git 分支信息：${line}`);
  }

  const lastCommitDate = new Date(commitDateText);
  if (Number.isNaN(lastCommitDate.getTime())) {
    throw new Error(`无法解析分支 ${name} 的最后提交时间：${commitDateText}`);
  }

  return {
    name,
    shortHash,
    lastCommitDate,
    ageHours: Math.max(0, Math.floor((now.getTime() - lastCommitDate.getTime()) / HOUR_MS)),
    isCurrent: name === currentBranch
  };
}

function normalizeStaleHours(staleHours: number): number {
  if (!Number.isFinite(staleHours) || staleHours < 1) {
    return 720;
  }

  return Math.floor(staleHours);
}

function normalizeMainBranches(mainBranches: string[]): string[] {
  return Array.from(new Set(mainBranches.map((mainBranch) => mainBranch.trim()).filter(Boolean)));
}

async function mustRunGit(repoPath: string, args: string[]): Promise<GitResult> {
  const result = await runGit(repoPath, args);
  if (result.code !== 0) {
    throw new GitCommandError(args, result);
  }

  return result;
}

async function runGit(repoPath: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) {
        resolve({
          code: 0,
          stdout,
          stderr
        });
        return;
      }

      const execError = error as ExecFileException;
      if (typeof execError.code === 'number') {
        resolve({
          code: execError.code,
          stdout,
          stderr
        });
        return;
      }

      reject(execError);
    });
  });
}

function buildGitErrorMessage(args: string[], result: GitResult): string {
  const details = result.stderr.trim() || result.stdout.trim() || `退出码 ${result.code}`;
  return `Git 命令执行失败：git ${args.join(' ')}。${details}`;
}
