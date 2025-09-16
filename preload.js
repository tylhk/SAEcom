const { contextBridge, ipcRenderer } = require('electron');
const { shell } = require('electron');

function decodeBase64ToUint8Array(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf);
}

contextBridge.exposeInMainWorld('api', {
  window: {
    setFullscreen: (flag) => ipcRenderer.send('window:set-fullscreen', { flag }),
    toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen')
  },
  serial: {
    list: () => ipcRenderer.invoke('serial:list'),
    open: (path, options) => ipcRenderer.invoke('serial:open', { path, options }),
    close: (id) => ipcRenderer.invoke('serial:close', { id }),
    write: (id, data, mode = 'text', append = 'none') =>
      ipcRenderer.invoke('serial:write', { id, data, mode, append }),
    onData: (cb) => {
      ipcRenderer.on('serial:data', (_e, payload) => {
        cb({ id: payload.id, bytes: decodeBase64ToUint8Array(payload.base64), ts: payload.ts });
      });
    },
    onEvent: (cb) => {
      ipcRenderer.on('serial:event', (_e, payload) => cb(payload));
    }
  },
  panel: {
    popout: (id, title, html) => ipcRenderer.invoke('panel:popout', { id, title, html }),
    onFocusFromPopout: (cb) => ipcRenderer.on('panel:focus', (_e, payload) => cb(payload)),
    onDockRequest: (cb) => ipcRenderer.on('panel:dock', (_e, payload) => cb(payload)),
    onLoadContent: (cb) => ipcRenderer.on('panel:loadContent', (_e, payload) => cb(payload)),
    requestDock: (id, html) => ipcRenderer.send('panel:request-dock', { id, html }),
    getPanelPortIdFromArgs: () => {
      const arg = (process.argv || []).find(a => a.startsWith('--panelPortId='));
      if (!arg) return null;
      return decodeURIComponent(arg.split('=')[1]);
    },
    saveLog: (name, content) => ipcRenderer.invoke('panel:saveLog', { name, content })
  },
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (panels) => ipcRenderer.send('config:save', panels)
  },
  commands: {
    load: () => ipcRenderer.invoke('commands:load'),
    save: (cmds) => ipcRenderer.send('commands:save', cmds)
  },
  file: {
    readHex: (filePath) => ipcRenderer.invoke('file:readHex', filePath)
  },
  shell: {
    openExternal: (url) => shell.openExternal(url)
  },
  scripts: {
    dir: () => ipcRenderer.invoke('scripts:dir'),
    list: () => ipcRenderer.invoke('scripts:list'),
    read: (name) => ipcRenderer.invoke('scripts:read', name),
    write: (name, content) => ipcRenderer.invoke('scripts:write', { name, content }),
    delete: (name) => ipcRenderer.invoke('scripts:delete', name),
    run: (code, ctx) => ipcRenderer.invoke('scripts:run', { code, ctx }),
    stop: (runId) => ipcRenderer.invoke('scripts:stop', { runId }),
    onEnded: (cb) => ipcRenderer.on('scripts:ended', (_e, payload) => cb(payload))
  },
  theme: { set: (dark) => ipcRenderer.send('theme:set', { dark }) }
});
