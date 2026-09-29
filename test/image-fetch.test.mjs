import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchImage } from '../src/image-fetch.mjs';

test('fetches image bytes and sends session cookies only to SJTU hosts', async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push([url, options.credentials]);
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  };
  const sjtu = await fetchImage('https://v.sjtu.edu.cn/image.png', fakeFetch);
  await fetchImage('https://images.example/image.png', fakeFetch);
  assert.deepEqual(requests, [
    ['https://v.sjtu.edu.cn/image.png', 'include'],
    ['https://images.example/image.png', 'omit'],
  ]);
  assert.deepEqual(sjtu.bytes, Uint8Array.from([1, 2, 3]));
});

test('rejects an image HTTP error', async () => {
  await assert.rejects(() => fetchImage('https://images.example/image.png', async () => ({ ok: false, status: 403 })), /HTTP 403/);
});
