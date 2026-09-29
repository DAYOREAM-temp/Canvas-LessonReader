import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSelection, imageOrigins, exportSelection } from '../src/workflow.mjs';

const selected = [
  { id: 8, ordinal: 1, courBeginTime: '2026-09-22 13:55:00' },
  { id: 3, ordinal: 4, courBeginTime: '2026-09-29 13:55:00' },
];

test('prepares only chosen lessons and reports an empty transcript separately', async () => {
  const calls = [];
  const result = await prepareSelection(selected, async lesson => {
    calls.push(lesson.id);
    return {
      captions: lesson.id === 8 ? [{ bg: 1000, ed: 2000, res: '内容' }] : [],
      slides: [{ imageSeekTime: 1, imageUrl: 'https://images.example/a.png' }],
      filterWarnings: ['签到 检索失败'],
    };
  });
  assert.deepEqual(calls, [8, 3]);
  assert.equal(result.ready.length, 1);
  assert.equal(result.ready[0].plan.stem, '2026-09-22_第1次课');
  assert.deepEqual(result.ready[0].filterWarnings, ['签到 检索失败']);
  assert.match(result.errors[0].message, /转写/);
  assert.deepEqual(imageOrigins(result.ready), ['https://images.example/*']);
});

test('continues exporting other lessons after one image fails', async () => {
  const result = await prepareSelection(selected, async lesson => ({
    captions: [{ bg: 1000, ed: 2000, res: '内容' }],
    slides: [{ imageSeekTime: 1, imageUrl: `https://images.example/${lesson.id}.png` }],
  }));
  const calls = [];
  const summary = await exportSelection({}, result.ready, async (_root, entry) => {
    calls.push(entry.lesson.id);
    if (entry.lesson.id === 8) throw new Error('图片下载失败');
    return '导出文件夹';
  });
  assert.deepEqual(calls, [8, 3]);
  assert.equal(summary.successes.length, 1);
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0].message, /图片下载失败/);
});
