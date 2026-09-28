import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('docs/REFERENCE.md is regenerated from the registries', () => {
  try {
    execFileSync(process.execPath, ['tools/describe.mjs', '--check'], { stdio: 'pipe' });
  } catch (e) {
    assert.fail(String(e.stderr || e.message));
  }
});
