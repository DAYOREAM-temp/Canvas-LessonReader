function clockFromMilliseconds(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('时间值无效');
  const milliseconds = Math.round(value);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1_000) % 60;
  const fraction = milliseconds % 1_000;
  const base = [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':');
  return fraction ? `${base}.${String(fraction).padStart(3, '0')}` : base;
}

function clockFromSeconds(value) {
  return clockFromMilliseconds(Number(value) * 1_000);
}

function dateOf(value) {
  if (typeof value === 'string') {
    if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp)) throw new Error('上课日期无效');
      return dateOf(timestamp);
    }
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(value));
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
  throw new Error('上课日期无效');
}

export function buildLesson(lesson, rawCaptions, rawSlides) {
  const ordinal = Number(lesson?.ordinal);
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error('页面节次编号无效');
  const stem = `${dateOf(lesson.courBeginTime)}_第${ordinal}次课`;
  if (!Array.isArray(rawCaptions) || !rawCaptions.length) throw new Error('该节次暂无转写');
  const captions = rawCaptions.filter(item => typeof item?.res === 'string' && item.res.trim());
  if (!captions.length) throw new Error('该节次暂无转写');
  for (const item of captions) {
    if (!Number.isFinite(Number(item.bg)) || !Number.isFinite(Number(item.ed)) ||
        Number(item.bg) < 0 || Number(item.ed) < Number(item.bg)) {
      throw new Error('转写时间异常');
    }
  }
  captions.sort((a, b) => Number(a.bg) - Number(b.bg));
  const transcript = captions.map(item => {
    const content = item.res.replace(/\s+/g, ' ').trim();
    return `[${clockFromMilliseconds(Number(item.bg))} - ${clockFromMilliseconds(Number(item.ed))}] ${content}`;
  }).join('\n') + '\n';

  if (!Array.isArray(rawSlides) || !rawSlides.length) throw new Error('该节次暂无 PPT 图片');
  const sorted = rawSlides.map(item => {
    const changeTime = Number(item?.imageSeekTime);
    if (!Number.isFinite(changeTime) || changeTime < 0) throw new Error('PPT 换页时间异常');
    let url;
    try { url = new URL(item.imageUrl); } catch { throw new Error('PPT 图片地址无效'); }
    if (url.protocol !== 'https:') throw new Error('PPT 图片必须使用 HTTPS');
    return { changeTime, url: url.href, filterWords: Array.isArray(item.filterWords) ? [...item.filterWords] : [] };
  }).sort((a, b) => a.changeTime - b.changeTime);
  const slides = [];
  for (const slide of sorted) {
    if (slides.length && slides.at(-1).changeTime === slide.changeTime) slides[slides.length - 1] = slide;
    else slides.push(slide);
  }
  slides.forEach((slide, index) => {
    slide.filenameBase = `${String(index + 1).padStart(4, '0')}_${clockFromSeconds(slide.changeTime).replaceAll(':', '-')}`;
  });
  return { stem, transcript, captionCount: captions.length, slides };
}

export function renderPptIndex(slides) {
  const rows = ['序号\t页面显示区间\t换页时间\t图片文件\t状态'];
  slides.forEach((slide, index) => {
    const start = index === 0 ? '00:00:00' : clockFromSeconds(slide.changeTime);
    const end = index + 1 < slides.length ? clockFromSeconds(slides[index + 1].changeTime) : '至结束';
    const prefix = `${index + 1}\t${start} - ${end}\t${clockFromSeconds(slide.changeTime)}`;
    if (slide.excludedReason) {
      rows.push(`${prefix}\t—\t已排除：${slide.excludedReason}`);
    } else {
      if (!slide.extension) throw new Error('PPT 图片文件类型未确定');
      rows.push(`${prefix}\tPPT/${slide.filenameBase}.${slide.extension}\t保留`);
    }
  });
  return rows.join('\n') + '\n';
}

export function uniqueFolderName(stem, existingNames) {
  if (!existingNames.has(stem)) return stem;
  let suffix = 2;
  while (existingNames.has(`${stem} (${suffix})`)) suffix++;
  return `${stem} (${suffix})`;
}

export function extensionForImage(contentType, bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const has = (...numbers) => numbers.every((number, index) => view[index] === number);
  if (has(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (has(0xff, 0xd8, 0xff)) return 'jpg';
  if (has(0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (has(0x42, 0x4d)) return 'bmp';
  const ascii = (start, end) => String.fromCharCode(...view.slice(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && ascii(8, 12).startsWith('avif')) return 'avif';
  throw new Error(`响应不是可识别的图片（${contentType || '无内容类型'}）`);
}
