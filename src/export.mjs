import { pageProbe } from './page-probe.mjs';
import { unwrapProbeResult } from './probe-result.mjs';
import { prepareSelection, imageOrigins, exportSelection } from './workflow.mjs';
import { saveLesson } from './save.mjs';
import { fetchImage } from './image-fetch.mjs';
import { chooseDirectory } from './picker.mjs';

const elements = Object.fromEntries([
  'lessons', 'count', 'select-all', 'prepare', 'result-card', 'preview',
  'permission-note', 'grant', 'save', 'progress', 'message', 'refresh',
].map(id => [id, document.getElementById(id)]));
const params = new URLSearchParams(location.search);
const sourceTabId = Number(params.get('tabId'));
let lessons = [];
let prepared = null;
let missingOrigins = [];
const progressRows = new Map();

function message(text, error = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle('error', error);
}

function labelOf(lesson) {
  const date = String(lesson.courBeginTime || '').slice(0, 10);
  return `${date} · 第${lesson.ordinal}次课`;
}

async function runOnPage(command, argument = null) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: sourceTabId },
    world: 'MAIN',
    func: pageProbe,
    args: [command, argument],
  });
  return unwrapProbeResult(results);
}

function setProgress(lesson, text, kind = '') {
  let row = progressRows.get(String(lesson.id));
  if (!row) {
    row = document.createElement('div');
    row.className = 'progress-row';
    elements.progress.append(row);
    progressRows.set(String(lesson.id), row);
  }
  row.className = `progress-row ${kind}`.trim();
  row.textContent = `${labelOf(lesson)}：${text}`;
}

function renderLessons() {
  elements.lessons.replaceChildren();
  lessons.forEach(lesson => {
    const row = document.createElement('label');
    row.className = `lesson${lesson.available ? '' : ' unavailable'}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = String(lesson.id);
    checkbox.disabled = !lesson.available;
    checkbox.addEventListener('change', updateCount);
    const main = document.createElement('span');
    main.className = 'lesson-main';
    const title = document.createElement('span');
    title.className = 'lesson-title';
    title.textContent = labelOf(lesson);
    const subtitle = document.createElement('span');
    subtitle.className = 'lesson-subtitle';
    subtitle.textContent = [lesson.title, lesson.available ? '' : '不可播放'].filter(Boolean).join(' · ');
    main.append(title, subtitle);
    row.append(checkbox, main);
    elements.lessons.append(row);
  });
  elements['select-all'].disabled = !lessons.some(lesson => lesson.available);
  updateCount();
}

function updateCount() {
  const count = elements.lessons.querySelectorAll('input:checked').length;
  elements.count.textContent = `已选 ${count} / ${lessons.length} 节`;
  elements.prepare.disabled = count === 0 || prepared !== null;
}

async function loadLessons() {
  if (params.has('error')) throw new Error(params.get('error'));
  if (!Number.isSafeInteger(sourceTabId) || sourceTabId < 1) throw new Error('缺少课程页面标签页');
  lessons = await runOnPage('list');
  renderLessons();
  message(`已读取 ${lessons.length} 个节次，请勾选需要导出的课程。`);
}

async function checkImagePermissions() {
  missingOrigins = [];
  for (const origin of imageOrigins(prepared.ready)) {
    if (!await chrome.permissions.contains({ origins: [origin] })) missingOrigins.push(origin);
  }
  if (missingOrigins.length) {
    elements['permission-note'].hidden = false;
    elements['permission-note'].textContent = `PPT 图片来自 ${missingOrigins.map(origin => new URL(origin.replace('*', '')).host).join('、')}。请授权这些图片来源后再保存。`;
    elements.grant.hidden = false;
    elements.save.hidden = true;
  } else {
    elements['permission-note'].hidden = true;
    elements.grant.hidden = true;
    elements.save.hidden = false;
  }
}

async function prepare() {
  const ids = new Set([...elements.lessons.querySelectorAll('input:checked')].map(input => input.value));
  const selected = lessons.filter(lesson => ids.has(String(lesson.id)));
  if (!selected.length) return;
  elements.prepare.disabled = true;
  elements.lessons.querySelectorAll('input').forEach(input => { input.disabled = true; });
  elements['select-all'].disabled = true;
  elements['result-card'].hidden = false;
  message('正在读取所选节次的转写和 PPT 清单…');
  prepared = await prepareSelection(selected, lesson => runOnPage('lesson', lesson), event => {
    setProgress(event.lesson, event.phase,
      event.kind === 'ready' ? 'success' : event.kind === 'error' ? 'error' : '');
  });
  for (const failure of prepared.errors) setProgress(failure.lesson, failure.message, 'error');
  if (!prepared.ready.length) {
    elements.preview.textContent = '所选节次均未通过检查。可刷新页面后重试。';
    message('没有可导出的节次。', true);
    return;
  }
  const first = prepared.ready[0];
  elements.preview.textContent = `可导出 ${prepared.ready.length} 节；首节包含 ${first.plan.captionCount} 段转写、${first.plan.slides.length} 张 PPT。转写预览：${first.plan.transcript.split('\n')[0]}`;
  await checkImagePermissions();
  message(`准备完成：${prepared.ready.length} 节可导出，${prepared.errors.length} 节未通过检查。`);
}

elements.refresh.addEventListener('click', () => location.reload());
elements['select-all'].addEventListener('click', () => {
  const checkboxes = [...elements.lessons.querySelectorAll('input:not(:disabled)')];
  const shouldCheck = checkboxes.some(input => !input.checked);
  checkboxes.forEach(input => { input.checked = shouldCheck; });
  updateCount();
});
elements.prepare.addEventListener('click', () => {
  prepare().catch(error => message(`准备失败：${error.message}`, true));
});
elements.grant.addEventListener('click', async () => {
  // Permission request must start directly from this click gesture.
  const request = chrome.permissions.request({ origins: missingOrigins });
  try {
    if (!await request) throw new Error('图片域名权限未授予');
    await checkImagePermissions();
    message('图片来源已授权，可以选择保存文件夹。');
  } catch (error) {
    message(error.message, true);
  }
});
elements.save.addEventListener('click', async () => {
  if (typeof window.showDirectoryPicker !== 'function') {
    message('当前 Chrome 不支持选择文件夹写入。', true);
    return;
  }
  // The picker also needs a direct user gesture, before any await.
  let root;
  try { root = await chooseDirectory(() => window.showDirectoryPicker({ mode: 'readwrite' })); } catch (error) {
    message(`无法选择文件夹：${error.message}`, true);
    return;
  }
  if (!root) {
    message('已取消选择文件夹。');
    return;
  }
  elements.save.disabled = true;
  const summary = await exportSelection(root, prepared.ready,
    (directory, entry, progress) => saveLesson(directory, entry.plan, fetchImage, progress),
    event => setProgress(event.lesson, event.phase));
  for (const success of summary.successes) setProgress(success.lesson, `已保存到 ${success.folder}`, 'success');
  for (const failure of summary.errors) setProgress(failure.lesson, failure.message, 'error');
  message(`导出结束：成功 ${summary.successes.length} 节，失败 ${prepared.errors.length + summary.errors.length} 节。`, summary.errors.length > 0);
  elements.save.disabled = false;
});

loadLessons().catch(error => {
  elements.lessons.textContent = '无法读取节次列表。';
  message(error.message, true);
});
