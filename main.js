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
function loadJsonSafe(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function saveJsonSafe(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) { console.error(e); }
}
function ensureScriptsDir() { try { fs.mkdirSync(scriptsDir, { recursive: true }); } catch {} }
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
  const payload = { bytes: Uint8Array.from(buf), text: (()=>{ try{return buf.toString('utf8')}catch{return''} })() };
  for (const fn of m.values()) try { fn(payload); } catch {}
}

// ========== IPC ==========
ipcMain.handle('config:load', () => loadPanelsConfig());
ipcMain.on('config:save', (_e, p) => savePanelsConfig(p));
ipcMain.handle('commands:load', () => loadCommandsConfig());
ipcMain.on('commands:save', (_e, c) => saveCommandsConfig(c));

ipcMain.handle('serial:list', async () => (await SerialPort.list()).map(i => ({
  path: i.path, manufacturer: i.manufacturer || '', serialNumber: i.serialNumber || '', friendlyName: i.friendlyName || i.pnpId || ''
})));
ipcMain.handle('serial:open', async (_e, { path: p, options }) => {
  const id = getPortId(p); if (ports.has(id)) { ports.get(id).options = options; return { ok: true, id, alreadyOpen: true }; }
  return new Promise(res => {
    const port = new SerialPort({ path: p, baudRate: options.baudRate||115200, dataBits: options.dataBits||8, stopBits: options.stopBits||1, parity: options.parity||'none' }, err => { if (err) res({ ok: false, error: err.message }); });
    port.on('data', b => { BrowserWindow.getAllWindows().forEach(w => w.webContents.send('serial:data',{id,base64:b.toString('base64'),ts:Date.now()})); notifyScriptWatchers(id,b); });
    port.on('close',()=>{ BrowserWindow.getAllWindows().forEach(w=>w.webContents.send('serial:event',{id,type:'close'})); ports.delete(id); });
    port.on('error',e=>BrowserWindow.getAllWindows().forEach(w=>w.webContents.send('serial:event',{id,type:'error',message:e.message})));
    ports.set(id,{port,options}); res({ok:true,id});
  });
});
ipcMain.handle('serial:close', async (_e,{id})=>{
  const e=ports.get(id); if(!e) return {ok:true,notOpen:true};
  return new Promise(r=>e.port.close(err=>{ if(err) return r({ok:false,error:err.message}); ports.delete(id); r({ok:true}); }));
});
ipcMain.handle('serial:write', async (_e,a)=>writeToSerial(a.id,a.data,a.mode,a.append));
ipcMain.handle('file:readHex', (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return { hex: buf.toString('hex'), length: buf.length };
  } catch (err) {
    return { error: err.message || String(err) };
  }
});
ipcMain.on('window:set-fullscreen',(_e,{flag})=>mainWindow?.setFullScreen(!!flag));
ipcMain.on('window:toggle-fullscreen',()=>mainWindow?.setFullScreen(!mainWindow.isFullScreen()));
ipcMain.on('theme:set',(_e,{dark})=>{
  if(process.platform==='win32'&&mainWindow?.setTitleBarOverlay)try{mainWindow.setTitleBarOverlay({color:dark?'#0D1218':'#f5f7fa',symbolColor:dark?'#E6E9EF':'#1f2937',height:30})}catch{}
});

ipcMain.handle('panel:saveLog',async(_e,{name,content})=>{
  const {canceled,filePath}=await dialog.showSaveDialog({title:'保存面板数据',defaultPath:`${name||'panel'}.txt`,filters:[{name:'文本文件',extensions:['txt']}]});
  if(canceled||!filePath) return {ok:false,canceled:true};
  try{fs.writeFileSync(filePath,content,'utf-8'); return {ok:true,filePath};}catch(e){return{ok:false,error:e.message};}
});
ipcMain.handle('panel:popout',(_e,{id,title,html})=>{
  if(!mainWindow) return {ok:false,error:'MAIN_WINDOW_MISSING'};
  const win=new BrowserWindow({width:600,height:420,alwaysOnTop:true,frame:false,resizable:true,webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true}});
  win.loadFile('panel.html',{query:{id,title}});
  win.webContents.once('did-finish-load',()=>win.webContents.send('panel:loadContent',{id,html}));
  win.on('focus',()=>mainWindow?.webContents.send('panel:focus',{id}));
  return {ok:true};
});
ipcMain.on('panel:request-dock',(_e,{id,html})=>mainWindow?.webContents.send('panel:dock',{id,html}));

ipcMain.handle('scripts:dir',()=>scriptsDir);
ipcMain.handle('scripts:list',()=>{ ensureScriptsDir(); return fs.readdirSync(scriptsDir).filter(f=>f.endsWith('.js')); });
ipcMain.handle('scripts:read',(_e,n)=>{ const f=path.join(scriptsDir,safeScriptName(n)); return fs.existsSync(f)?fs.readFileSync(f,'utf-8'):''; });
ipcMain.handle('scripts:write',(_e,{name,content})=>{ fs.writeFileSync(path.join(scriptsDir,safeScriptName(name)),String(content??''),'utf-8'); return {ok:true}; });
ipcMain.handle('scripts:delete',(_e,n)=>{ const f=path.join(scriptsDir,safeScriptName(n)); if(fs.existsSync(f)) fs.unlinkSync(f); return {ok:true}; });
ipcMain.handle('scripts:run',(e,{code,ctx})=>{
  const runId=randomUUID(); const logs=[]; const token={aborted:false,timers:new Set()}; runningScripts.set(runId,token);
  const sandbox={console:{log:(...a)=>logs.push(a.join(' '))},sleep:ms=>new Promise((r,j)=>{const t=setTimeout(()=>token.aborted?j(new Error('ABORTED')):r(),Number(ms)||0);token.timers.add(t);}),
    send:async(d,m='text',a='none')=>{if(token.aborted)throw new Error('ABORTED');const r=await writeToSerial(ctx.id,d,m,a);if(!r.ok)throw new Error(r.error);return r;},
    onData:h=>typeof h==='function'&&addScriptWatcher(ctx.id,runId,h),shouldStop:()=>token.aborted};
  (async()=>{try{await new vm.Script(`(async()=>{${code||''}})()`).runInContext(vm.createContext(sandbox)); e.sender.send('scripts:ended',{runId,ok:true,logs});}
    catch(err){logs.push('[ERROR] '+(err?.message||String(err))); e.sender.send('scripts:ended',{runId,ok:false,error:err?.message,logs});}
    finally{token.timers.forEach(clearTimeout); runningScripts.delete(runId); removeScriptWatcher(runId);}})();
  return {ok:true,runId};
});
ipcMain.handle('scripts:stop',(_e,{runId})=>{const t=runningScripts.get(runId); if(!t) return {ok:false,error:'NOT_RUNNING'}; t.aborted=true; removeScriptWatcher(runId); return {ok:true};});

// ========== 生命周期 ==========
app.whenReady().then(()=>{ensureScriptsDir();createMainWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createMainWindow();});});
app.on('window-all-closed',()=>{ports.forEach(({port})=>{try{port.close();}catch{}}); if(process.platform!=='darwin')app.quit();});
