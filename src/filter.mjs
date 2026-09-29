export function exclusionReason(slide) {
  const words = Array.isArray(slide?.filterWords) ? slide.filterWords.filter(Boolean) : [];
  return words.length ? `页面检索：${words.join('、')}` : null;
}

export function classifyScreenRows({ data, width, height }) {
  if (!data || width < 20 || height < 20) return null;
  function fraction(yFraction, matches) {
    const y = Math.min(height - 1, Math.floor(height * yFraction));
    let count = 0;
    let total = 0;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (matches(data[offset], data[offset + 1], data[offset + 2])) count++;
      total++;
    }
    return count / total;
  }
  const darkNeutral = (red, green, blue) =>
    0.2126 * red + 0.7152 * green + 0.0722 * blue < 95 &&
    Math.max(red, green, blue) - Math.min(red, green, blue) < 45;
  const blueDesktop = (red, green, blue) =>
    blue > 90 && blue > red * 1.35 && blue > green * 1.12;
  if (fraction(0.97, darkNeutral) < 0.88 || fraction(0.985, darkNeutral) < 0.88) return null;
  if (fraction(0.02, darkNeutral) > 0.8 && fraction(0.07, darkNeutral) > 0.8) return '浏览器画面';
  if (fraction(0.02, blueDesktop) > 0.8 && fraction(0.07, blueDesktop) > 0.8) return '桌面画面';
  return null;
}

export async function inspectImage(bytes, contentType = 'image/jpeg') {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: contentType }));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return classifyScreenRows(context.getImageData(0, 0, canvas.width, canvas.height));
  } finally {
    bitmap.close();
  }
}
