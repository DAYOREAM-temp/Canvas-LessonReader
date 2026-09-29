import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLesson } from '../src/core.mjs';
import { saveLesson } from '../src/save.mjs';

class MemoryFile {
  content = null;
  async createWritable() {
    return {
      write: async data => { this.content = data; },
      close: async () => {},
    };
  }
}

class MemoryDirectory {
  entries = new Map();
  constructor(failOn = null) { this.failOn = failOn; }
  async *keys() { yield* this.entries.keys(); }
  async getDirectoryHandle(name, { create } = {}) {
    if (!this.entries.has(name) && create) this.entries.set(name, new MemoryDirectory(this.failOn));
    if (!this.entries.has(name)) throw new Error('NotFound');
    return this.entries.get(name);
  }
  async getFileHandle(name, { create } = {}) {
    if (name === this.failOn) throw new Error('磁盘写入失败');
    if (!this.entries.has(name) && create) this.entries.set(name, new MemoryFile());
    if (!this.entries.has(name)) throw new Error('NotFound');
    return this.entries.get(name);
  }
  async removeEntry(name) { this.entries.delete(name); }
}

const plan = () => buildLesson({ ordinal: 2, courBeginTime: '2026-09-22 13:55:00' },
  [{ bg: 1000, ed: 2000, res: '课堂内容' }],
  [{ imageSeekTime: 1, imageUrl: 'https://images.example/one.png' }]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

test('saves a transcript, PPT image, and index into a dated lesson folder', async () => {
  const root = new MemoryDirectory();
  const folder = await saveLesson(root, plan(), async () => ({ bytes: png, contentType: 'image/png' }));
  assert.equal(folder, '2026-09-22_第2次课');
  const files = root.entries.get(folder).entries;
  assert.match(files.get(`${folder}.txt`).content, /课堂内容/);
  assert.match(files.get('PPT索引.txt').content, /PPT\/0001_00-00-01.png/);
  assert.deepEqual(files.get('PPT').entries.get('0001_00-00-01.png').content, png);
});

test('a failed image leaves no lesson folder and a retry uses a new folder', async () => {
  const root = new MemoryDirectory();
  await assert.rejects(() => saveLesson(root, plan(), async () => { throw new Error('HTTP 403'); }), /HTTP 403/);
  assert.equal(root.entries.size, 0);
  const fetcher = async () => ({ bytes: png, contentType: 'image/png' });
  await saveLesson(root, plan(), fetcher);
  const retryFolder = await saveLesson(root, plan(), fetcher);
  assert.equal(retryFolder, '2026-09-22_第2次课 (2)');
  assert.ok(root.entries.get(retryFolder).entries.has('2026-09-22_第2次课.txt'));
});

test('a filesystem failure marks the remaining folder as incomplete', async () => {
  const root = new MemoryDirectory('PPT索引.txt');
  await assert.rejects(() => saveLesson(root, plan(), async () => ({ bytes: png, contentType: 'image/png' })),
    /2026-09-22_第2次课.*写入失败/);
  assert.ok(root.entries.get('2026-09-22_第2次课').entries.has('导出未完成.txt'));
});

test('does not fetch or save excluded images, but records their time in the index', async () => {
  const root = new MemoryDirectory();
  const lesson = buildLesson({ ordinal: 2, courBeginTime: '2026-09-22 13:55:00' },
    [{ bg: 1000, ed: 2000, res: '课堂内容' }], [
      { imageSeekTime: 1, imageUrl: 'https://images.example/one.png' },
      { imageSeekTime: 30, imageUrl: 'https://images.example/checkin.png' },
    ]);
  lesson.slides[1].excludedReason = '页面检索：签到';
  const fetched = [];
  const folder = await saveLesson(root, lesson, async url => {
    fetched.push(url);
    return { bytes: png, contentType: 'image/png' };
  });
  assert.deepEqual(fetched, ['https://images.example/one.png']);
  const files = root.entries.get(folder).entries;
  assert.equal(files.get('PPT').entries.size, 1);
  assert.match(files.get('PPT索引.txt').content, /已排除：页面检索：签到/);
});
