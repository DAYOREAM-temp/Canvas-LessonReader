import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScreenRows, exclusionReason } from '../src/filter.mjs';

function rows({ top = [255, 255, 255], second = top, bottom = [255, 255, 255] }) {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const color = y >= 96 ? bottom : y < 4 ? top : y < 10 ? second : [245, 245, 245];
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      data.set([...color, 255], offset);
    }
  }
  return { data, width, height };
}

test('suggests an exclusion when the player search matches an admin keyword', () => {
  assert.match(exclusionReason({ filterWords: ['签到'] }), /签到/);
  assert.equal(exclusionReason({ filterWords: [] }), null);
});

test('recognizes browser and blue desktop captures, but keeps PowerPoint editing', () => {
  assert.equal(classifyScreenRows(rows({ top: [42, 42, 42], second: [48, 48, 48], bottom: [32, 37, 43] })), '浏览器画面');
  assert.equal(classifyScreenRows(rows({ top: [23, 75, 154], second: [23, 75, 154], bottom: [32, 37, 43] })), '桌面画面');
  assert.equal(classifyScreenRows(rows({ top: [180, 68, 38], second: [180, 68, 38], bottom: [32, 37, 43] })), null);
  assert.equal(classifyScreenRows(rows({ top: [255, 255, 255], bottom: [255, 255, 255] })), null);
});
