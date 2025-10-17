// ========== 主进程入口 ==========
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { SerialPort } = require('serialport');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const runningScripts = new Map();
const ports = new Map();
const scriptWatchers = new Map();

const configPath = path.join(app.getPath('userData'), 'panels.json');
const commandsPath = path.join(app.getPath('userData'), 'commands.json');
const scriptsDir = path.join(app.getPath('userData'), 'scripts');

// ========== 工具 ==========
function shouldSuppressPortError(entry, err) {
  if (!entry) return true;
  if (entry.suppressErrorUntil && Date.now() < entry.suppressErrorUntil) return true;
  const msg = String(err?.message || '').toLowerCase();
  if (msg.includes('port is not open')) return true;
  return false;
}
function loadJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function saveJsonSafe(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { console.error(e); }
}
function ensureScriptsDir() { try { fs.mkdirSync(scriptsDir, { recursive: true }); } catch { } }
function safeScriptName(name) {
  name = String(name || '').trim().replace(/[/\\]/g, '');
  if (!name.endsWith('.js')) name += '.js';
  return name;
}
function getPortId(portPath) { return portPath; }

// ========== 配置 ==========
const loadPanelsConfig = () => loadJsonSafe(configPath, []);
const savePanelsConfig = (panels) => saveJsonSafe(configPath, panels);
const loadCommandsConfig = () => loadJsonSafe(commandsPath, []);
const saveCommandsConfig = (cmds) => saveJsonSafe(commandsPath, cmds);

// ========== 窗口 ==========
let mainWindow = null;
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : undefined,
    titleBarOverlay: process.platform === 'win32' ? { color: '#f5f7fa', symbolColor: '#1f2937', height: 30 } : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => {
    BrowserWindow.getAllWindows().forEach(win => { if (win !== mainWindow) win.close(); });
    mainWindow = null;
  });
  const openExternal = (url) => (/^https?:/i.test(url) || /^mailto:/i.test(url)) && (shell.openExternal(url), true);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => openExternal(url) ? { action: 'deny' } : { action: 'allow' });
  mainWindow.webContents.on('will-navigate', (e, url) => { if (openExternal(url)) e.preventDefault(); });
}

const net = require('net');

const sockets = new Map();
const TCP_DEFAULTS = {
  timeoutMs: 2500,
  keepAlive: true,
  keepAliveSec: 60,
  noDelay: true,
  autoReconnect: false,   // 先默认关闭；要开的话把这里改成 true
  reconnectMs: 2000
};

ipcMain.handle('tcp:open', async (e, { host, port, options }) => {
  const opts = Object.assign({}, TCP_DEFAULTS, options || {});
  const id = `tcp://${host}:${port}`;
  if (sockets.has(id)) return { ok: true, id, already: true };

  const entry = { id, host, port, opts, win: e.sender, manualClose: false, socket: null };

  function start(resolveOpen, rejectOpen) {
    const s = new net.Socket();
    entry.socket = s;
    try {
      s.setNoDelay(!!opts.noDelay);
      if (opts.keepAlive) s.setKeepAlive(true, opts.keepAliveSec * 1000);
    } catch { }

    s.once('connect', () => {
      try { entry.win.send('tcp:event', { id, type: 'open' }); } catch { }
      resolveOpen && resolveOpen({ ok: true, id });
    }); s.on('data', (buf) => {
      try { entry.win.send('tcp:data', { id, base64: Buffer.from(buf).toString('base64'), ts: Date.now() }); } catch { }
    });
    s.on('error', (err) => {
      try { entry.win.send('tcp:event', { id, type: 'error', message: String(err?.message || err) }); } catch { }
      rejectOpen && rejectOpen({ ok: false, error: String(err?.message || err) });
    });
    s.on('close', () => {
      try { entry.win.send('tcp:event', { id, type: 'close' }); } catch { }
      if (entry.manualClose) { sockets.delete(id); return; }
      if (opts.autoReconnect) setTimeout(() => { if (sockets.has(id)) start(); }, opts.reconnectMs);
      else sockets.delete(id);
    });

    try { s.connect({ host, port }); } catch (err) {
      sockets.delete(id);
      return;
    }

    if (opts.timeoutMs > 0) {
      setTimeout(() => {
        if (!s.destroyed && !s.remoteAddress) {
          try { s.destroy(new Error('连接超时')); } catch { }
        }
      }, opts.timeoutMs);
    }
  }

  sockets.set(id, entry);
  return await new Promise((resolve) => {
    let settled = false;
    const resolveOnce = (r) => { if (!settled) { settled = true; resolve(r); } };
    start((r) => resolveOnce(r), (r) => resolveOnce(r));
    if (opts.timeoutMs > 0) {
      setTimeout(() => {
        if (!entry.socket?.remoteAddress) {
          try { entry.socket?.destroy(new Error('连接超时')); } catch { }
          resolveOnce({ ok: false, error: '连接超时' });
        }
      }, opts.timeoutMs);
    }
  });
});

ipcMain.handle('tcp:write', async (_e, { id, data, mode = 'text', append = 'none' }) => {
  const entry = sockets.get(id);
  if (!entry || !entry.socket) return { ok: false, error: 'NOT_OPEN' };
  let buf;
  try { buf = buildWriteBuffer(data, mode, append); } catch (e) { return { ok: false, error: e.message }; }
  return await new Promise(res => entry.socket.write(buf, err => res(err ? { ok: false, error: err.message } : { ok: true, bytes: buf.length })));
});

ipcMain.handle('tcp:close', async (_e, { id }) => {
  const entry = sockets.get(id);
  if (!entry) return { ok: true, notOpen: true };
  entry.manualClose = true;
  try { entry.socket.end(); entry.socket.destroy(); } catch { }
  sockets.delete(id);
  return { ok: true };
});

// ========== 串口 ==========
function buildWriteBuffer(data, mode, append) {
  let payload = data || '';
  if (append === 'CR') payload += '\r';
  else if (append === 'LF') payload += '\n';
  else if (append === 'CRLF') payload += '\r\n';
  if (mode === 'hex') {
    const clean = payload.replace(/[\s,]/g, '');
    if (clean.length % 2 !== 0) throw new Error('HEX长度必须为偶数');
    return Buffer.from(clean.match(/.{1,2}/g).map(h => parseInt(h, 16)));
  }
  if (mode === 'base64') return Buffer.from(payload, 'base64');
  return Buffer.from(payload, 'utf8');
}
function writeToSerial(id, data, mode = 'text', append = 'none') {
  const entry = ports.get(id);
  if (!entry) return Promise.resolve({ ok: false, error: 'PORT_NOT_OPEN' });
  let buf; try { buf = buildWriteBuffer(data, mode, append); } catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
  return new Promise(r => entry.port.write(buf, err => r(err ? { ok: false, error: err.message } : { ok: true, bytes: buf.length })));
}

// ========== 脚本 ==========
function addScriptWatcher(portId, runId, fn) {
  if (!scriptWatchers.has(portId)) scriptWatchers.set(portId, new Map());
  scriptWatchers.get(portId).set(runId, fn);
}
function removeScriptWatcher(runId) {
  for (const [pid, m] of scriptWatchers) { m.delete(runId); if (!m.size) scriptWatchers.delete(pid); }
}
function notifyScriptWatchers(portId, buf) {
  const m = scriptWatchers.get(portId); if (!m) return;
  const payload = { bytes: Uint8Array.from(buf), text: (() => { try { return buf.toString('utf8') } catch { return '' } })() };
  for (const fn of m.values()) try { fn(payload); } catch { }
}

// ========== IPC ==========
ipcMain.handle('config:load', () => loadPanelsConfig());
ipcMain.on('config:save', (_e, p) => savePanelsConfig(p));
ipcMain.handle('commands:load', () => loadCommandsConfig());
ipcMain.on('commands:save', (_e, c) => saveCommandsConfig(c));

const { execFile } = require('child_process');

async function listSerialPortsSafe() {
  let base = [];
  try { base = await SerialPort.list(); } catch { base = []; }

  // 规范化为我们前端使用的结构
  const map = new Map();
  for (const i of base) {
    const path = String(i.path || '').trim();
    if (!path) continue;
    const key = path.toUpperCase();
    map.set(key, {
      path,
      manufacturer: i.manufacturer || '',
      serialNumber: i.serialNumber || '',
      friendlyName: i.friendlyName || i.pnpId || ''
    });
  }

  // Windows 回退：从注册表补齐可能被遗漏的虚拟口
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      execFile('reg', ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'], { windowsHide: true },
        (err, stdout) => {
          if (!err && stdout) {
            stdout.split(/\r?\n/).forEach(line => {
              const m = line.match(/REG_SZ\s+(COM\d+)/i);
              if (m) {
                const p = m[1];
                const key = p.toUpperCase();
                if (!map.has(key)) {
                  map.set(key, { path: p, manufacturer: '', serialNumber: '', friendlyName: '（系统注册表）' });
                }
              }
            });
          }
          resolve();
        });
    });
  }

  return Array.from(map.values());
}

ipcMain.handle('serial:list', async () => {
  return await listSerialPortsSafe();
});

ipcMain.handle('serial:open', async (_e, { path: p, options }) => {
  const id = getPortId(p);
  if (ports.has(id)) {
    ports.get(id).options = options;
    return { ok: true, id, alreadyOpen: true };
  }

  return await new Promise((resolve) => {
    const port = new SerialPort({
      path: p,
      baudRate: options.baudRate || 115200,
      dataBits: options.dataBits || 8,
      stopBits: options.stopBits || 1,
      parity: options.parity || 'none',
      autoOpen: false
    });

    const sendAll = (ch, payload) =>
      BrowserWindow.getAllWindows().forEach(w => w.webContents.send(ch, payload));

    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };

    port.once('open', () => {
      port.on('data', b => {
        sendAll('serial:data', { id, base64: Buffer.from(b).toString('base64'), ts: Date.now() });
        notifyScriptWatchers(id, b);
      });
      port.on('close', () => {
        sendAll('serial:event', { id, type: 'close' });
        ports.delete(id);
      });
      port.on('error', e => {
        const ent = ports.get(id);
        if (shouldSuppressPortError(ent, e)) return;
        sendAll('serial:event', { id, type: 'error', message: e?.message || String(e) });
      });

      ports.set(id, { port, options });
      sendAll('serial:event', { id, type: 'open' });
      finish({ ok: true, id });
    });

    port.once('error', (err) => {
      finish({ ok: false, error: err?.message || String(err) });
    });

    const to = setTimeout(() => {
      if (!port.isOpen) {
        try { port.close(); } catch { }
        finish({ ok: false, error: 'OPEN_TIMEOUT' });
      }
    }, 2500);

    port.open((err) => { if (err) { clearTimeout(to); finish({ ok: false, error: err.message }); } });
  });
});
ipcMain.handle('serial:close', async (_e, { id }) => {
  const entry = ports.get(id);
  if (!entry) return { ok: true, notOpen: true };

  entry.suppressErrorUntil = Date.now() + 800;

  if (entry.port && entry.port.isOpen === false) {
    ports.delete(id);
    return { ok: true, notOpen: true };
  }
  return await new Promise((resolve) => {
    entry.port.close((err) => {
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true });
    });
  });
});


ipcMain.handle('serial:write', async (_e, a) => writeToSerial(a.id, a.data, a.mode, a.append));
ipcMain.handle('file:readHex', (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return { hex: buf.toString('hex'), length: buf.length };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});
ipcMain.on('window:set-fullscreen', (_e, { flag }) => mainWindow?.setFullScreen(!!flag));
ipcMain.on('window:toggle-fullscreen', () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()));
ipcMain.on('theme:set', (_e, { dark }) => {
  if (process.platform === 'win32' && mainWindow?.setTitleBarOverlay) {
    try {
      mainWindow.setTitleBarOverlay({
        color: dark ? '#0D1218' : '#f5f7fa',
        symbolColor: dark ? '#E6E9EF' : '#1f2937',
        height: 30
      });
    } catch { }
  }
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send('theme:apply', { dark }));
});


ipcMain.handle('panel:saveLog', async (_e, { name, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ title: '保存面板数据', defaultPath: `${name || 'panel'}.txt`, filters: [{ name: '文本文件', extensions: ['txt'] }] });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(filePath, content, 'utf-8'); return { ok: true, filePath }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('panel:popout', (_e, { id, title, html }) => {
  if (!mainWindow) return { ok: false, error: 'MAIN_WINDOW_MISSING' };
  const win = new BrowserWindow({ width: 600, height: 420, alwaysOnTop: true, frame: false, resizable: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.loadFile('panel.html', { query: { id, title } });
  win.webContents.once('did-finish-load', () => win.webContents.send('panel:loadContent', { id, html }));
  win.on('focus', () => mainWindow?.webContents.send('panel:focus', { id }));
  return { ok: true };
});
ipcMain.on('panel:request-dock', (_e, { id, html }) => mainWindow?.webContents.send('panel:dock', { id, html }));

ipcMain.handle('scripts:dir', () => scriptsDir);
ipcMain.handle('scripts:list', () => { ensureScriptsDir(); return fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js')); });
ipcMain.handle('scripts:read', (_e, n) => { const f = path.join(scriptsDir, safeScriptName(n)); return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : ''; });
ipcMain.handle('scripts:write', (_e, { name, content }) => { fs.writeFileSync(path.join(scriptsDir, safeScriptName(name)), String(content ?? ''), 'utf-8'); return { ok: true }; });
ipcMain.handle('scripts:delete', (_e, n) => { const f = path.join(scriptsDir, safeScriptName(n)); if (fs.existsSync(f)) fs.unlinkSync(f); return { ok: true }; });
ipcMain.handle('scripts:run', (e, { code, ctx }) => {
  const runId = randomUUID(); const logs = []; const token = { aborted: false, timers: new Set() }; runningScripts.set(runId, token);
  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')) }, sleep: ms => new Promise((r, j) => { const t = setTimeout(() => token.aborted ? j(new Error('ABORTED')) : r(), Number(ms) || 0); token.timers.add(t); }),
    send: async (d, m = 'text', a = 'none') => { if (token.aborted) throw new Error('ABORTED'); const r = await writeToSerial(ctx.id, d, m, a); if (!r.ok) throw new Error(r.error); return r; },
    onData: h => typeof h === 'function' && addScriptWatcher(ctx.id, runId, h), shouldStop: () => token.aborted
  };
  (async () => {
    try { await new vm.Script(`(async()=>{${code || ''}})()`).runInContext(vm.createContext(sandbox)); e.sender.send('scripts:ended', { runId, ok: true, logs }); }
    catch (err) { logs.push('[ERROR] ' + (err?.message || String(err))); e.sender.send('scripts:ended', { runId, ok: false, error: err?.message, logs }); }
    finally { token.timers.forEach(clearTimeout); runningScripts.delete(runId); removeScriptWatcher(runId); }
  })();
  return { ok: true, runId };
});
ipcMain.handle('scripts:stop', (_e, { runId }) => { const t = runningScripts.get(runId); if (!t) return { ok: false, error: 'NOT_RUNNING' }; t.aborted = true; removeScriptWatcher(runId); return { ok: true }; });

// ========== 生命周期 ==========
app.whenReady().then(() => { ensureScriptsDir(); createMainWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); }); });
app.on('window-all-closed', () => { ports.forEach(({ port }) => { try { port.close(); } catch { } }); if (process.platform !== 'darwin') app.quit(); });
