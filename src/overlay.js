if (globalThis.__sjtuLectureExporterPanel) {
  globalThis.__sjtuLectureExporterPanel.toggle();
} else {
  globalThis.__sjtuLectureExporterPanel = { toggle() {} };
  import(chrome.runtime.getURL('src/panel.mjs'))
    .then(({ mountPanel }) => { globalThis.__sjtuLectureExporterPanel = mountPanel(); })
    .catch(error => {
      globalThis.__sjtuLectureExporterPanel = null;
      alert(`无法打开课堂导出悬浮窗：${error.message}`);
    });
}
