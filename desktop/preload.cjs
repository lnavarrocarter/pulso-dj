const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  chooseAudio: () => ipcRenderer.invoke('audio:choose'),
  importYouTube: url => ipcRenderer.invoke('youtube:import', url),
  cancelYouTube: () => ipcRenderer.invoke('youtube:cancel'),
  saveImportedAudio: file => ipcRenderer.invoke('audio:save-import', file),
  setCameraEnabled: enabled => ipcRenderer.invoke('camera:enable', enabled),
  onYouTubeProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('youtube:progress', listener);
    return () => ipcRenderer.removeListener('youtube:progress', listener);
  }
});
