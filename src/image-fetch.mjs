export async function fetchImage(url, fetcher = globalThis.fetch) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('图片地址必须使用 HTTPS');
  const credentials = target.hostname === 'sjtu.edu.cn' || target.hostname.endsWith('.sjtu.edu.cn') ? 'include' : 'omit';
  const response = await fetcher(target.href, { credentials, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error('图片下载失败：文件为空');
  return { bytes, contentType: response.headers.get('content-type') || '' };
}
