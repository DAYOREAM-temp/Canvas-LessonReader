import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let harnessId = 0;
async function backgroundHarness({ injectionError } = {}) {
  const calls = { injected: [], tabs: [], badges: [], titles: [] };
  let onClick;
  globalThis.chrome = {
    runtime: {
      id: 'extension-id',
      getURL: path => `chrome-extension://extension-id/${path}`,
      onMessage: { addListener() {} },
    },
    action: {
      onClicked: { addListener(listener) { onClick = listener; } },
      setBadgeText: async value => calls.badges.push(value),
      setBadgeBackgroundColor: async () => {},
      setTitle: async value => calls.titles.push(value),
    },
    scripting: {
      executeScript: async value => {
        calls.injected.push(value);
        if (injectionError) throw new Error(injectionError);
        return [];
      },
    },
    tabs: { create: async value => calls.tabs.push(value) },
  };
  await import(`../src/background.js?harness=${harnessId++}`);
  return { calls, click: onClick };
}

test('the installed action injects the floating panel into the current course tab', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.equal(manifest.background.service_worker, 'src/background.js');
  assert.equal(manifest.action.default_popup, undefined);
  const { calls, click } = await backgroundHarness();
  await click({ id: 12, url: 'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/#/play-center?course' });
  assert.deepEqual(calls.injected, [{ target: { tabId: 12 }, files: ['src/overlay.js'] }]);
  assert.deepEqual(calls.tabs, []);
});

test('an unsupported tab reports where to open the panel without opening the old exporter', async () => {
  const { calls, click } = await backgroundHarness();
  await click({ id: 12, url: 'chrome://extensions/' });
  assert.deepEqual(calls.tabs, []);
  assert.deepEqual(calls.injected, []);
  assert.equal(calls.badges.at(-1)?.text, '!');
  assert.match(calls.titles.at(-1)?.title || '', /课程播放页/);
});

test('an injection failure keeps the current tab and exposes the actual failure', async () => {
  const { calls, click } = await backgroundHarness({ injectionError: 'Extension context invalidated' });
  await click({ id: 12, url: 'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/#/play-center?course' });
  assert.deepEqual(calls.tabs, []);
  assert.equal(calls.badges.at(-1)?.text, '!');
  assert.match(calls.titles.at(-1)?.title || '', /Extension context invalidated/);
});
