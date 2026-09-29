export async function chooseDirectory(openPicker) {
  try {
    return await openPicker();
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  }
}
