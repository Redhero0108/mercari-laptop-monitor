import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  addKeyword,
  clearKeywords,
  errorEnvelope,
  listTasks,
  recentResults,
  removeKeyword,
  replaceAllKeywords,
  resolveTask,
  successEnvelope,
  taskId,
  updateKeyword,
} from './cli-lib.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mercari-watch-test-'));
try {
  await writeFile(path.join(tempDir, 'config.json'), JSON.stringify({
    queries: ['32GB 1TB ノートPC'],
    maxPriceYen: 95000,
    minIntelGeneration: 12,
    intelOnly: true,
    maxConditionLevel: 3,
  }), 'utf8');
  const firstId = taskId('32GB 1TB ノートPC');
  assert.equal(firstId, taskId('  32GB 1TB ノートPC  '));
  const tasks = await listTasks(tempDir);
  assert.equal(tasks.count, 1);
  assert.equal(tasks.tasks[0].id, firstId);
  assert.equal((await resolveTask(tempDir, firstId)).keyword, '32GB 1TB ノートPC');

  const preview = await addKeyword(tempDir, '第12世代 32GB', { dryRun: true });
  assert.equal(preview.added, true);
  assert.equal(JSON.parse(await readFile(path.join(tempDir, 'config.json'), 'utf8')).queries.length, 1);
  const added = await addKeyword(tempDir, '第12世代 32GB');
  assert.equal(added.added, true);
  assert.equal((await listTasks(tempDir)).count, 2);
  assert.equal((await addKeyword(tempDir, '第12世代 32GB')).duplicate, true);

  const secondId = taskId('第12世代 32GB');
  const updatePreview = await updateKeyword(tempDir, secondId, '第13世代 32GB', { dryRun: true });
  assert.equal(updatePreview.updated, true);
  assert.equal((await listTasks(tempDir)).tasks[1].keyword, '第12世代 32GB');
  const updated = await updateKeyword(tempDir, secondId, '第13世代 32GB');
  assert.equal(updated.before.id, secondId);
  assert.equal(updated.after.id, taskId('第13世代 32GB'));
  assert.equal((await listTasks(tempDir)).tasks[1].keyword, '第13世代 32GB');
  await assert.rejects(
    updateKeyword(tempDir, taskId('第13世代 32GB'), '32GB 1TB ノートPC'),
    (error) => error.code === 'DUPLICATE_KEYWORD',
  );

  const removePreview = await removeKeyword(tempDir, taskId('第13世代 32GB'), { dryRun: true });
  assert.equal(removePreview.total, 1);
  assert.equal((await listTasks(tempDir)).count, 2);
  await removeKeyword(tempDir, taskId('第13世代 32GB'));
  assert.equal((await listTasks(tempDir)).count, 1);

  const replacements = ['ThinkPad 32GB', 'EliteBook 32GB'];
  const replacePreview = await replaceAllKeywords(tempDir, replacements, { dryRun: true });
  assert.equal(replacePreview.total, 2);
  assert.equal((await listTasks(tempDir)).tasks[0].keyword, '32GB 1TB ノートPC');
  await assert.rejects(
    replaceAllKeywords(tempDir, replacements),
    (error) => error.code === 'CONFIRMATION_REQUIRED',
  );
  await assert.rejects(
    replaceAllKeywords(tempDir, ['ThinkPad 32GB', 'thinkpad 32gb'], { dryRun: true }),
    (error) => error.code === 'DUPLICATE_KEYWORD',
  );
  await replaceAllKeywords(tempDir, replacements, { confirmed: true });
  assert.deepEqual((await listTasks(tempDir)).tasks.map((task) => task.keyword), replacements);

  const clearPreview = await clearKeywords(tempDir, { dryRun: true });
  assert.equal(clearPreview.previousTotal, 2);
  assert.equal((await listTasks(tempDir)).count, 2);
  await assert.rejects(
    clearKeywords(tempDir),
    (error) => error.code === 'CONFIRMATION_REQUIRED',
  );
  await clearKeywords(tempDir, { confirmed: true });
  assert.equal((await listTasks(tempDir)).count, 0);

  await writeFile(path.join(tempDir, 'results.json'), JSON.stringify({
    m1: { id: 'm1', title: 'old', checkedAt: '2026-01-01T00:00:00.000Z', price: 1 },
    m2: { id: 'm2', title: 'new', checkedAt: '2026-01-02T00:00:00.000Z', price: 2 },
  }), 'utf8');
  const recent = await recentResults(tempDir, 1);
  assert.equal(recent.results[0].id, 'm2');
  assert.equal(recent.results[0].priceYen, 2);

  assert.deepEqual(Object.keys(successEnvelope('test', {})), ['ok', 'command', 'data', 'meta']);
  assert.deepEqual(Object.keys(errorEnvelope('test', new Error('x'))), ['ok', 'command', 'error', 'meta']);
  assert.equal(errorEnvelope('test', new Error('x')).ok, false);
  console.log('cli tests: OK');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
