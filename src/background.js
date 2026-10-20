import { pageProbe } from './page-probe.mjs';
import { unwrapProbeResult } from './probe-result.mjs';
import { fetchImage } from './image-fetch.mjs';
import { handleBridgeMessage } from './bridge.mjs';

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

const bridgeApi = {
  probe: async (tabId, command, argument) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: pageProbe, args: [command, argument],
    });
    return unwrapProbeResult(results);
  },
  fetchImage: async url => {
    const response = await fetchImage(url);
    return { base64: toBase64(response.bytes), contentType: response.contentType };
  },
  contains: origins => chrome.permissions.contains({ origins }),
  request: origins => chrome.permissions.request({ origins }),
  openGrant: async (tabId, origins) => {
    const params = new URLSearchParams({ tabId: String(tabId), origins: JSON.stringify(origins) });
    await chrome.tabs.create({ url: `${chrome.runtime.getURL('grant.html')}?${params}` });
    return true;
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !String(message.type).startsWith('sjtu-export:')) return false;
  handleBridgeMessage(message, sender, chrome.runtime.id, bridgeApi)
    .then(value => sendResponse({ ok: true, value }))
    .catch(error => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

async function setActionStatus(tabId, message = '') {
  const target = Number.isInteger(tabId) ? { tabId } : {};
  await Promise.all([
    chrome.action.setBadgeText({ ...target, text: message ? '!' : '' }),
    chrome.action.setTitle({ ...target, title: message || '打开课堂转写与 PPT 导出悬浮窗' }),
    ...(message ? [chrome.action.setBadgeBackgroundColor({ ...target, color: '#b42318' })] : []),
  ]);
}

chrome.action.onClicked.addListener(async tab => {
  if (!Number.isInteger(tab.id) || !tab.url?.startsWith('https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/#/play-center')) {
    await setActionStatus(tab.id, '请先打开已登录的交大课程播放页，再点击图标打开悬浮窗');
    return;
  }
  await setActionStatus(tab.id);
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/overlay.js'] });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await setActionStatus(tab.id, `悬浮窗打开失败，请刷新课程页后重试：${detail}`);
  }
});
