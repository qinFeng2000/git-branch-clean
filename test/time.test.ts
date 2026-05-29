import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBranchAge } from '../src/time';

test('7 天以内按小时展示', () => {
  assert.equal(formatBranchAge(3), '3 小时前');
  assert.equal(formatBranchAge(24 * 7), '168 小时前');
});

test('超过 7 天按 week 单位展示', () => {
  assert.equal(formatBranchAge(24 * 8), '1 week ago');
  assert.equal(formatBranchAge(24 * 15), '2 weeks ago');
});
