// main.js
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const fs = require('fs');
const vm = require('vm');
const { dialog } = require('electron');
const { randomUUID } = require('crypto'); 
const runningScripts = new Map();
// ===== 配置文件路径 =====
const configPath = path.join(app.getPath('userData'), 'panels.json');
const commandsPath = path.join(app.getPath('userData'), 'commands.json');
const scriptsDir = path.join(app.getPath('userData'), 'scripts');

// ===== JSON 工具函数 =====
function loadJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function saveJsonSafe(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); } catch (err) { console.error('保存失败:', err); }
}

// ===== 配置文件操作 =====
function loadPanelsConfig() { return loadJsonSafe(configPath, []); }
function savePanelsConfig(panels) { saveJsonSafe(configPath, panels); }

function loadCommandsConfig() { return loadJsonSafe(commandsPath, []); }
function saveCommandsConfig(cmds) { saveJsonSafe(commandsPath, cmds); }

function ensureScriptsDir() { try { fs.mkdirSync(scriptsDir, { recursive: true }); } catch {} }

// ===== 串口管理 =====
const ports = new Map();
let mainWindow = null;
const getPortId = (portPath) => portPath;

// ===== 创建主窗口 =====
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  console.log("面板配置路径:", configPath);
  console.log("命令配置路径:", commandsPath);
  console.log("脚本目录路径:", scriptsDir);

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => {
    BrowserWindow.getAllWindows().forEach(win => { if (win !== mainWindow) win.close(); });
    mainWindow = null;
  });

  // 外部链接统一交给系统默认浏览器/邮件客户端
  const openExternalIfNeeded = (url) => {
    if (/^https?:/i.test(url) || /^mailto:/i.test(url)) {
      shell.openExternal(url);
      return true;
    }
    return false;
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalIfNeeded(url)) return { action: 'deny' };
    return { action: 'allow' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (openExternalIfNeeded(url)) event.preventDefault();
  });
}

// ===== IPC：配置文件 =====
ipcMain.handle('config:load', () => loadPanelsConfig());
ipcMain.on('config:save', (_e, panels) => savePanelsConfig(panels));

ipcMain.handle('commands:load', () => loadCommandsConfig());
ipcMain.on('commands:save', (_e, cmds) => saveCommandsConfig(cmds));

// ===== IPC：文件读取为 hex（用于发送文件） =====
ipcMain.handle('file:readHex', async (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return { hex: buf.toString('hex'), length: buf.length };
  } catch (err) {
    return { error: err.message };
  }
});

// ===== 串口 IPC =====
ipcMain.handle('panel:saveLog', async (_e, { name, content }) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '保存面板数据',
      defaultPath: `${name || 'panel'}.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

ipcMain.handle('serial:list', async () => {
  const list = await SerialPort.list();
  return list.map(item => ({
    path: item.path,
    manufacturer: item.manufacturer || '',
    serialNumber: item.serialNumber || '',
    friendlyName: item.friendlyName || item.pnpId || ''
  }));
});

ipcMain.handle('serial:open', async (_e, { path: portPath, options }) => {
  const id = getPortId(portPath);
  if (ports.has(id)) {
    const entry = ports.get(id);
    entry.options = options;
    return { ok: true, id, alreadyOpen: true };
  }

  return new Promise((resolve) => {
    const port = new SerialPort({
      path: portPath,
      baudRate: options.baudRate || 115200,
      dataBits: options.dataBits || 8,
      stopBits: options.stopBits || 1,
      parity: options.parity || 'none',
      autoOpen: true
    }, (err) => { if (err) resolve({ ok: false, error: err.message }); });

    port.on('data', (buf) => {
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('serial:data', { id, base64: buf.toString('base64'), ts: Date.now() });
      });
    });
    port.on('close', () => {
      BrowserWindow.getAllWindows().forEach(win => win.webContents.send('serial:event', { id, type: 'close' }));
      ports.delete(id);
    });
    port.on('error', (err) => {
      BrowserWindow.getAllWindows().forEach(win => win.webContents.send('serial:event', { id, type: 'error', message: err.message }));
    });

    ports.set(id, { port, options });
    resolve({ ok: true, id });
  });
});

ipcMain.handle('serial:close', async (_e, { id }) => {
  const entry = ports.get(id);
  if (!entry) return { ok: true, notOpen: true };
  return new Promise((resolve) => {
    entry.port.close((err) => {
      if (err) return resolve({ ok: false, error: err.message });
      ports.delete(id);
      resolve({ ok: true });
    });
  });
});

// ===== 串口写数据（通用函数，脚本也用它） =====
function buildWriteBuffer(data, mode, append) {
  let payload = data || '';
  if (append === 'CR') payload += '\r';
  else if (append === 'LF') payload += '\n';
  else if (append === 'CRLF') payload += '\r\n';

  if (mode === 'hex') {
    const clean = payload.replace(/[\s,]/g, '');
    if (clean.length % 2 !== 0) throw new Error('HEX长度必须为偶数');
    const bytes = clean.match(/.{1,2}/g).map(h => parseInt(h, 16));
    return Buffer.from(bytes);
  } else if (mode === 'base64') {
    return Buffer.from(payload, 'base64');
  } else {
    return Buffer.from(payload, 'utf8');
  }
}
function writeToSerial(id, data, mode='text', append='none') {
  const entry = ports.get(id);
  if (!entry) return Promise.resolve({ ok: false, error: 'PORT_NOT_OPEN' });
  let buf;
  try { buf = buildWriteBuffer(data, mode, append); }
  catch (e) { return Promise.resolve({ ok: false, error: e.message }); }
  return new Promise((resolve) => {
    entry.port.write(buf, (err) => {
      if (err) return resolve({ ok: false, error: err.message });
      resolve({ ok: true, bytes: buf.length });
    });
  });
}
ipcMain.handle('serial:write', async (_e, { id, data, mode, append }) => {
  return writeToSerial(id, data, mode, append);
});
ipcMain.handle('scripts:stop', (_e, { runId }) => {
    const token = runningScripts.get(runId);
    if (!token) return { ok: false, error: 'NOT_RUNNING' };
    token.aborted = true;  // 挂起中的 sleep 将在到点时以 ABORTED 结束
    return { ok: true };
  });
  
// ===== 面板弹出相关 =====
ipcMain.handle('panel:popout', (_e, { id, title, html }) => {
  if (!mainWindow) return { ok: false, error: 'MAIN_WINDOW_MISSING' };
  const win = new BrowserWindow({
    width: 600,
    height: 420,
    alwaysOnTop: true,
    frame: false,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('panel.html', { query: { id, title } });
  win.webContents.once('did-finish-load', () => win.webContents.send('panel:loadContent', { id, html }));
  win.on('focus', () => { if (mainWindow) mainWindow.webContents.send('panel:focus', { id }); });

  return { ok: true };
});

ipcMain.on('panel:request-dock', (_e, { id, html }) => {
  if (mainWindow) mainWindow.webContents.send('panel:dock', { id, html });
});

// ===== 脚本相关 IPC =====
function safeScriptName(name) {
  name = String(name || '').trim();
  name = name.replace(/[/\\]/g, '');
  if (!name.endsWith('.js')) name += '.js';
  return name;
}

ipcMain.handle('scripts:dir', () => scriptsDir);
ipcMain.handle('scripts:list', () => {
  ensureScriptsDir();
  return fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js'));
});
ipcMain.handle('scripts:read', (_e, name) => {
  const full = path.join(scriptsDir, safeScriptName(name));
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : '';
});
ipcMain.handle('scripts:write', (_e, { name, content }) => {
  const full = path.join(scriptsDir, safeScriptName(name));
  fs.writeFileSync(full, String(content ?? ''), 'utf-8');
  return { ok: true };
});
ipcMain.handle('scripts:delete', (_e, name) => {
  const full = path.join(scriptsDir, safeScriptName(name));
  if (fs.existsSync(full)) fs.unlinkSync(full);
  return { ok: true };
});
ipcMain.handle('scripts:run', (e, { code, ctx }) => {
    const runId = randomUUID();
    const logs = [];
  
    const token = { aborted: false, timers: new Set() };
    runningScripts.set(runId, token);
  
    const sandbox = {
      console: { log: (...args) => logs.push(args.map(String).join(' ')) },
      sleep: (ms) => new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          if (token.aborted) return reject(new Error('ABORTED'));
          resolve();
        }, Number(ms) || 0);
        token.timers.add(t);
      }),
      send: async (data, mode='text', append='none') => {
        if (token.aborted) throw new Error('ABORTED');
        const res = await writeToSerial(ctx.id, data, mode, append);
        if (!res.ok) throw new Error(res.error);
        return res;
      },
      shouldStop: () => token.aborted,
    };
  
    // 后台启动，不阻塞 IPC；结束后发事件通知渲染进程
    (async () => {
      try {
        const script = new vm.Script(`(async () => { ${code || ''} })()`);
        const context = vm.createContext(sandbox);
        await script.runInContext(context); // 注意：timeout 只限同步代码
        e.sender.send('scripts:ended', { runId, ok: true, logs });
      } catch (err) {
        logs.push('[ERROR] ' + (err?.message || String(err)));
        e.sender.send('scripts:ended', { runId, ok: false, error: err?.message, logs });
      } finally {
        token.timers.forEach(clearTimeout);
        runningScripts.delete(runId);
      }
    })();
  
    return { ok: true, runId };  // 立刻返回 runId
  });
  

// ===== 应用启动与退出 =====
app.whenReady().then(() => {
  ensureScriptsDir();
  createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});

app.on('window-all-closed', () => {
  ports.forEach(({ port }) => { try { port.close(); } catch {} });
  if (process.platform !== 'darwin') app.quit();
});
