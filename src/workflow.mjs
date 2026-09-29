import { buildLesson } from './core.mjs';

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function prepareSelection(lessons, readLesson, onUpdate = () => {}) {
  const ready = [];
  const errors = [];
  for (const lesson of lessons) {
    onUpdate({ lesson, phase: '读取转写与 PPT' });
    try {
      const response = await readLesson(lesson);
      const plan = buildLesson(lesson, response.captions, response.slides);
      ready.push({ lesson, plan, filterWarnings: response.filterWarnings || [] });
      onUpdate({ lesson, phase: `已读取 ${plan.captionCount} 段转写、${plan.slides.length} 张 PPT`, kind: 'ready' });
    } catch (error) {
      const message = messageOf(error);
      errors.push({ lesson, message });
      onUpdate({ lesson, phase: message, kind: 'error' });
    }
  }
  return { ready, errors };
}

export function imageOrigins(ready) {
  const origins = new Set();
  for (const entry of ready) {
    for (const slide of entry.plan.slides) origins.add(`${new URL(slide.url).origin}/*`);
  }
  return [...origins];
}

export async function exportSelection(root, ready, saveOne, onUpdate = () => {}) {
  const successes = [];
  const errors = [];
  for (const entry of ready) {
    onUpdate({ lesson: entry.lesson, phase: '下载并保存' });
    try {
      const folder = await saveOne(root, entry, phase => onUpdate({ lesson: entry.lesson, phase }));
      successes.push({ lesson: entry.lesson, folder });
      onUpdate({ lesson: entry.lesson, phase: '完成' });
    } catch (error) {
      errors.push({ lesson: entry.lesson, message: messageOf(error) });
      onUpdate({ lesson: entry.lesson, phase: '失败' });
    }
  }
  return { successes, errors };
}
