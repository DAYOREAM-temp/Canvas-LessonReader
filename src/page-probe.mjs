// This function is serialized by chrome.scripting.executeScript. Keep every helper
// inside it so the injected copy has no dependency on the extension's module scope.
export async function pageProbe(command, argument) {
  try {
  if (globalThis.location?.hostname !== 'v.sjtu.edu.cn' ||
      !globalThis.location?.hash?.startsWith('#/play-center')) {
    throw new Error('请在交大课程播放页使用扩展');
  }

  function visitVnodes(root, callback) {
    const stack = [root];
    const seen = new Set();
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object' || seen.has(node)) continue;
      seen.add(node);
      callback(node);
      if (node.component?.subTree) stack.push(node.component.subTree);
      if (node.suspense?.activeBranch) stack.push(node.suspense.activeBranch);
      if (node.ssContent) stack.push(node.ssContent);
      if (Array.isArray(node.children)) {
        for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
      }
    }
  }

  if (command === 'list') {
    const container = globalThis.document?.querySelector('#app');
    // Vue's renderer stores the mounted root vnode on the container. In
    // production, app._instance can be null even after mounting.
    const root = container?._vnode || container?.__vue_app__?._instance?.subTree;
    if (!root) throw new Error('播放器尚未加载，请等待后重试');
    const candidates = [];
    const activeCaptionModes = new Map();
    visitVnodes(root, node => {
      const instance = node.component;
      if (Array.isArray(instance?.props?.courseList) && instance.props.courseList.some(item => item?.id != null && item?.courBeginTime)) {
        candidates.push(instance);
      }
      if (instance?.props?.courseId != null && typeof instance.props.aiOptimizeFlag === 'boolean' &&
          typeof instance.props.currentTime === 'number') {
        activeCaptionModes.set(String(instance.props.courseId), instance.props.aiOptimizeFlag);
      }
    });
    if (!candidates.length) throw new Error('未找到节次数据，页面结构可能已变化');
    for (const courseListComponent of candidates) {
      const byId = new Map(courseListComponent.props.courseList.map(item => [String(item.id), item]));
      const lessons = [];
      visitVnodes(courseListComponent.subTree, node => {
        if (!/^list-item-\d+$/.test(String(node.props?.id || ''))) return;
        const course = byId.get(String(node.key));
        const row = globalThis.document.getElementById(node.props.id);
        if (!course || !row) return;
        const ordinal = Number(row.querySelector('.list-index .index')?.textContent?.trim());
        if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error('无法读取页面节次编号');
        lessons.push({
          id: course.id,
          ordinal,
          courBeginTime: course.courBeginTime,
          title: row.querySelector('.title')?.textContent?.trim() || '',
          optimized: activeCaptionModes.get(String(course.id)) ??
            (row.querySelector('.ai-flag')?.textContent?.trim() === 'AI+'),
          available: course.vodClickEnable !== false && !row.classList?.contains('can-not-play') && !row.classList?.contains('disabled'),
        });
      });
      if (lessons.length) return { ok: true, value: lessons };
    }
    throw new Error('未找到节次列表，请等待页面加载后重试');
  }

  if (command === 'lesson') {
    const courseId = Number(argument?.id);
    if (!Number.isSafeInteger(courseId) || courseId < 1) throw new Error('节次 ID 无效');
    const chunks = globalThis.webpackChunkjy_application_resoucemanage_ui;
    if (!Array.isArray(chunks)) throw new Error('播放器脚本尚未加载');
    let requireModule;
    chunks.push([[Math.floor(Math.random() * 1_000_000_000) + 1_000_000_000], {}, runtime => { requireModule = runtime; }]);
    let service;
    try { service = requireModule?.(96885); } catch { /* Version mismatch. */ }
    if (typeof service?.Te !== 'function' || typeof service?.lN !== 'function') {
      throw new Error('页面接口已变化，需要更新扩展');
    }
    const original = !argument.optimized;
    const [captionResponse, pptResponse] = await Promise.all([
      service.Te(courseId, original),
      service.lN({ courseId }),
    ]);
    if (captionResponse?.status !== 200 || pptResponse?.status !== 200) {
      throw new Error('页面接口返回错误，请确认登录状态');
    }
    let captions = captionResponse.data?.afterAssemblyList;
    if (!Array.isArray(captions) || !captions.length) {
      const fallback = await service.Te(courseId, !original);
      if (fallback?.status === 200 && Array.isArray(fallback.data?.afterAssemblyList)) {
        captions = fallback.data.afterAssemblyList;
      }
    }
    const slides = Array.isArray(pptResponse.data?.docList) ? pptResponse.data.docList : [];
    const requestedWords = Array.isArray(argument.excludeWords)
      ? [...new Set(argument.excludeWords.map(word => String(word).trim()).filter(word => word && word.length <= 20))].slice(0, 8)
      : [];
    const matchingWords = new Map();
    const filterWarnings = [];
    for (const word of requestedWords) {
      try {
        const search = await service.lN({ courseId, word });
        if (search?.status !== 200 || !Array.isArray(search.data?.docList)) throw new Error('检索返回异常');
        for (const slide of search.data.docList) {
          const time = String(Number(slide.imageSeekTime));
          if (!matchingWords.has(time)) matchingWords.set(time, []);
          matchingWords.get(time).push(word);
        }
      } catch {
        filterWarnings.push(`${word} 检索失败`);
      }
    }
    return { ok: true, value: {
      captions: Array.isArray(captions) ? captions.map(({ bg, ed, res }) => ({ bg, ed, res })) : [],
      slides: slides.map(({ imageSeekTime, imageUrl }) => ({ imageSeekTime, imageUrl,
        filterWords: matchingWords.get(String(Number(imageSeekTime))) || [] })),
      filterWarnings,
    } };
  }

  throw new Error('未知页面操作');
  } catch (error) {
    // Exceptions thrown in MAIN world are not reliably exposed to the
    // extension, so return a structured, cloneable result instead.
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
