export async function handleBridgeMessage(message, sender, extensionId, api) {
  const senderUrl = new URL(sender?.url || sender?.tab?.url || 'about:blank');
  if (sender?.id !== extensionId || !Number.isSafeInteger(sender?.tab?.id) ||
      senderUrl.origin !== 'https://v.sjtu.edu.cn' ||
      senderUrl.pathname !== '/jy-application-resourcemanage-ui/' ||
      !senderUrl.hash.startsWith('#/play-center')) {
    throw new Error('只能从交大课程播放页调用导出功能');
  }
  if (message.type === 'sjtu-export:probe') {
    if (!['list', 'lesson'].includes(message.command)) throw new Error('未知页面操作');
    return api.probe(sender.tab.id, message.command, message.argument ?? null);
  }
  if (message.type === 'sjtu-export:permission-contains' || message.type === 'sjtu-export:permission-request') {
    const origins = message.origins;
    if (!Array.isArray(origins) || !origins.length || origins.length > 20 ||
        origins.some(origin => typeof origin !== 'string' || !/^https:\/\/[a-z0-9.-]+\/\*$/.test(origin))) {
      throw new Error('图片域名格式无效');
    }
    return message.type.endsWith('contains') ? api.contains(origins) : api.request(origins);
  }
  if (message.type === 'sjtu-export:open-grant') {
    const origins = message.origins;
    if (!Array.isArray(origins) || !origins.length || origins.length > 20 ||
        origins.some(origin => typeof origin !== 'string' || !/^https:\/\/[a-z0-9.-]+\/\*$/.test(origin))) {
      throw new Error('图片域名格式无效');
    }
    return api.openGrant(sender.tab.id, origins);
  }
  if (message.type === 'sjtu-export:image') {
    const target = new URL(message.url);
    if (target.protocol !== 'https:') throw new Error('图片地址必须使用 HTTPS');
    const origin = `${target.origin}/*`;
    if (!await api.contains([origin])) throw new Error(`尚未授权图片来源：${target.host}`);
    return api.fetchImage(target.href);
  }
  throw new Error('未知扩展操作');
}
