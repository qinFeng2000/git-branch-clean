import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { deleteLocalBranch, scanStaleBranches } from '../src/git';

const execFileAsync = promisify(execFile);
const NOW = new Date('2026-05-29T00:00:00.000Z');

test('只返回过期且未合并到主分支的本地分支', async () => {
  const repo = await createRepo('main');

  try {
    await commitFile(repo, 'base.txt', 'base', 'base', daysAgo(120));

    await git(repo, ['checkout', '-b', 'merged-old']);
    await commitFile(repo, 'merged.txt', 'merged', 'merged branch', daysAgo(80));
    await git(repo, ['checkout', 'main']);
    await git(repo, ['merge', '--no-ff', 'merged-old', '-m', 'merge merged-old'], daysAgo(70));

    await git(repo, ['checkout', '-b', 'stale-unmerged']);
    await commitFile(repo, 'stale.txt', 'stale', 'stale branch', daysAgo(45));
    await git(repo, ['checkout', 'main']);

    await git(repo, ['checkout', '-b', 'fresh-unmerged']);
    await commitFile(repo, 'fresh.txt', 'fresh', 'fresh branch', daysAgo(5));
    await git(repo, ['checkout', 'main']);

    const branches = await scanStaleBranches({
      repoPath: repo,
      mainBranches: ['main'],
      staleHours: 720,
      now: NOW
    });

    assert.deepEqual(branches.map((branch) => branch.name), ['stale-unmerged']);
    assert.equal(branches[0]?.ageHours, 45 * 24);
    assert.equal(branches[0]?.isCurrent, false);
  } finally {
    await removeRepo(repo);
  }
});

test('支持自定义主分支名称和过期小时数', async () => {
  const repo = await createRepo('trunk');

  try {
    await commitFile(repo, 'base.txt', 'base', 'base', daysAgo(100));
    await git(repo, ['checkout', '-b', 'old-feature']);
    await commitFile(repo, 'feature.txt', 'feature', 'feature branch', daysAgo(40));
    await git(repo, ['checkout', 'trunk']);

    const branches = await scanStaleBranches({
      repoPath: repo,
      mainBranches: ['trunk'],
      staleHours: 40 * 24,
      now: NOW
    });

    assert.deepEqual(branches.map((branch) => branch.name), ['old-feature']);
  } finally {
    await removeRepo(repo);
  }
});

test('当前分支会被标记且不能删除', async () => {
  const repo = await createRepo('main');

  try {
    await commitFile(repo, 'base.txt', 'base', 'base', daysAgo(100));
    await git(repo, ['checkout', '-b', 'current-stale']);
    await commitFile(repo, 'current.txt', 'current', 'current branch', daysAgo(60));

    const branches = await scanStaleBranches({
      repoPath: repo,
      mainBranches: ['main'],
      staleHours: 720,
      now: NOW
    });

    assert.equal(branches[0]?.name, 'current-stale');
    assert.equal(branches[0]?.isCurrent, true);

    const result = await deleteLocalBranch(repo, 'current-stale');
    assert.equal(result.success, false);
    assert.match(result.message, /不能删除当前所在分支/);
  } finally {
    await removeRepo(repo);
  }
});

test('安全删除未合并分支失败时返回可读结果', async () => {
  const repo = await createRepo('main');

  try {
    await commitFile(repo, 'base.txt', 'base', 'base', daysAgo(100));
    await git(repo, ['checkout', '-b', 'unsafe-delete']);
    await commitFile(repo, 'unsafe.txt', 'unsafe', 'unsafe branch', daysAgo(60));
    await git(repo, ['checkout', 'main']);

    const result = await deleteLocalBranch(repo, 'unsafe-delete');

    assert.equal(result.success, false);
    assert.match(result.message, /无法安全删除分支 unsafe-delete/);
    assert.ok(result.stderr);
  } finally {
    await removeRepo(repo);
  }
});

test('主分支不存在时给出明确错误', async () => {
  const repo = await createRepo('main');

  try {
    await commitFile(repo, 'base.txt', 'base', 'base', daysAgo(100));

    await assert.rejects(
      () => scanStaleBranches({
        repoPath: repo,
        mainBranches: ['develop'],
        staleHours: 720,
        now: NOW
      }),
      /找不到主分支 develop/
    );
  } finally {
    await removeRepo(repo);
  }
});

test('支持多个主分支，合入任意存在主分支即不提示', async () => {
  const repo = await createRepo('main');

  try {
    await commitFile(repo, 'base.txt', 'base', 'base', daysAgo(120));
    await git(repo, ['branch', 'master']);

    await git(repo, ['checkout', '-b', 'merged-to-master']);
    await commitFile(repo, 'merged-master.txt', 'merged', 'merged to master', daysAgo(80));
    await git(repo, ['checkout', 'master']);
    await git(repo, ['merge', '--no-ff', 'merged-to-master', '-m', 'merge merged-to-master'], daysAgo(70));

    await git(repo, ['checkout', 'main']);
    await git(repo, ['checkout', '-b', 'stale-unmerged-multi']);
    await commitFile(repo, 'stale-multi.txt', 'stale', 'stale multi', daysAgo(50));
    await git(repo, ['checkout', 'main']);

    const branches = await scanStaleBranches({
      repoPath: repo,
      mainBranches: ['main', 'master'],
      staleHours: 720,
      now: NOW
    });

    assert.deepEqual(branches.map((branch) => branch.name), ['stale-unmerged-multi']);
    assert.deepEqual(branches[0]?.mainBranches, ['main', 'master']);
  } finally {
    await removeRepo(repo);
  }
});

test('配置多个主分支时允许部分主分支不存在', async () => {
  const repo = await createRepo('main');

  try {
    await commitFile(repo, 'base.txt', 'base', 'base', daysAgo(100));

    const branches = await scanStaleBranches({
      repoPath: repo,
      mainBranches: ['main', 'master'],
      staleHours: 720,
      now: NOW
    });

    assert.deepEqual(branches, []);
  } finally {
    await removeRepo(repo);
  }
});

async function createRepo(mainBranch: string): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'git-branch-cleanup-'));
  await git(repo, ['init']);
  await git(repo, ['checkout', '-b', mainBranch]);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Git Branch Cleanup Test']);
  return repo;
}

async function removeRepo(repo: string): Promise<void> {
  await rm(repo, {
    recursive: true,
    force: true
  });
}

async function commitFile(repo: string, fileName: string, content: string, message: string, date: Date): Promise<void> {
  await writeFile(path.join(repo, fileName), content);
  await git(repo, ['add', fileName]);
  await git(repo, ['commit', '-m', message], date);
}

async function git(repo: string, args: string[], date?: Date): Promise<string> {
  const env = {
    ...process.env
  };

  if (date) {
    env.GIT_AUTHOR_DATE = date.toISOString();
    env.GIT_COMMITTER_DATE = date.toISOString();
  }

  const { stdout } = await execFileAsync('git', args, {
    cwd: repo,
    env
  });

  return stdout;
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}
