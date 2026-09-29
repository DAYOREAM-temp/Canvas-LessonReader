import test from 'node:test';
import assert from 'node:assert/strict';
import { pageProbe } from '../src/page-probe.mjs';
import { unwrapProbeResult } from '../src/probe-result.mjs';

async function probe(command, argument) {
  return unwrapProbeResult([{ result: await pageProbe(command, argument) }]);
}

function withPage(env, callback) {
  const previous = { document: globalThis.document, location: globalThis.location, webpack: globalThis.webpackChunkjy_application_resoucemanage_ui };
  globalThis.document = env.document;
  globalThis.location = { hostname: 'v.sjtu.edu.cn', hash: '#/play-center' };
  globalThis.webpackChunkjy_application_resoucemanage_ui = env.webpack;
  return Promise.resolve().then(callback).finally(() => {
    globalThis.document = previous.document;
    globalThis.location = previous.location;
    globalThis.webpackChunkjy_application_resoucemanage_ui = previous.webpack;
  });
}

test('lists rendered lesson order and reads the ordinal from the page', () => withPage({
  document: {
    querySelector: () => ({ _vnode: {
      component: { props: { courseList: [
        { id: 11, courBeginTime: '2026-09-20 08:00', vodClickEnable: true },
        { id: 22, courBeginTime: '2026-09-22 13:55', vodClickEnable: true },
      ] }, subTree: { children: [
        { key: 22, props: { id: 'list-item-0' } },
        { key: 11, props: { id: 'list-item-1' } },
        { component: { props: { courseId: 22, aiOptimizeFlag: false, currentTime: 0 } } },
      ] } },
    } }),
    getElementById: id => ({
      querySelector: selector => ({
        '.list-index .index': { textContent: id === 'list-item-0' ? '1' : '2' },
        '.title': { textContent: id === 'list-item-0' ? '第二次课' : '第一次课' },
        '.ai-flag': { textContent: 'AI+' },
      })[selector],
      classList: { contains: () => false },
    }),
  },
}, async () => {
  const list = await probe('list');
  assert.deepEqual(list.map(item => [item.id, item.ordinal, item.courBeginTime]), [
    [22, 1, '2026-09-22 13:55'], [11, 2, '2026-09-20 08:00'],
  ]);
  assert.deepEqual(list.map(item => item.optimized), [false, true]);
}));

test('chooses the rendered course list when another component also has courseList props', () => withPage({
  document: {
    querySelector: () => ({ _vnode: { children: [
      { component: { props: { courseList: [{ id: 99, courBeginTime: '2026-09-01' }] }, subTree: { children: [] } } },
      { component: { props: { courseList: [{ id: 22, courBeginTime: '2026-09-22' }] }, subTree: { children: [
        { key: 22, props: { id: 'list-item-0' } },
      ] } } },
    ] } }),
    getElementById: () => ({
      querySelector: selector => ({ '.list-index .index': { textContent: '1' }, '.title': { textContent: '课程' } })[selector],
      classList: { contains: () => false },
    }),
  },
}, async () => {
  const list = await probe('list');
  assert.deepEqual(list.map(item => item.id), [22]);
}));

test('reads the same caption and PPT APIs as the playback page, falling back to original text', () => {
  const calls = [];
  const service = {
    Te: async (id, original) => {
      calls.push(['caption', id, original]);
      return { status: 200, data: { afterAssemblyList: original ? [{ bg: 1000, ed: 2000, res: '原文' }] : [] } };
    },
    lN: async query => {
      calls.push(['ppt', query.courseId]);
      return { status: 200, data: { docList: [{ imageSeekTime: 1, imageUrl: 'https://images.example/1.jpg' }] } };
    },
  };
  const webpack = [];
  webpack.push = payload => payload[2](id => ({ 96885: service })[id]);
  return withPage({ document: {}, webpack }, async () => {
    const result = await probe('lesson', { id: 22, optimized: true });
    assert.equal(result.captions[0].res, '原文');
    assert.equal(result.slides.length, 1);
    assert.deepEqual(calls, [['caption', 22, false], ['ppt', 22], ['caption', 22, true]]);
  });
});

test('reports a changed player API instead of exporting wrong data', () => {
  const webpack = [];
  webpack.push = payload => payload[2](() => ({}));
  return withPage({ document: {}, webpack }, async () => {
    await assert.rejects(() => probe('lesson', { id: 22, optimized: false }), /页面接口已变化/);
  });
});

test('uses the player PPT word search to mark matching pages', () => {
  const service = {
    Te: async () => ({ status: 200, data: { afterAssemblyList: [{ bg: 0, ed: 1000, res: '内容' }] } }),
    lN: async ({ word }) => ({ status: 200, data: { docList: word
      ? [{ imageSeekTime: 20, imageUrl: 'https://images.example/2.jpg' }]
      : [{ imageSeekTime: 1, imageUrl: 'https://images.example/1.jpg' },
        { imageSeekTime: 20, imageUrl: 'https://images.example/2.jpg' }] } }),
  };
  const webpack = [];
  webpack.push = payload => payload[2](id => ({ 96885: service })[id]);
  return withPage({ document: {}, webpack }, async () => {
    const result = await probe('lesson', { id: 22, optimized: false, excludeWords: ['签到'] });
    assert.deepEqual(result.slides.map(slide => slide.filterWords), [[], ['签到']]);
  });
});

test('continues with image inspection when the player word search is unavailable', () => {
  const service = {
    Te: async () => ({ status: 200, data: { afterAssemblyList: [{ bg: 0, ed: 1000, res: '内容' }] } }),
    lN: async ({ word }) => {
      if (word) throw new Error('search unavailable');
      return { status: 200, data: { docList: [{ imageSeekTime: 1, imageUrl: 'https://images.example/1.jpg' }] } };
    },
  };
  const webpack = [];
  webpack.push = payload => payload[2](id => ({ 96885: service })[id]);
  return withPage({ document: {}, webpack }, async () => {
    const result = await probe('lesson', { id: 22, optimized: false, excludeWords: ['签到'] });
    assert.equal(result.slides.length, 1);
    assert.deepEqual(result.filterWarnings, ['签到 检索失败']);
  });
});

test('transports a page error through the scripting result envelope', async () => {
  const result = await pageProbe('list');
  assert.equal(result.ok, false);
  assert.throws(() => unwrapProbeResult([{ result }]), /交大课程播放页/);
  assert.throws(() => unwrapProbeResult([]), /无法读取课程页面/);
});
