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
  mergedMainBranches: string[];
  isMerged: boolean;
}

interface MainBranchRef {
  displayName: string;
  refName: string;
  localName?: string;
}

export interface ScanOptions {
  repoPath: string;
  mainBranches: string[];
  includeBranchPatterns?: string[];
  excludeBranchPatterns?: string[];
  fetchRemoteBeforeScan?: boolean;
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
  const includeBranchPatterns = normalizeBranchPatterns(options.includeBranchPatterns ?? ['*'], ['*']);
  const excludeBranchPatterns = normalizeBranchPatterns(options.excludeBranchPatterns ?? [], []);
  const staleHours = normalizeStaleHours(options.staleHours);
  const now = options.now ?? new Date();

  if (requestedMainBranches.length === 0) {
    throw new Error('主分支名称不能为空。');
  }

  await assertGitRepository(options.repoPath);

  if (options.fetchRemoteBeforeScan) {
    await fetchRemoteRefs(options.repoPath);
  }

  const currentBranch = await getCurrentBranch(options.repoPath);
  const branches = await listLocalBranches(options.repoPath, currentBranch, now);
  const mainBranchRefs = await getMainBranchRefs(options.repoPath, branches, requestedMainBranches, options.fetchRemoteBeforeScan === true);
  const localMainBranchNames = new Set(mainBranchRefs.map((branchRef) => branchRef.localName).filter(isDefined));

  if (mainBranchRefs.length === 0) {
    throw new Error(`找不到主分支 ${requestedMainBranches.join(', ')}。请检查 gitBranchCleanup.mainBranch 设置。`);
  }

  const staleBranches: StaleBranch[] = [];

  for (const branch of branches) {
    if (localMainBranchNames.has(branch.name)) {
      continue;
    }

    if (!matchesBranchFilters(branch.name, includeBranchPatterns, excludeBranchPatterns)) {
      continue;
    }

    const ageMs = now.getTime() - branch.lastCommitDate.getTime();
    const isStale = ageMs >= staleHours * HOUR_MS;
    const mergedMainBranches = await getMergedMainBranches(options.repoPath, branch.name, mainBranchRefs);

    if (mergedMainBranches.length === 0 && !isStale) {
      continue;
    }

    staleBranches.push({
      ...branch,
      mainBranches: mainBranchRefs.map((mainBranchRef) => mainBranchRef.displayName),
      mergedMainBranches,
      isMerged: mergedMainBranches.length > 0
    });
  }

  return staleBranches.sort((left, right) => {
    if (left.isMerged !== right.isMerged) {
      return left.isMerged ? -1 : 1;
    }

    return right.ageHours - left.ageHours || left.name.localeCompare(right.name);
  });
}

export async function deleteLocalBranch(repoPath: string, branchName: string): Promise<DeleteBranchResult> {
  return deleteBranch(repoPath, branchName, {
    args: ['branch', '-d', '--'],
    successMessage: (name) => `已删除分支 ${name}。`,
    failureMessage: (name) => `无法安全删除分支 ${name}。Git 拒绝删除，可能因为该分支尚未完全合并。`
  });
}

export async function forceDeleteLocalBranch(repoPath: string, branchName: string): Promise<DeleteBranchResult> {
  return deleteBranch(repoPath, branchName, {
    args: ['branch', '-D', '--'],
    successMessage: (name) => `已强制删除分支 ${name}。`,
    failureMessage: (name) => `无法强制删除分支 ${name}。`
  });
}

async function deleteBranch(
  repoPath: string,
  branchName: string,
  options: {
    args: string[];
    successMessage: (branchName: string) => string;
    failureMessage: (branchName: string) => string;
  }
): Promise<DeleteBranchResult> {
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

  const result = await runGit(repoPath, [...options.args, trimmedBranchName]);
  if (result.code === 0) {
    return {
      branchName: trimmedBranchName,
      success: true,
      message: options.successMessage(trimmedBranchName)
    };
  }

  return {
    branchName: trimmedBranchName,
    success: false,
    message: options.failureMessage(trimmedBranchName),
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

async function fetchRemoteRefs(repoPath: string): Promise<void> {
  const result = await runGit(repoPath, ['fetch', '--all', '--prune']);
  if (result.code !== 0) {
    throw new GitCommandError(['fetch', '--all', '--prune'], result, `拉取远程分支失败。${result.stderr.trim() || result.stdout.trim()}`);
  }
}

async function getMainBranchRefs(repoPath: string, branches: BranchInfo[], requestedMainBranches: string[], includeRemoteRefs: boolean): Promise<MainBranchRef[]> {
  const refs: MainBranchRef[] = [];
  const localBranchNames = new Set(branches.map((branch) => branch.name));

  for (const mainBranch of requestedMainBranches) {
    if (localBranchNames.has(mainBranch)) {
      refs.push({
        displayName: mainBranch,
        refName: `refs/heads/${mainBranch}`,
        localName: mainBranch
      });
    }
  }

  if (includeRemoteRefs) {
    refs.push(...await listRemoteMainBranchRefs(repoPath, requestedMainBranches));
  }

  return dedupeMainBranchRefs(refs);
}

async function listRemoteMainBranchRefs(repoPath: string, requestedMainBranches: string[]): Promise<MainBranchRef[]> {
  const result = await mustRunGit(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)%09%(refname)',
    'refs/remotes'
  ]);
  const requestedMainBranchSet = new Set(requestedMainBranches);

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseRemoteRefLine(line, requestedMainBranchSet))
    .filter(isDefined);
}

function parseRemoteRefLine(line: string, requestedMainBranches: Set<string>): MainBranchRef | undefined {
  const [shortRefName, refName] = line.split('\t');
  const slashIndex = shortRefName.indexOf('/');
  if (slashIndex < 0 || !refName) {
    return undefined;
  }

  const remoteBranchName = shortRefName.slice(slashIndex + 1);
  if (!requestedMainBranches.has(remoteBranchName)) {
    return undefined;
  }

  return {
    displayName: shortRefName,
    refName
  };
}

function dedupeMainBranchRefs(refs: MainBranchRef[]): MainBranchRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.refName)) {
      return false;
    }

    seen.add(ref.refName);
    return true;
  });
}

async function getMergedMainBranches(repoPath: string, branchName: string, mainBranches: MainBranchRef[]): Promise<string[]> {
  const mergedMainBranches: string[] = [];
  const branchRefName = `refs/heads/${branchName}`;

  for (const mainBranch of mainBranches) {
    const result = await runGit(repoPath, ['merge-base', '--is-ancestor', branchRefName, mainBranch.refName]);
    if (result.code === 0) {
      mergedMainBranches.push(mainBranch.displayName);
      continue;
    }

    if (result.code === 1) {
      continue;
    }

    throw new GitCommandError(['merge-base', '--is-ancestor', branchRefName, mainBranch.refName], result);
  }

  return mergedMainBranches;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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

function normalizeBranchPatterns(branchPatterns: string[], fallback: string[]): string[] {
  const normalizedBranchPatterns = Array.from(new Set(branchPatterns.map((pattern) => pattern.trim()).filter(Boolean)));
  return normalizedBranchPatterns.length > 0 ? normalizedBranchPatterns : fallback;
}

function matchesBranchFilters(branchName: string, includeBranchPatterns: string[], excludeBranchPatterns: string[]): boolean {
  return matchesAnyBranchPattern(branchName, includeBranchPatterns) && !matchesAnyBranchPattern(branchName, excludeBranchPatterns);
}

function matchesAnyBranchPattern(branchName: string, branchPatterns: string[]): boolean {
  return branchPatterns.some((pattern) => globToRegExp(pattern).test(branchName));
}

function globToRegExp(pattern: string): RegExp {
  const escapedPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escapedPattern}$`);
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
