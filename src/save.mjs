import { extensionForImage, renderPptIndex, uniqueFolderName } from './core.mjs';

async function writeFile(directory, name, data) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function saveLesson(root, lesson, fetchImage, onProgress = () => {}) {
  const selectedSlides = lesson.slides.filter(slide => !slide.excludedReason);
  if (!selectedSlides.length) throw new Error('该节次没有保留的 PPT 图片，请恢复至少一张');
  // Complete every network request before creating a folder. A missing image
  // therefore cannot leave behind an export that looks finished.
  const images = [];
  for (let index = 0; index < selectedSlides.length; index++) {
    const slide = selectedSlides[index];
    onProgress(`下载 PPT ${index + 1}/${selectedSlides.length}`);
    const response = await fetchImage(slide.url);
    const bytes = response.bytes instanceof Uint8Array ? response.bytes : new Uint8Array(response.bytes);
    slide.extension = extensionForImage(response.contentType, bytes);
    images.push(bytes);
  }

  const existingNames = new Set();
  for await (const name of root.keys()) existingNames.add(name);
  const folderName = uniqueFolderName(lesson.stem, existingNames);
  const folder = await root.getDirectoryHandle(folderName, { create: true });
  const marker = '导出未完成.txt';
  try {
    await writeFile(folder, marker, '该节次导出尚未完成，请查看扩展中的错误提示。\n');
    const pptFolder = await folder.getDirectoryHandle('PPT', { create: true });
    for (let index = 0; index < selectedSlides.length; index++) {
      onProgress(`保存 PPT ${index + 1}/${selectedSlides.length}`);
      const slide = selectedSlides[index];
      await writeFile(pptFolder, `${slide.filenameBase}.${slide.extension}`, images[index]);
    }
    await writeFile(folder, `${lesson.stem}.txt`, `\uFEFF${lesson.transcript}`);
    await writeFile(folder, 'PPT索引.txt', `\uFEFF${renderPptIndex(lesson.slides)}`);
    await folder.removeEntry(marker);
  } catch (error) {
    throw new Error(`文件夹 ${folderName} 写入失败，可能保留部分文件：${error instanceof Error ? error.message : String(error)}`);
  }
  return folderName;
}
