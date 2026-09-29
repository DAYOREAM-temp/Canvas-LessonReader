import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLesson,
  renderPptIndex,
  uniqueFolderName,
  extensionForImage,
} from '../src/core.mjs';

const lesson = {
  id: 812,
  ordinal: 3,
  courBeginTime: '2026-09-22 13:55:00',
};

test('builds a dated transcript with the page list ordinal and segment timestamps', () => {
  const result = buildLesson(lesson, [
    { bg: 1200, ed: 4680, res: '第一句。' },
    { bg: 4700, ed: 60200, res: '第二句。\n继续。' },
  ], [
    { imageSeekTime: 1, imageUrl: 'https://images.example/first.jpg' },
  ]);
  assert.equal(result.stem, '2026-09-22_第3次课');
  assert.equal(result.transcript, '[00:00:01.200 - 00:00:04.680] 第一句。\n[00:00:04.700 - 00:01:00.200] 第二句。 继续。\n');
});

test('converts an ISO UTC course timestamp to the Shanghai class date', () => {
  const result = buildLesson({ ordinal: 1, courBeginTime: '2026-09-21T16:30:00Z' },
    [{ bg: 1000, ed: 2000, res: '内容' }],
    [{ imageSeekTime: 1, imageUrl: 'https://images.example/a.png' }]);
  assert.equal(result.stem, '2026-09-22_第1次课');
});

test('PPT index uses each change time and extends the first slide to video start', () => {
  const result = buildLesson(lesson, [{ bg: 1200, ed: 2000, res: '讲述' }], [
    { imageSeekTime: 343, imageUrl: 'https://images.example/second.png' },
    { imageSeekTime: 1, imageUrl: 'https://images.example/first.jpg' },
    { imageSeekTime: 480, imageUrl: 'https://images.example/third.webp' },
  ]);
  result.slides.forEach((slide, index) => { slide.extension = ['jpg', 'png', 'webp'][index]; });
  assert.equal(result.slides.map(s => s.changeTime).join(','), '1,343,480');
  assert.equal(renderPptIndex(result.slides),
    '序号\t页面显示区间\t换页时间\t图片文件\t状态\n' +
    '1\t00:00:00 - 00:05:43\t00:00:01\tPPT/0001_00-00-01.jpg\t保留\n' +
    '2\t00:05:43 - 00:08:00\t00:05:43\tPPT/0002_00-05-43.png\t保留\n' +
    '3\t00:08:00 - 至结束\t00:08:00\tPPT/0003_00-08-00.webp\t保留\n');
});

test('index preserves original intervals when a slide is excluded', () => {
  const result = buildLesson(lesson, [{ bg: 1200, ed: 2000, res: '讲述' }], [
    { imageSeekTime: 1, imageUrl: 'https://images.example/first.jpg' },
    { imageSeekTime: 30, imageUrl: 'https://images.example/checkin.jpg' },
    { imageSeekTime: 60, imageUrl: 'https://images.example/third.jpg' },
  ]);
  result.slides[0].extension = 'jpg';
  result.slides[1].excludedReason = '页面检索：签到';
  result.slides[2].extension = 'jpg';
  assert.match(renderPptIndex(result.slides), /2\t00:00:30 - 00:01:00\t00:00:30\t—\t已排除：页面检索：签到/);
  assert.match(renderPptIndex(result.slides), /1\t00:00:00 - 00:00:30/);
});

test('rejects lessons with missing transcript or PPT instead of calling them complete', () => {
  assert.throws(() => buildLesson(lesson, [], [{ imageSeekTime: 1, imageUrl: 'https://images.example/a.png' }]), /转写/);
  assert.throws(() => buildLesson(lesson, [{ bg: 1, ed: 2, res: '有内容' }], []), /PPT/);
  assert.throws(() => buildLesson(lesson, [{ bg: 1, ed: 2, res: '有内容' }], [{ imageSeekTime: 1, imageUrl: 'http://images.example/a.png' }]), /HTTPS/);
});

test('repeat exports get a fresh folder while preserving the transcript basename', () => {
  assert.equal(uniqueFolderName('2026-09-22_第3次课', new Set(['2026-09-22_第3次课'])), '2026-09-22_第3次课 (2)');
  assert.equal(uniqueFolderName('2026-09-22_第3次课', new Set(['2026-09-22_第3次课', '2026-09-22_第3次课 (2)'])), '2026-09-22_第3次课 (3)');
});

test('detects the image extension from bytes even when server MIME is generic', () => {
  assert.equal(extensionForImage('application/octet-stream', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
  assert.equal(extensionForImage('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff])), 'jpg');
  assert.throws(() => extensionForImage('text/html', Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c])), /图片/);
});
