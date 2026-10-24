const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Cau noi an toan giua UI (React) va Node/FFmpeg (main process).
// UI chi goi duoc dung nhung ham duoc khai bao o day.
contextBridge.exposeInMainWorld('taoclip', {
  platform: process.platform,
  openVideo: () => ipcRenderer.invoke('dialog:openVideo'),
  getEncoder: () => ipcRenderer.invoke('system:encoder'),
  openVideos: () => ipcRenderer.invoke('dialog:openVideos'),
  openImportMedia: () => ipcRenderer.invoke('dialog:openImportMedia'),
  openImages: () => ipcRenderer.invoke('dialog:openImages'),
  saveProject: (data, currentPath) => ipcRenderer.invoke('project:save', data, currentPath),
  writeProject: (filePath, data) => ipcRenderer.invoke('project:write', filePath, data),
  openProject: () => ipcRenderer.invoke('project:open'),
  collectProject: (data, currentPath) => ipcRenderer.invoke('project:collect', data, currentPath),
  writeRecovery: (project) => ipcRenderer.invoke('recovery:write', project),
  latestRecovery: () => ipcRenderer.invoke('recovery:latest'),
  dismissRecovery: (projectId, revision) => ipcRenderer.invoke('recovery:dismiss', projectId, revision),
  relinkMedia: (kind) => ipcRenderer.invoke('dialog:relinkMedia', kind),
  // Lay duong dan that cua file keo-tha (Electron 32+ da go File.path)
  getDroppedPath: (file) => webUtils.getPathForFile(file),
  probe: (filePath) => ipcRenderer.invoke('video:probe', filePath),
  logoPick: () => ipcRenderer.invoke('logos:pick'),
  logoList: () => ipcRenderer.invoke('logos:list'),
  logoSave: (payload) => ipcRenderer.invoke('logos:save', payload),
  logoRemove: (id) => ipcRenderer.invoke('logos:remove', id),
  logoUsePreset: (id) => ipcRenderer.invoke('logos:usePreset', id),
  inspectMedia: (filePath) => ipcRenderer.invoke('media:inspect', filePath),
  createPreviewProxy: (filePath) => ipcRenderer.invoke('video:createPreviewProxy', filePath),
  renderFilterPreview: (request) => ipcRenderer.invoke('video:filterPreview', request),
  thumbnails: (filePath, count) => ipcRenderer.invoke('video:thumbnails', filePath, count),
  prioritizeMediaCache: (filePath) => ipcRenderer.invoke('video:prioritizeCache', filePath),
  waveform: (filePath) => ipcRenderer.invoke('video:waveform', filePath),
  detectSilence: (filePath, opts) => ipcRenderer.invoke('video:detectSilence', filePath, opts),
  generateCaptions: (filePath, opts) => ipcRenderer.invoke('captions:generate', filePath, opts),
  saveSrt: (captions) => ipcRenderer.invoke('captions:saveSrt', captions),
  openSrt: () => ipcRenderer.invoke('captions:openSrt'),
  onCaptionProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('captions:progress', handler)
    return () => ipcRenderer.removeListener('captions:progress', handler)
  },
  openAudio: () => ipcRenderer.invoke('dialog:openAudio'),
  openAudioFiles: () => ipcRenderer.invoke('dialog:openAudioFiles'),
  generateTTS: (text, opts) => ipcRenderer.invoke('tts:generate', text, opts),
  getLocalTtsModelStatus: () => ipcRenderer.invoke('tts:modelStatus'),
  getVoices: (langCode) => ipcRenderer.invoke('tts:voices', langCode),
  setApiKey: (key) => ipcRenderer.invoke('settings:setApiKey', key),
  hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
  getApiKeyStatus: () => ipcRenderer.invoke('settings:apiKeyStatus'),
  onTtsProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('tts:progress', handler)
    return () => ipcRenderer.removeListener('tts:progress', handler)
  },
  downloadVideo: (options) => ipcRenderer.invoke('dl:video', options),
  cancelDownload: () => ipcRenderer.invoke('dl:cancel'),
  chooseDownloadDirectory: () => ipcRenderer.invoke('dl:chooseDirectory'),
  onDlProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('dl:progress', handler)
    return () => ipcRenderer.removeListener('dl:progress', handler)
  },
  replaceBg: (opts) => ipcRenderer.invoke('ai:replaceBg', opts),
  previewBg: (opts) => ipcRenderer.invoke('ai:previewBg', opts),
  cancelAi: () => ipcRenderer.invoke('ai:cancel'),
  getAiModelStatus: () => ipcRenderer.invoke('ai:modelStatus'),
  ensureAiModel: () => ipcRenderer.invoke('ai:ensureModel'),
  faceSwap: (opts) => ipcRenderer.invoke('ai:faceSwap', opts),
  openFaceImage: () => ipcRenderer.invoke('dialog:openFaceImage'),
  onFaceProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('face:progress', handler)
    return () => ipcRenderer.removeListener('face:progress', handler)
  },
  onAiProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('ai:progress', handler)
    return () => ipcRenderer.removeListener('ai:progress', handler)
  },
  redub: (payload) => ipcRenderer.invoke('redub:generate', payload),
  onRedubProgress: (cb) => {
    const handler = (_e, s) => cb(s)
    ipcRenderer.on('redub:progress', handler)
    return () => ipcRenderer.removeListener('redub:progress', handler)
  },
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  freezeFrame: (filePath, time) => ipcRenderer.invoke('video:freezeFrame', filePath, time),
  saveAudioAs: (request) => ipcRenderer.invoke('audio:saveAs', request),
  saveVideo: (defaultName) => ipcRenderer.invoke('dialog:saveVideo', defaultName),
  exportVideo: (opts) => ipcRenderer.invoke('video:export', opts),
  cancelExport: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  onExportProgress: (cb) => {
    const handler = (_e, pct) => cb(pct)
    ipcRenderer.on('video:export:progress', handler)
    return () => ipcRenderer.removeListener('video:export:progress', handler)
  },
  onExportStage: (cb) => {
    const handler = (_e, name) => cb(name)
    ipcRenderer.on('video:export:stage', handler)
    return () => ipcRenderer.removeListener('video:export:stage', handler)
  }
})
