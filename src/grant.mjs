const params = new URLSearchParams(location.search);
const tabId = Number(params.get('tabId'));
let origins = [];
try {
  origins = JSON.parse(params.get('origins') || '[]');
  if (!Number.isSafeInteger(tabId) || tabId < 1 || !Array.isArray(origins) || !origins.length ||
      origins.some(origin => typeof origin !== 'string' || !/^https:\/\/[a-z0-9.-]+\/\*$/.test(origin))) {
    throw new Error('授权请求无效');
  }
  for (const origin of origins) {
    const row = document.createElement('li');
    row.textContent = new URL(origin.replace('*', '')).host;
    document.getElementById('origins').append(row);
  }
} catch (error) {
  document.getElementById('message').textContent = error.message;
  document.getElementById('grant').disabled = true;
}

document.getElementById('grant').addEventListener('click', async () => {
  try {
    // This extension page receives a direct user click for the permission prompt.
    const granted = await chrome.permissions.request({ origins });
    if (!granted) throw new Error('未授予图片来源权限');
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'sjtu-export:permission-updated' });
      document.getElementById('message').textContent = '已授权，请回到课程页继续。';
    } catch {
      document.getElementById('message').textContent = '已授权。请回到课程页，必要时在悬浮窗刷新后重试。';
    }
  } catch (error) {
    document.getElementById('message').textContent = error.message;
  }
});
