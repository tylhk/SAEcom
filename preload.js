const { contextBridge, ipcRenderer } = require('electron');
const { shell } = require('electron');

function decodeBase64ToUint8Array(b64) {
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf);
}

contextBridge.exposeInMainWorld('api', {
  tcp: {
    open: (host, port, options) => ipcRenderer.invoke('tcp:open', { host, port, options }),
    write: (id, data, mode, append) => ipcRenderer.invoke('tcp:write', { id, data, mode, append }),
    close: (id) => ipcRenderer.invoke('tcp:close', { id }),
    onData: (cb) => ipcRenderer.on('tcp:data', (_e, p) => cb({ id: p.id, bytes: decodeBase64ToUint8Array(p.base64), ts: p.ts })),
    onEvent: (cb) => ipcRenderer.on('tcp:event', (_e, p) => cb(p)),
  },  
  tcpShare: {
    start: (id, port) => ipcRenderer.invoke('tcpShare:start', { id, port }),
    stop:  (id)       => ipcRenderer.invoke('tcpShare:stop',  { id }),
    status:(id)       => ipcRenderer.invoke('tcpShare:status',{ id })
  },
  window: {
    setFullscreen: (flag) => ipcRenderer.send('window:set-fullscreen', { flag }),
    toggleFullscreen: () => ipcRenderer.send('window:toggle-fullscreen'),
    focus: () => ipcRenderer.send('window:focus')
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
    popout: (id, title, historyStr, alwaysOnTop, isOpen, viewMode, optionsStr) => 
    ipcRenderer.invoke('panel:popout', { id, title, historyStr, alwaysOnTop, isOpen, viewMode, optionsStr }),
    onFocusFromPopout: (cb) => ipcRenderer.on('panel:focus', (_e, payload) => cb(payload)),
    onDockRequest: (cb) => ipcRenderer.on('panel:dock', (_e, payload) => cb(payload)),
    onHideRequest: (cb) => ipcRenderer.on('panel:hide', (_e, payload) => cb(payload)),
    requestHide: (id) => ipcRenderer.send('panel:request-hide', { id }),
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
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    checkUpdate: () => ipcRenderer.send('app:checkUpdate')
  },
  changelog: {
    open: () => ipcRenderer.send('changelog:open'),
    request: () => ipcRenderer.send('changelog:request'),
    onLoad: (cb) => ipcRenderer.on('changelog:content', (_e, text) => cb(text))
  },
  theme: {
    set: (dark) => ipcRenderer.send('theme:set', { dark }),
    onApply: (cb) => ipcRenderer.on('theme:apply', (_e, payload) => cb(payload))
  }

});
