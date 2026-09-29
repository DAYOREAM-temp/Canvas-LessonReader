export function unwrapProbeResult(results) {
  const payload = results?.[0]?.result;
  if (payload?.ok === false) throw new Error(payload.error || '页面读取失败');
  if (payload?.ok !== true || payload.value == null) {
    throw new Error('无法读取课程页面，请确认页面仍然打开');
  }
  return payload.value;
}
