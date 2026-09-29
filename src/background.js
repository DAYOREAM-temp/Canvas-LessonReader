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

chrome.action.onClicked.addListener(async tab => {
  const page = chrome.runtime.getURL('export.html');
  if (!tab.id || !tab.url?.startsWith('https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/#/play-center')) {
    await chrome.tabs.create({ url: `${page}?error=请先打开交大课程播放页` });
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/overlay.js'] });
  } catch {
    await chrome.tabs.create({ url: `${page}?error=${encodeURIComponent('无法在课程页打开悬浮窗，请刷新课程页后重试')}` });
  }
});
