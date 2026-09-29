import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseDirectory } from '../src/picker.mjs';

test('opens the folder picker immediately and returns its handle', async () => {
  const handle = { name: 'notes' };
  let called = false;
  const promise = chooseDirectory(() => { called = true; return Promise.resolve(handle); });
  assert.equal(called, true);
  assert.equal(await promise, handle);
});

test('treats picker cancellation as no selection and propagates other failures', async () => {
  assert.equal(await chooseDirectory(() => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); }), null);
  await assert.rejects(() => chooseDirectory(() => { throw new Error('blocked'); }), /blocked/);
});
