import { prepareSelection, imageOrigins, exportSelection } from './workflow.mjs';
import { saveLesson } from './save.mjs';
import { chooseDirectory } from './picker.mjs';
import { exclusionReason, inspectImage } from './filter.mjs';

const template = `
  <div class="panel" role="dialog" aria-label="课堂转写与 PPT 导出">
    <header id="drag-handle">
      <div><strong>课堂转写与 PPT 导出</strong><small>拖动此处移动悬浮窗</small></div>
      <button id="close" class="icon" type="button" aria-label="收起悬浮窗">×</button>
    </header>
    <div class="body">
      <div class="heading"><b>选择节次</b><span id="count"></span></div>
      <div id="lessons" class="lessons">正在读取节次…</div>
      <div class="actions"><button id="select-all" class="secondary" type="button" disabled>全选</button><button id="refresh" class="secondary" type="button">刷新</button></div>
      <label class="field">按点播页 PPT 文字检索排除：<input id="keywords" value="签到,点名,考勤" aria-label="排除关键词，用逗号隔开"></label>
      <p class="hint">这些词会调用播放器已有的 PPT 文字检索；还会检测浏览器与桌面截图。PowerPoint 编辑画面会保留，所有建议均可逐张修改。</p>
      <div class="actions"><button id="prepare" type="button" disabled>读取所选节次</button></div>
      <section id="result" hidden>
        <div class="heading"><b>图片检查</b><span id="review-count"></span></div>
        <p id="permission-note" class="hint" hidden></p>
        <div class="actions"><button id="grant" type="button" hidden>授权图片来源</button><button id="grant-fallback" class="secondary" type="button" hidden>在扩展页授权</button><button id="analyze" type="button" hidden>分析图片并预览</button></div>
        <div id="slides" class="slides"></div>
        <div class="actions"><button id="save" type="button" hidden>选择文件夹并导出</button></div>
      </section>
      <div id="progress" class="progress"></div>
      <p id="message" class="message" role="status"></p>
    </div>
  </div>`;

function clock(seconds) {
  const value = Math.floor(Number(seconds));
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function labelOf(lesson) {
  return `${String(lesson.courBeginTime || '').slice(0, 10)} · 第${lesson.ordinal}次课`;
}

async function bridge(type, fields = {}) {
  const response = await chrome.runtime.sendMessage({ type: `sjtu-export:${type}`, ...fields });
  if (response?.ok !== true) throw new Error(response?.error || '扩展后台没有响应，请重试');
  return response.value;
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function fetchImageViaBridge(url) {
  const result = await bridge('image', { url });
  return { bytes: fromBase64(result.base64), contentType: result.contentType };
}

export function mountPanel() {
  const host = document.createElement('div');
  host.id = 'sjtu-lecture-exporter-host';
  Object.assign(host.style, { position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647' });
  const shadow = host.attachShadow({ mode: 'closed' });
  fetch(chrome.runtime.getURL('src/panel.css'))
    .then(response => response.text())
    .then(css => {
      const stylesheet = new CSSStyleSheet();
      stylesheet.replaceSync(css);
      shadow.adoptedStyleSheets = [stylesheet];
    })
    .catch(error => {
      const notice = shadow.getElementById('message');
      if (notice) notice.textContent = `悬浮窗样式加载失败：${error.message}`;
    });
  const wrapper = document.createElement('div');
  wrapper.innerHTML = template;
  shadow.append(wrapper);
  (document.body || document.documentElement).append(host);

  const el = id => shadow.getElementById(id);
  let lessons = [];
  let prepared = null;
  let missingOrigins = [];
  let analyzing = false;
  let exporting = false;
  const progressRows = new Map();
  const imageCache = new Map();
  let cacheBytes = 0;

  async function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    const image = await fetchImageViaBridge(url);
    if (cacheBytes + image.bytes.length <= 64 * 1024 * 1024) {
      imageCache.set(url, image);
      cacheBytes += image.bytes.length;
    }
    return image;
  }

  function status(text, error = false) {
    el('message').textContent = text;
    el('message').classList.toggle('error', error);
  }

  function progress(lesson, text, kind = '') {
    const key = String(lesson.id);
    let row = progressRows.get(key);
    if (!row) {
      row = document.createElement('div');
      el('progress').append(row);
      progressRows.set(key, row);
    }
    row.className = `progress-row ${kind}`.trim();
    row.textContent = `${labelOf(lesson)}：${text}`;
  }

  function updateSelection() {
    const count = el('lessons').querySelectorAll('input:checked').length;
    el('count').textContent = `已选 ${count} / ${lessons.length}`;
    el('prepare').disabled = count === 0 || prepared !== null;
  }

  function renderLessons() {
    el('lessons').replaceChildren();
    for (const lesson of lessons) {
      const row = document.createElement('label');
      row.className = 'lesson';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = String(lesson.id);
      input.disabled = !lesson.available;
      input.addEventListener('change', updateSelection);
      const text = document.createElement('span');
      text.textContent = `${labelOf(lesson)}${lesson.available ? '' : '（不可播放）'}`;
      row.append(input, text);
      el('lessons').append(row);
    }
    el('select-all').disabled = !lessons.some(lesson => lesson.available);
    updateSelection();
  }

  async function loadLessons() {
    lessons = await bridge('probe', { command: 'list' });
    renderLessons();
    status(`已读取 ${lessons.length} 个节次。`);
  }

  async function checkPermissions() {
    missingOrigins = [];
    for (const origin of imageOrigins(prepared.ready)) {
      if (!await bridge('permission-contains', { origins: [origin] })) missingOrigins.push(origin);
    }
    el('permission-note').hidden = !missingOrigins.length;
    el('grant').hidden = !missingOrigins.length;
    el('grant-fallback').hidden = true;
    el('analyze').hidden = !!missingOrigins.length;
    if (missingOrigins.length) {
      el('permission-note').textContent = `需要授权 ${missingOrigins.map(origin => new URL(origin.replace('*', '')).host).join('、')} 的图片访问。`;
    }
  }

  async function prepare() {
    const selectedIds = new Set([...el('lessons').querySelectorAll('input:checked')].map(input => input.value));
    const selected = lessons.filter(lesson => selectedIds.has(String(lesson.id)));
    if (!selected.length) return;
    const words = [...new Set(el('keywords').value.split(/[,，;；\s]+/).map(word => word.trim()).filter(Boolean))].slice(0, 8);
    el('prepare').disabled = true;
    el('keywords').disabled = true;
    el('lessons').querySelectorAll('input').forEach(input => { input.disabled = true; });
    el('select-all').disabled = true;
    el('result').hidden = false;
    status('正在读取转写和 PPT 清单…');
    prepared = await prepareSelection(selected,
      lesson => bridge('probe', { command: 'lesson', argument: { ...lesson, excludeWords: words } }),
      event => progress(event.lesson, event.phase, event.kind === 'error' ? 'error' : event.kind === 'ready' ? 'success' : ''));
    if (!prepared.ready.length) {
      status('所选节次没有可导出的转写与 PPT，请刷新后重试。', true);
      return;
    }
    await checkPermissions();
    const warningCount = prepared.ready.reduce((sum, entry) => sum + (entry.filterWarnings?.length || 0), 0);
    status(`已读取 ${prepared.ready.length} 节；${prepared.errors.length} 节缺少数据。${warningCount ? `另有 ${warningCount} 次 PPT 文字检索失败，图片检查仍可继续。` : ''}`);
  }

  function updateSlideCounts() {
    let total = 0;
    let excluded = 0;
    let emptyLessons = 0;
    for (const entry of prepared.ready) {
      const count = entry.plan.slides.filter(slide => slide.excludedReason).length;
      total += entry.plan.slides.length;
      excluded += count;
      if (count === entry.plan.slides.length) emptyLessons++;
      const summary = shadow.getElementById(`summary-${entry.lesson.id}`);
      if (summary) summary.textContent = `${labelOf(entry.lesson)}：保留 ${entry.plan.slides.length - count} / ${entry.plan.slides.length} 张`;
    }
    el('review-count').textContent = `保留 ${total - excluded} / ${total} 张`;
    el('save').disabled = exporting;
    if (emptyLessons) status(`${emptyLessons} 节课没有保留 PPT；导出时会将这些节次报告为失败，并继续其余节次。`, true);
  }

  function renderSlides() {
    el('slides').replaceChildren();
    for (const entry of prepared.ready) {
      const group = document.createElement('details');
      group.className = 'slide-group';
      group.open = entry.plan.slides.some(slide => slide.excludedReason);
      const summary = document.createElement('summary');
      summary.id = `summary-${entry.lesson.id}`;
      group.append(summary);
      for (const slide of entry.plan.slides) {
        const row = document.createElement('div');
        row.className = 'slide-row';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !slide.excludedReason;
        checkbox.setAttribute('aria-label', `${labelOf(entry.lesson)} ${clock(slide.changeTime)} 保留图片`);
        const link = document.createElement('a');
        link.href = slide.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = '在新标签页查看原图';
        const img = document.createElement('img');
        img.src = slide.url;
        img.loading = 'lazy';
        img.alt = `${clock(slide.changeTime)} 的 PPT 图片`;
        link.append(img);
        const info = document.createElement('span');
        info.textContent = `${clock(slide.changeTime)} · ${slide.excludedReason || '保留'}`;
        checkbox.addEventListener('change', () => {
          slide.excludedReason = checkbox.checked ? null : (slide.suggestedReason || '手动排除');
          info.textContent = `${clock(slide.changeTime)} · ${slide.excludedReason || '保留'}`;
          row.classList.toggle('excluded', !!slide.excludedReason);
          updateSlideCounts();
        });
        row.classList.toggle('excluded', !!slide.excludedReason);
        row.append(checkbox, link, info);
        group.append(row);
      }
      el('slides').append(group);
    }
    updateSlideCounts();
  }

  async function analyze() {
    if (analyzing) return;
    analyzing = true;
    el('analyze').disabled = true;
    let failures = 0;
    for (const entry of prepared.ready) {
      for (let index = 0; index < entry.plan.slides.length; index++) {
        const slide = entry.plan.slides[index];
        slide.suggestedReason = exclusionReason(slide);
        if (!slide.suggestedReason) {
          progress(entry.lesson, `检查图片 ${index + 1}/${entry.plan.slides.length}`);
          try {
            const image = await loadImage(slide.url);
            slide.suggestedReason = await inspectImage(image.bytes, image.contentType);
          } catch {
            failures++;
          }
        }
        slide.excludedReason = slide.suggestedReason;
        if (slide.excludedReason && imageCache.has(slide.url)) {
          cacheBytes -= imageCache.get(slide.url).bytes.length;
          imageCache.delete(slide.url);
        }
      }
      progress(entry.lesson, `图片检查完成：建议排除 ${entry.plan.slides.filter(slide => slide.excludedReason).length} 张`, 'success');
    }
    renderSlides();
    el('save').hidden = false;
    el('analyze').hidden = true;
    analyzing = false;
    status(`图片检查完成。请核对建议排除的图片，可逐张恢复或手动排除。${failures ? `${failures} 张图片未能分析，已默认保留，导出时会重试。` : ''}`);
  }

  async function save() {
    if (exporting || !prepared) return;
    if (typeof window.showDirectoryPicker !== 'function') {
      status('当前浏览器环境不支持选择文件夹。', true);
      return;
    }
    let root;
    try {
      // Invoke directly from the click handler while transient activation exists.
      root = await chooseDirectory(() => window.showDirectoryPicker({ mode: 'readwrite', id: 'sjtu-lecture-export' }));
    } catch (error) {
      status(`无法选择文件夹：${error.message}`, true);
      return;
    }
    if (!root) { status('已取消选择文件夹。'); return; }
    exporting = true;
    el('save').disabled = true;
    const result = await exportSelection(root, prepared.ready,
      (directory, entry, onProgress) => saveLesson(directory, entry.plan, loadImage, onProgress),
      event => progress(event.lesson, event.phase));
    for (const success of result.successes) progress(success.lesson, `已保存到 ${success.folder}`, 'success');
    for (const failure of result.errors) progress(failure.lesson, failure.message, 'error');
    exporting = false;
    updateSlideCounts();
    status(`导出完成：成功 ${result.successes.length} 节，失败 ${prepared.errors.length + result.errors.length} 节。`,
      prepared.errors.length + result.errors.length > 0);
  }

  el('close').addEventListener('click', () => { host.style.display = 'none'; });
  el('select-all').addEventListener('click', () => {
    const inputs = [...el('lessons').querySelectorAll('input:not(:disabled)')];
    const check = inputs.some(input => !input.checked);
    inputs.forEach(input => { input.checked = check; });
    updateSelection();
  });
  el('refresh').addEventListener('click', () => {
    if (analyzing || exporting) return;
    prepared = null;
    imageCache.clear();
    cacheBytes = 0;
    progressRows.clear();
    el('progress').replaceChildren();
    el('result').hidden = true;
    el('slides').replaceChildren();
    el('keywords').disabled = false;
    loadLessons().catch(error => status(error.message, true));
  });
  el('prepare').addEventListener('click', () => prepare().catch(error => status(`准备失败：${error.message}`, true)));
  el('grant').addEventListener('click', () => {
    // Send this request immediately from the user gesture.
    bridge('permission-request', { origins: missingOrigins })
      .then(async granted => {
        if (!granted) throw new Error('图片域名权限未授予');
        await checkPermissions();
        status('图片来源已授权，可以分析图片。');
      })
      .catch(error => {
        el('grant-fallback').hidden = false;
        status(`授权失败：${error.message}。可在扩展页完成授权。`, true);
      });
  });
  el('grant-fallback').addEventListener('click', () => {
    bridge('open-grant', { origins: missingOrigins })
      .then(() => status('授权页已打开；完成后会自动回到图片检查。'))
      .catch(error => status(`无法打开授权页：${error.message}`, true));
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'sjtu-export:permission-updated') {
      checkPermissions().then(() => status('图片来源已授权，可以分析图片。'))
        .catch(error => status(error.message, true));
    }
  });
  el('analyze').addEventListener('click', () => analyze().catch(error => {
    analyzing = false;
    el('analyze').disabled = false;
    status(`图片检查失败：${error.message}`, true);
  }));
  el('save').addEventListener('click', () => save().catch(error => {
    exporting = false;
    el('save').disabled = false;
    status(`导出失败：${error.message}`, true);
  }));

  const handle = el('drag-handle');
  let drag = null;
  handle.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    const box = host.getBoundingClientRect();
    drag = { x: event.clientX - box.left, y: event.clientY - box.top };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag) return;
    host.style.left = `${Math.max(0, Math.min(innerWidth - host.offsetWidth, event.clientX - drag.x))}px`;
    host.style.top = `${Math.max(0, Math.min(innerHeight - 70, event.clientY - drag.y))}px`;
    host.style.right = 'auto';
  });
  handle.addEventListener('pointerup', () => { drag = null; });
  handle.addEventListener('pointercancel', () => { drag = null; });

  loadLessons().catch(error => status(error.message, true));
  return { toggle() { host.style.display = host.style.display === 'none' ? '' : 'none'; } };
}
