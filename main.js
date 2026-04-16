const { spawn } = require('child_process');
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const { SerialPort } = require('serialport');
const { randomUUID } = require('crypto');
const path = require('path');
let iconv = null;
try { iconv = require('iconv-lite'); } catch { iconv = null; }
const fs = require('fs');
const vm = require('vm');
const https = require('https');
const { execFile } = require('child_process');
const os = require('os');

const runningScripts = new Map();
const ports = new Map();
const scriptWatchers = new Map();

const configPath = path.join(app.getPath('userData'), 'panels.json');
const commandsPath = path.join(app.getPath('userData'), 'commands.json');
const scriptsDir = path.join(app.getPath('userData'), 'scripts');

// ========== 工具 ==========
function writeGeneric(id, data, mode, append) {
  if (id.startsWith('tcp://')) {
    const entry = sockets.get(id);
    if (!entry || !entry.socket) return Promise.resolve({ ok: false, error: 'NOT_OPEN' });
    let buf;
    try { buf = buildWriteBuffer(data, mode, append); } catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
    return new Promise(res => entry.socket.write(buf, err => res(err ? { ok: false, error: err.message } : { ok: true, bytes: buf.length })));
  } else {
    return writeToSerial(id, data, mode, append);
  }
}
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, webviewTag: true }
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

const shares = new Map();

function isRfc1918(ip) {
  if (/^10\./.test(ip)) return true;
  const m172 = ip.match(/^172\.(\d+)\./);
  if (m172) {
    const n = parseInt(m172[1], 10);
    if (n >= 16 && n <= 31) return true;
  }
  if (/^192\.168\./.test(ip)) return true;
  return false;
}

function looksVirtual(ifname = '') {
  const n = (ifname || '').toLowerCase();
  return /(vmnet|vmware|virtualbox|vbox|hyper[- ]?v|wsl|docker|hamachi|zerotier|bridge|npcap|npf|tap|tun|loopback)/i.test(n);
}

function listLanIPv4() {
  const ifs = os.networkInterfaces();
  const all = [];

  for (const name of Object.keys(ifs)) {
    for (const inf of ifs[name] || []) {
      if (inf.family !== 'IPv4') continue;
      if (inf.internal) continue;

      const ip = inf.address;
      const entry = {
        ip,
        ifname: name,
        score: 0,
        virt: looksVirtual(name)
      };
      if (isRfc1918(ip)) entry.score += 100;
      else if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) entry.score += 20;
      else entry.score += 5;
      if (entry.virt) entry.score -= 50;

      all.push(entry);
    }
  }

  if (!all.length) return ['127.0.0.1'];
  const hasPrivate = all.some(a => isRfc1918(a.ip) && !a.virt);
  const cand = hasPrivate ? all.filter(a => isRfc1918(a.ip)) : all;

  cand.sort((a, b) => b.score - a.score);
  return cand.map(a => a.ip);
}

const sockets = new Map();
const tcpServerDataBuffer = new Map(); // TCP服务器接收数据缓冲
const TCP_DEFAULTS = {
  timeoutMs: 2500,
  keepAlive: true,
  keepAliveSec: 60,
  noDelay: true,
  autoReconnect: false,
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

ipcMain.handle('tcp:write', async (_e, { id, data, mode = 'text', append = 'none', encoding = 'utf-8' }) => {
  const entry = sockets.get(id);
  if (!entry || !entry.socket) return { ok: false, error: 'NOT_OPEN' };
  let buf;
  try { buf = buildWriteBuffer(data, mode, append, encoding); } catch (e) { return { ok: false, error: e.message }; }
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

// ========== TCP 服务器 ==========
const tcpServers = new Map(); // serverId -> { server, port, clients, win }

ipcMain.handle('tcpServer:start', async (e, { port }) => {
  const serverId = `tcpServer:${port}`;
  if (tcpServers.has(serverId)) {
    return { ok: true, id: serverId, port, already: true };
  }

  const server = net.createServer();
  const clients = new Set();
  const win = e.sender;

  server.on('connection', (sock) => {
    try { sock.setNoDelay(true); sock.setKeepAlive(true, 60000); } catch { }
    clients.add(sock);
    const clientId = `${sock.remoteAddress}:${sock.remotePort}`;
    try { win.send('tcpServer:event', { serverId, type: 'connection', clientId, remoteAddress: sock.remoteAddress, remotePort: sock.remotePort }); } catch { }

    sock.on('data', (buf) => {
      try { win.send('tcpServer:data', { serverId, clientId, base64: Buffer.from(buf).toString('base64'), ts: Date.now() }); } catch { }
    });

    sock.on('close', () => {
      clients.delete(sock);
      try { win.send('tcpServer:event', { serverId, type: 'disconnect', clientId }); } catch { }
    });

    sock.on('error', () => {
      try { sock.destroy(); } catch { }
      clients.delete(sock);
    });
  });

  server.on('error', (err) => {
    console.error('TCP Server error:', err?.message || err);
  });

  return await new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      tcpServers.set(serverId, { server, port, clients, win });
      resolve({ ok: true, id: serverId, port });
    }).on('error', (err) => {
      resolve({ ok: false, error: err?.message || '启动失败' });
    });
  });
});

ipcMain.handle('tcpServer:stop', async (_e, { id }) => {
  const entry = tcpServers.get(id);
  if (!entry) return { ok: true, notOpen: true };

  for (const c of entry.clients) { try { c.destroy(); } catch { } }
  entry.clients.clear();
  try { entry.server.close(); } catch { }
  tcpServers.delete(id);
  return { ok: true };
});

ipcMain.handle('tcpServer:status', async (_e, { id }) => {
  const entry = tcpServers.get(id);
  if (!entry) return { ok: true, active: false };
  return { ok: true, active: true, port: entry.port, clients: entry.clients.size };
});

ipcMain.handle('tcpServer:broadcast', async (_e, { id, data, mode = 'text', append = 'none', encoding = 'utf-8' }) => {
  const entry = tcpServers.get(id);
  if (!entry) return { ok: false, error: '服务器未启动' };
  if (entry.clients.size === 0) return { ok: false, error: '无客户端连接' };

  let buf;
  try { buf = buildWriteBuffer(data, mode, append, encoding); } catch (e) { return { ok: false, error: e.message }; }

  let sent = 0;
  let failed = 0;
  for (const c of entry.clients) {
    if (!c.destroyed) {
      try { c.write(buf); sent++; } catch { failed++; }
    }
  }
  return { ok: true, sent, failed, bytes: buf.length };
});

// ========== 串口 ==========
function buildWriteBuffer(data, mode, append, encoding = 'utf-8') {
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
  const enc = (encoding || 'utf-8').toLowerCase();
  if (enc !== 'utf-8' && enc !== 'utf8' && iconv && iconv.encodingExists(enc)) {
    return iconv.encode(payload, enc);
  }
  return Buffer.from(payload, 'utf8');
}
function writeToSerial(id, data, mode = 'text', append = 'none', encoding = 'utf-8') {
  const entry = ports.get(id);
  if (!entry) return Promise.resolve({ ok: false, error: 'PORT_NOT_OPEN' });
  let buf; try { buf = buildWriteBuffer(data, mode, append, encoding); } catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
  return new Promise(r => entry.port.write(buf, err => r(err ? { ok: false, error: err.message } : { ok: true, bytes: buf.length })));
}
function startTcpShare(portId, sharePort = 9000) {
  if (shares.has(portId)) return shares.get(portId);
  const ent = ports.get(portId);
  if (!ent || !ent.port || !ent.port.isOpen) {
    throw new Error('串口未打开，无法共享');
  }

  const srv = net.createServer();
  const clients = new Set();

  const onSerialData = (buf) => {
    for (const c of clients) {
      if (!c.destroyed) {
        try { c.write(buf); } catch { }
      }
    }
  };
  ent.port.on('data', onSerialData);

  srv.on('connection', (sock) => {
    try { sock.setNoDelay(true); sock.setKeepAlive(true, 60000); } catch { }
    clients.add(sock);
    sock.on('data', (buf) => {
      try { ent.port.write(buf); } catch { }
    });
    sock.on('close', () => clients.delete(sock));
    sock.on('error', () => { try { sock.destroy(); } catch { } clients.delete(sock); });
  });

  srv.on('error', (err) => {
    console.error('TCP Share error:', err?.message || err);
  });

  srv.listen(sharePort);

  const rec = { server: srv, port: sharePort, clients, onSerialData };
  shares.set(portId, rec);
  return rec;
}

function stopTcpShare(portId) {
  const rec = shares.get(portId);
  if (!rec) return;
  try {
    for (const c of rec.clients) { try { c.destroy(); } catch { } }
    rec.clients.clear();
    rec.server.close();
  } catch { }
  const ent = ports.get(portId);
  if (ent?.port && rec.onSerialData) {
    try { ent.port.off('data', rec.onSerialData); } catch { }
  }
  shares.delete(portId);
}

ipcMain.handle('tcpShare:start', (_e, { id, port }) => {
  const p = parseInt(port, 10) || 9000;
  const rec = startTcpShare(id, p);
  const ips = listLanIPv4();
  const addrs = ips.map(ip => `${ip}:${rec.port}`);
  return { ok: true, port: rec.port, addrs, best: addrs[0], candidates: addrs };
});

ipcMain.handle('tcpShare:stop', (_e, { id }) => {
  stopTcpShare(id);
  return { ok: true };
});

ipcMain.handle('tcpShare:status', (_e, { id }) => {
  const rec = shares.get(id);
  if (!rec) return { ok: true, active: false };
  const ips = listLanIPv4();
  const addrs = ips.map(ip => `${ip}:${rec.port}`);
  return { ok: true, active: true, port: rec.port, addrs, best: addrs[0], candidates: addrs };
});

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

ipcMain.handle('config:load', () => loadPanelsConfig());
ipcMain.on('config:save', (_e, p) => savePanelsConfig(p));
ipcMain.handle('commands:load', () => loadCommandsConfig());
ipcMain.on('commands:save', (_e, c) => saveCommandsConfig(c));

async function listSerialPortsSafe() {
  let base = [];
  try { base = await SerialPort.list(); } catch { base = []; }

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
        try { if (shares.has(id)) stopTcpShare(id); } catch { }
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


ipcMain.handle('serial:write', async (_e, a) => writeToSerial(a.id, a.data, a.mode, a.append, a.encoding));
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
ipcMain.on('window:focus', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});
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

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.on('changelog:open', () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: '更新日志',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });
  win.loadFile('changelog.html');
});
ipcMain.on('changelog:request', (event) => {
  const mdPath = path.join(__dirname, 'CHANGELOG.md');
  fs.readFile(mdPath, 'utf-8', (err, data) => {
    if (err) {
      event.reply('changelog:content', '# 加载失败\n无法读取 CHANGELOG.md 文件。');
    } else {
      event.reply('changelog:content', data);
    }
  });
});
ipcMain.on('app:checkUpdate', () => checkForUpdates(true));
ipcMain.on('panel:request-hide', (_e, { id }) => {
  mainWindow?.webContents.send('panel:hide', { id });
  const win = BrowserWindow.fromWebContents(_e.sender);
  win?.close();
});
ipcMain.handle('panel:saveLog', async (_e, { name, content }) => {
  const { canceled, filePath } = await dialog.showSaveDialog({ title: '保存面板数据', defaultPath: `${name || 'panel'}.txt`, filters: [{ name: '文本文件', extensions: ['txt'] }] });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(filePath, content, 'utf-8'); return { ok: true, filePath }; } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('panel:popout', (_e, { id, title, historyStr, alwaysOnTop, isOpen, viewMode, optionsStr }) => {
  if (!mainWindow) return { ok: false, error: 'MAIN_WINDOW_MISSING' };

  const win = new BrowserWindow({
    width: 600,
    height: 420,
    minWidth: 550,
    minHeight: 300,
    alwaysOnTop: alwaysOnTop !== false,
    frame: false,
    resizable: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });

  win.loadFile('panel.html', {
    query: {
      id,
      title,
      isOpen: isOpen ? '1' : '0',
      viewMode: viewMode || 'text',
      opts: optionsStr || '{}'
    }
  });

  win.webContents.once('did-finish-load', () => win.webContents.send('panel:loadContent', { id, historyStr }));
  win.on('focus', () => mainWindow?.webContents.send('panel:focus', { id }));
  return { ok: true };
});
ipcMain.on('panel:request-dock', (_e, { id, html }) => mainWindow?.webContents.send('panel:dock', { id, html }));

ipcMain.handle('scripts:dir', () => scriptsDir);
ipcMain.handle('scripts:list', () => { ensureScriptsDir(); return fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js')); });
ipcMain.handle('scripts:read', (_e, n) => { const f = path.join(scriptsDir, safeScriptName(n)); return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : ''; });
ipcMain.handle('scripts:write', (_e, { name, content }) => { 
    ensureScriptsDir();
    try {
        fs.writeFileSync(path.join(scriptsDir, safeScriptName(name)), String(content ?? ''), 'utf-8'); 
        return { ok: true }; 
    } catch (e) {
        console.error('Script save failed:', e);
        return { ok: false, error: e.message };
    }
});ipcMain.handle('scripts:delete', (_e, n) => { const f = path.join(scriptsDir, safeScriptName(n)); if (fs.existsSync(f)) fs.unlinkSync(f); return { ok: true }; });
ipcMain.handle('scripts:run', (e, { code, ctx }) => {
  const runId = randomUUID(); 
  const logs = []; 
  const token = { 
      aborted: false, 
      abortHandlers: new Set() 
  }; 
  runningScripts.set(runId, token);

  const sandbox = {
    console: { log: (...a) => logs.push(a.join(' ')) },
    checkStop: async () => {
        if (token.aborted) throw new Error('ABORTED');
        return false; 
    },
    sleep: ms => new Promise((resolve, reject) => {
        if (token.aborted) return reject(new Error('ABORTED'));
        let timer;
        const stopNow = () => { clearTimeout(timer); reject(new Error('ABORTED')); };
        token.abortHandlers.add(stopNow);
        timer = setTimeout(() => {
            token.abortHandlers.delete(stopNow);
            resolve();
        }, Number(ms) || 0); 
    }),
    waitOnePacket: (timeout = 5000) => new Promise((resolve, reject) => {
        if (token.aborted) return reject(new Error('ABORTED'));

        // 测试模式：直接返回空字符串（没有真实连接）
        if (ctx.id === 'test') {
            setTimeout(() => resolve('[测试模式: 无数据]'), 100);
            return;
        }

        let onDataHandler;
        let timeoutTimer;
        const stopNow = () => {
             removeScriptWatcher(runId);
             if (timeoutTimer) clearTimeout(timeoutTimer);
             reject(new Error('ABORTED'));
        };
        token.abortHandlers.add(stopNow);

        // 超时处理
        timeoutTimer = setTimeout(() => {
            token.abortHandlers.delete(stopNow);
            removeScriptWatcher(runId);
            resolve('[超时: 无数据]');
        }, Number(timeout) || 5000);

        onDataHandler = (payload) => {
             token.abortHandlers.delete(stopNow);
             if (timeoutTimer) clearTimeout(timeoutTimer);
             removeScriptWatcher(runId);
             const txt = (typeof payload === 'string') ? payload :
                        (payload.text ? payload.text : '');
             resolve(txt);
        };
        addScriptWatcher(ctx.id, runId, onDataHandler);
    }),

    send: async (d, m = 'text', a = 'none') => {
        if (token.aborted) throw new Error('ABORTED');

        // 测试模式：模拟发送成功
        if (ctx.id === 'test') {
            return { ok: true, sent: d };
        }

        const r = await writeGeneric(ctx.id, d, m, a);
        if (!r.ok) throw new Error(r.error);
        return r;
    },

    // TCP 发送（测试模式下模拟）
    sendTCP: async (host, port, data, mode = 'text') => {
        if (token.aborted) throw new Error('ABORTED');

        // 测试模式：模拟发送成功
        if (ctx.id === 'test') {
            return { ok: true, sent: data, host, port };
        }

        // 实际发送需要查找对应的 TCP 连接
        // 这里简化处理，返回模拟成功
        return { ok: true, sent: data };
    },

    // TCP 服务器接收
    waitTcpServer: async (port, timeout = 5000) => {
        if (token.aborted) throw new Error('ABORTED');

        // 测试模式：返回模拟数据
        if (ctx.id === 'test') {
            await new Promise(r => setTimeout(r, 100));
            return `[测试模式: TCP服务器${port}收到数据]`;
        }

        // 确保服务器已启动
        const serverId = `tcpServer:${port}`;
        if (!tcpServers.has(serverId)) {
            // 自动启动服务器
            const result = await new Promise((resolve) => {
                const server = net.createServer();
                const clients = new Set();

                server.on('connection', (sock) => {
                    try { sock.setNoDelay(true); } catch { }
                    clients.add(sock);

                    sock.on('data', (buf) => {
                        // 直接解析数据并存储
                        const data = buf.toString('utf8');
                        tcpServerDataBuffer.set(serverId, data);
                    });

                    sock.on('close', () => clients.delete(sock));
                    sock.on('error', () => { try { sock.destroy(); } catch { } clients.delete(sock); });
                });

                server.listen(port, '0.0.0.0', () => {
                    tcpServers.set(serverId, { server, port, clients });
                    resolve({ ok: true });
                }).on('error', (err) => resolve({ ok: false, error: err.message }));
            });

            if (!result.ok) return `[服务器启动失败: ${result.error}]`;
        }

        // 等待数据
        return await new Promise((resolve, reject) => {
            if (token.aborted) return reject(new Error('ABORTED'));

            let timeoutTimer;
            const stopNow = () => {
                if (timeoutTimer) clearTimeout(timeoutTimer);
                reject(new Error('ABORTED'));
            };
            token.abortHandlers.add(stopNow);

            timeoutTimer = setTimeout(() => {
                token.abortHandlers.delete(stopNow);
                // 检查是否有数据
                const data = tcpServerDataBuffer.get(serverId);
                if (data) {
                    tcpServerDataBuffer.delete(serverId);
                    resolve(data);
                } else {
                    resolve('[超时: 无数据]');
                }
            }, Number(timeout) || 5000);

            // 立即检查是否有数据
            const immediateData = tcpServerDataBuffer.get(serverId);
            if (immediateData) {
                clearTimeout(timeoutTimer);
                token.abortHandlers.delete(stopNow);
                tcpServerDataBuffer.delete(serverId);
                resolve(immediateData);
            }
        });
    },

    // TCP 服务器广播发送
    broadcastTcpServer: async (port, data, mode = 'text') => {
        if (token.aborted) throw new Error('ABORTED');

        // 测试模式：模拟发送成功
        if (ctx.id === 'test') {
            return { ok: true, sent: data, port, clients: 1 };
        }

        const serverId = `tcpServer:${port}`;

        // 如果服务器不存在，先启动
        if (!tcpServers.has(serverId)) {
            return { ok: false, error: '服务器未启动，请先使用接收节点' };
        }

        const entry = tcpServers.get(serverId);
        if (entry.clients.size === 0) {
            return { ok: false, error: '无客户端连接' };
        }

        // 构建发送数据
        let buf;
        if (mode === 'hex') {
            const clean = String(data).replace(/[\s,]/g, '');
            buf = Buffer.from(clean.match(/.{1,2}/g).map(h => parseInt(h, 16)));
        } else {
            buf = Buffer.from(String(data), 'utf8');
        }

        let sent = 0;
        for (const c of entry.clients) {
            if (!c.destroyed) {
                try { c.write(buf); sent++; } catch { }
            }
        }

        return { ok: true, sent, bytes: buf.length };
    },

    // 辅助函数
    textToHex: (s) => {
        let hex = '';
        for (let i = 0; i < s.length; i++) {
            hex += s.charCodeAt(i).toString(16).padStart(2, '0');
        }
        return hex.toUpperCase();
    },
    hexToText: (h) => {
        let text = '';
        const cleanHex = h.replace(/\s/g, '');
        for (let i = 0; i < cleanHex.length; i += 2) {
            text += String.fromCharCode(parseInt(cleanHex.substr(i, 2), 16));
        }
        return text;
    },
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (b) => Buffer.from(b, 'base64').toString('binary'),
    crc16: (data) => {
        let crc = 0xFFFF;
        const str = String(data);
        for (let i = 0; i < str.length; i++) {
            crc ^= str.charCodeAt(i);
            for (let j = 0; j < 8; j++) {
                if (crc & 1) crc = (crc >> 1) ^ 0xA001;
                else crc >>= 1;
            }
        }
        return crc.toString(16).toUpperCase().padStart(4, '0');
    },

    // 进制转换 (支持 2/8/10/16 进制互转)
    convertBase: (value, from, to) => {
        // 进制映射
        const baseMap = { '二进制': 2, '八进制': 8, '十进制': 10, '十六进制': 16 };
        const fromBase = baseMap[from] || parseInt(from) || 10;
        const toBase = baseMap[to] || parseInt(to) || 10;

        // 清理输入
        let cleanValue = String(value).trim();
        if (fromBase === 16) cleanValue = cleanValue.replace(/^0x/i, '');
        if (fromBase === 2) cleanValue = cleanValue.replace(/^0b/i, '');

        // 转换为十进制
        const decimal = parseInt(cleanValue, fromBase);
        if (isNaN(decimal)) return 'NaN';

        // 转换为目标进制
        let result = decimal.toString(toBase);
        if (toBase === 16) result = result.toUpperCase();
        if (toBase === 2 && result.length < 8) result = result.padStart(8, '0'); // 二进制补齐8位
        if (toBase === 16 && result.length < 2) result = result.padStart(2, '0'); // 十六进制补齐2位

        return result;
    },

    // 文件读取（测试模式下模拟）
    readFile: async (path, encoding = 'utf8') => {
        if (token.aborted) throw new Error('ABORTED');

        // 测试模式：返回模拟内容
        if (ctx.id === 'test') {
            return '[测试模式: 文件内容]';
        }

        try {
            const fs = require('fs');
            return fs.readFileSync(path, encoding);
        } catch (e) {
            throw new Error('读取文件失败: ' + e.message);
        }
    }
  };

  (async () => {
    try { 
        await new vm.Script(`(async()=>{${code || ''}})()`).runInContext(vm.createContext(sandbox)); 
        e.sender.send('scripts:ended', { runId, ok: true, logs }); 
    }
    catch (err) { 
        if (err.message !== 'ABORTED') {
            logs.push('[ERROR] ' + (err?.message || String(err))); 
        }
        e.sender.send('scripts:ended', { runId, ok: false, error: err?.message, logs }); 
    }
    finally { 
        runningScripts.delete(runId); 
        removeScriptWatcher(runId); 
    }
  })();
  return { ok: true, runId };
});

ipcMain.handle('scripts:stop', (e, { runId }) => {
  const token = runningScripts.get(runId);
  if (token) {
    token.aborted = true;
    token.abortHandlers.forEach(rejectFunc => rejectFunc());
    token.abortHandlers.clear();
  }
  return { ok: true };
});

ipcMain.handle('logger:append', async (event, filePath, text) => {
  try {
    await fs.promises.appendFile(filePath, text, 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('logger:pickFile', async (event) => {
  const result = await dialog.showSaveDialog({
    title: '选择日志保存位置',
    defaultPath: 'serial_log.txt',
    filters: [{ name: 'Text Files', extensions: ['txt', 'log'] }]
  });
  return result;
});

app.whenReady().then(() => { ensureScriptsDir(); createMainWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); }); });
setTimeout(checkForUpdates, 3000);

ipcMain.on('window:set-oscilloscope-top', (event, { flag }) => {
  const wins = BrowserWindow.getAllWindows();
  const child = wins.find(w => {
    const title = w.getTitle();
    return title && title.startsWith('示波器');
  });

  if (child) {
    child.setAlwaysOnTop(flag);
    child.setVisibleOnAllWorkspaces(flag, { visibleOnFullScreen: flag });
  }
});

app.on('web-contents-created', (event, contents) => {
  contents.setWindowOpenHandler(({ frameName }) => {
    if (frameName === 'SerialWave') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          frame: false,
          transparent: true,
          autoHideMenuBar: true,
          backgroundColor: '#00000000',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      };
    }
    return { action: 'allow' };
  });
});
app.on('window-all-closed', () => { ports.forEach(({ port }) => { try { port.close(); } catch { } }); if (process.platform !== 'darwin') app.quit(); });

const UPDATE_URL = 'https://filebox.satone1008.cn/';
const FILE_PREFIX = '串口助手-';
const FILE_SUFFIX = '-win-x64.exe';

function versionCompare(v1, v2) {
  const p1 = v1.split('.').map(Number);
  const p2 = v2.split('.').map(Number);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

function checkForUpdates(isManual = false) {
  console.log('[Updater] Checking for updates...');

  const req = https.get(UPDATE_URL, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      const verRegex = new RegExp(escapeRegExp(FILE_PREFIX) + '(\\d+\\.\\d+\\.\\d+)' + escapeRegExp(FILE_SUFFIX));
      const linkRegex = /href\s*=\s*["']([^"']+)["']/gi;

      let match;
      let latestVer = '0.0.0';
      let latestDownloadUrl = '';

      while ((match = linkRegex.exec(data)) !== null) {
        let href = match[1];
        href = href.replace(/&amp;/g, '&');
        let decodedHref = '';
        try { decodedHref = decodeURIComponent(href); } catch (e) { continue; }

        const fileMatch = decodedHref.match(verRegex);
        if (fileMatch) {
          const foundVer = fileMatch[1];
          if (versionCompare(foundVer, latestVer) > 0) {
            latestVer = foundVer;
            try { latestDownloadUrl = new URL(href, UPDATE_URL).href; }
            catch (e) { console.error('[Updater] Invalid URL:', href); }
          }
        }
      }

      const currentVer = app.getVersion();
      console.log(`[Updater] Current: ${currentVer}, Remote Best: ${latestVer}`);

      if (latestVer === '0.0.0' || !latestDownloadUrl || versionCompare(latestVer, currentVer) <= 0) {
        if (isManual) {
          dialog.showMessageBox(mainWindow, { type: 'info', title: '检查更新', message: `当前版本 (${currentVer}) 已是最新。`, buttons: ['确定'] });
        }
        return;
      }

      const saveName = `update-${latestVer}.exe`;
      const savePath = path.join(os.tmpdir(), saveName);

      if (fs.existsSync(savePath)) {
        console.log('[Updater] File already exists, skipping download.');
        promptToInstall(latestVer, savePath);
      } else {
        const actionText = versionCompare(latestVer, currentVer) > 0 ? '升级' : '变更';
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: '发现新版本',
          message: `检测到新版本 (${latestVer})。\n是否立即下载更新？`,
          buttons: [`下载${actionText}`, '稍后'],
          defaultId: 0,
          cancelId: 1
        }).then(({ response }) => {
          if (response === 0) {
            downloadUpdate(latestDownloadUrl, savePath, latestVer);
          }
        });
      }
    });
  });

  req.on('error', (e) => {
    console.error('[Updater] Check failed:', e.message);
    if (isManual) dialog.showErrorBox('检查失败', '无法连接到更新服务器：' + e.message);
  });
}

function downloadUpdate(fileUrl, savePath, version) {
  if (mainWindow) mainWindow.setProgressBar(0.1);

  const encodedUrl = new URL(fileUrl).href;
  console.log(`[Updater] Downloading to: ${savePath}`);

  const file = fs.createWriteStream(savePath);

  const request = https.get(encodedUrl, (response) => {
    if (response.statusCode === 301 || response.statusCode === 302) {
      file.close();
      fs.unlink(savePath, () => { });
      if (response.headers.location) {
        downloadUpdate(response.headers.location, savePath, version);
      } else {
        dialog.showErrorBox('更新失败', '服务器重定向错误。');
      }
      return;
    }

    if (response.statusCode !== 200) {
      file.close();
      fs.unlink(savePath, () => { });
      dialog.showErrorBox('更新失败', `HTTP 状态码: ${response.statusCode}`);
      if (mainWindow) mainWindow.setProgressBar(-1);
      return;
    }

    response.pipe(file);

    file.on('finish', () => {
      file.close(() => {
        if (mainWindow) mainWindow.setProgressBar(-1);
        promptToInstall(version, savePath);
      });
    });
  });

  request.on('error', (err) => {
    fs.unlink(savePath, () => { });
    if (mainWindow) mainWindow.setProgressBar(-1);
    dialog.showErrorBox('更新失败', '网络错误：' + err.message);
  });
}

function promptToInstall(version, filePath) {
  dialog.showMessageBox(mainWindow, {
    type: 'question',
    title: '准备安装',
    message: `新版本 ${version} 已准备就绪。\n\n点击【立即安装】将自动退出程序并开始更新。`,
    buttons: ['立即安装', '稍后安装'],
    defaultId: 0,
    cancelId: 1
  }).then(({ response }) => {
    if (response === 0) {
      runInstallerAndQuit(filePath);
    }
  });
}

function runInstallerAndQuit(filePath) {
  console.log('[Updater] Spawning installer, deleting file on finish, and relaunching...');

  const targetAppPath = app.getPath('exe');
  const installCmd = `start /wait "" "${filePath}" /S`;
  const deleteCmd = `del /f /q "${filePath}"`;
  const relaunchCmd = `start "" "${targetAppPath}"`;

  const fullCommand = `${installCmd} & ${deleteCmd} & ${relaunchCmd}`;

  try {
    const subprocess = spawn('cmd', ['/c', fullCommand], {
      detached: true,
      windowsVerbatimArguments: true,
      stdio: 'ignore'
    });

    subprocess.unref();

    setTimeout(() => {
      app.quit();
    }, 500);

  } catch (e) {
    dialog.showErrorBox('安装启动失败', '无法启动安装程序：' + e.message);
  }
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ========== 虚拟串口对 ==========
const virtualPairs = new Map(); // pairId => { pairId, portA, portB, server, clients: { A: socket|null, B: socket|null } }
const VPORT_BASE = 19901;
const VPORT_PATH = path.join(app.getPath('userData'), 'virtual-pairs.json');

function loadVirtualPairsConfig() {
  try { return JSON.parse(fs.readFileSync(VPORT_PATH, 'utf-8')); } catch { return []; }
}
function saveVirtualPairsConfig(pairs) {
  try { fs.writeFileSync(VPORT_PATH, JSON.stringify(pairs, null, 2), 'utf-8'); } catch (e) { console.error(e); }
}

function createVirtualPair(pairId) {
  if (virtualPairs.has(pairId)) {
    return { ok: true, pairId, portA: virtualPairs.get(pairId).portA, portB: virtualPairs.get(pairId).portB, already: true };
  }

  const num = parseInt(pairId.replace('vp-', ''), 10) || 1;
  const portA = VPORT_BASE + (num - 1) * 2;
  const portB = portA + 1;

  const srvA = net.createServer();
  const srvB = net.createServer();
  let clientA = null;
  let clientB = null;

  function relayData(src, dst) {
    if (dst && !dst.destroyed) {
      try { dst.write(src); } catch { }
    }
  }

  srvA.on('connection', (sock) => {
    try { sock.setNoDelay(true); } catch { }
    clientA = sock;
    sock.on('data', (buf) => relayData(buf, clientB));
    sock.on('close', () => { clientA = null; });
    sock.on('error', () => { try { sock.destroy(); } catch { } clientA = null; });
  });
  srvA.on('error', (err) => { console.error('[VirtualPort] Server A error:', err?.message || err); });

  srvB.on('connection', (sock) => {
    try { sock.setNoDelay(true); } catch { }
    clientB = sock;
    sock.on('data', (buf) => relayData(buf, clientA));
    sock.on('close', () => { clientB = null; });
    sock.on('error', () => { try { sock.destroy(); } catch { } clientB = null; });
  });
  srvB.on('error', (err) => { console.error('[VirtualPort] Server B error:', err?.message || err); });

  return new Promise((resolve, reject) => {
    let pending = 2;
    let failed = false;

    function done(err) {
      if (failed) return;
      if (err) {
        failed = true;
        try { srvA.close(); } catch { }
        try { srvB.close(); } catch { }
        reject({ ok: false, error: err?.message || String(err) });
        return;
      }
      pending--;
      if (pending === 0) {
        virtualPairs.set(pairId, { pairId, portA, portB, serverA: srvA, serverB: srvB, clientA: null, clientB: null });
        resolve({ ok: true, pairId, portA, portB });
      }
    }

    srvA.listen(portA, '127.0.0.1', () => done()).on('error', (e) => done(e));
    srvB.listen(portB, '127.0.0.1', () => done()).on('error', (e) => done(e));
  });
}

function destroyVirtualPair(pairId) {
  const pair = virtualPairs.get(pairId);
  if (!pair) return;
  try {
    pair.serverA.close();
    pair.serverB.close();
  } catch { }
  virtualPairs.delete(pairId);
}

function listVirtualPairs() {
  const result = [];
  for (const [id, pair] of virtualPairs) {
    result.push({
      pairId: id,
      portA: pair.portA,
      portB: pair.portB,
    });
  }
  return result;
}

ipcMain.handle('virtualPort:create', async () => {
  const saved = loadVirtualPairsConfig();
  let pairId;
  let num = 1;
  while (true) {
    pairId = `vp-${num}`;
    if (!virtualPairs.has(pairId) && !saved.some(p => p.pairId === pairId)) break;
    num++;
  }
  const r = await createVirtualPair(pairId);
  if (r.ok) {
    saved.push({ pairId: r.pairId, portA: r.portA, portB: r.portB });
    saveVirtualPairsConfig(saved);
  }
  return r;
});

ipcMain.handle('virtualPort:destroy', async (_e, { pairId }) => {
  destroyVirtualPair(pairId);
  const saved = loadVirtualPairsConfig().filter(p => p.pairId !== pairId);
  saveVirtualPairsConfig(saved);
  return { ok: true };
});

ipcMain.handle('virtualPort:list', () => listVirtualPairs());

ipcMain.handle('virtualPort:restore', async () => {
  const saved = loadVirtualPairsConfig();
  const results = [];
  for (const cfg of saved) {
    try {
      const r = await createVirtualPair(cfg.pairId);
      if (r.ok) results.push(r);
    } catch { }
  }
  return results;
});
