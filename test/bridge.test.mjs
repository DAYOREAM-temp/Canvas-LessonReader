import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBridgeMessage } from '../src/bridge.mjs';

const sender = {
  id: 'extension-id',
  url: 'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/#/play-center?course',
  tab: { id: 12 },
};

test('allows the course page to request only its own lesson data', async () => {
  const calls = [];
  const result = await handleBridgeMessage({ type: 'sjtu-export:probe', command: 'list' }, sender, 'extension-id', {
    probe: async (...args) => {
      if (args[2] === undefined) throw new Error('executeScript args cannot contain undefined');
      calls.push(args);
      return [{ id: 1 }];
    },
  });
  assert.deepEqual(result, [{ id: 1 }]);
  assert.deepEqual(calls, [[12, 'list', null]]);
  await assert.rejects(() => handleBridgeMessage({ type: 'sjtu-export:probe', command: 'admin' }, sender, 'extension-id', {}), /未知页面操作/);
});

test('rejects a message from another site or extension', async () => {
  await assert.rejects(() => handleBridgeMessage({ type: 'sjtu-export:probe', command: 'list' },
    { ...sender, url: 'https://example.org/' }, 'extension-id', {}), /只能从/);
  await assert.rejects(() => handleBridgeMessage({ type: 'sjtu-export:probe', command: 'list' },
    { ...sender, id: 'other-extension' }, 'extension-id', {}), /只能从/);
});

test('checks image host permission before fetching bytes', async () => {
  const result = await handleBridgeMessage({ type: 'sjtu-export:image', url: 'https://img.example/a.jpg' }, sender, 'extension-id', {
    contains: async origins => origins[0] === 'https://img.example/*',
    fetchImage: async () => ({ base64: 'AA==', contentType: 'image/jpeg' }),
  });
  assert.equal(result.base64, 'AA==');
  await assert.rejects(() => handleBridgeMessage({ type: 'sjtu-export:image', url: 'https://other.example/a.jpg' }, sender, 'extension-id', {
    contains: async () => false,
  }), /尚未授权/);
});

test('opens a grant page only for validated image origins', async () => {
  const calls = [];
  await handleBridgeMessage({ type: 'sjtu-export:open-grant', origins: ['https://img.example/*'] }, sender, 'extension-id', {
    openGrant: async (...args) => { calls.push(args); return true; },
  });
  assert.deepEqual(calls, [[12, ['https://img.example/*']]]);
  await assert.rejects(() => handleBridgeMessage({ type: 'sjtu-export:open-grant', origins: ['http://img.example/*'] }, sender, 'extension-id', {}), /格式无效/);
});
