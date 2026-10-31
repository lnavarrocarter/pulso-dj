const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  chooseAudio: () => ipcRenderer.invoke('audio:choose'),
  importYouTube: url => ipcRenderer.invoke('youtube:import', url),
  cancelYouTube: () => ipcRenderer.invoke('youtube:cancel'),
  saveImportedAudio: file => ipcRenderer.invoke('audio:save-import', file),
  setCameraEnabled: enabled => ipcRenderer.invoke('camera:enable', enabled),
  library: {
    list: () => ipcRenderer.invoke('library:list'),
    importYouTube: url => ipcRenderer.invoke('library:import-youtube', url),
    addFiles: multiple => ipcRenderer.invoke('library:add-files', multiple),
    read: id => ipcRenderer.invoke('library:read', id),
    setDuration: (id, duration) => ipcRenderer.invoke('library:set-duration', id, duration),
    remove: id => ipcRenderer.invoke('library:remove', id),
    export: id => ipcRenderer.invoke('library:export', id)
  },
  onYouTubeProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('youtube:progress', listener);
    return () => ipcRenderer.removeListener('youtube:progress', listener);
  }
});
