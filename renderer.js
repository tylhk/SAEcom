const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const panesEl = $('#panes');
const panelListEl = $('#panelList');
const toggleSidebarBtn = $('#toggleSidebar');
const sidebarEl = $('#sidebar');
const btnSettings = document.getElementById('btnSettings');
const dlgSettings = document.getElementById('dlgSettings');
const settingsClose = document.getElementById('settingsClose');
const settingsOk = document.getElementById('settingsOk');
const fullscreenToggle = $('#fullscreenToggle');
const nightToggle = $('#nightToggle');
const animToggle = $('#animToggle');

// 设置持久化
const SETTINGS_KEY = 'appSettings';
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return {
            fullscreen: !!s.fullscreen,
            dark: !!s.dark,
            anim: !!s.anim,
        };
    } catch { return { mute: false, dark: false, anim: false }; }
}
function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s || settings));
}
const settings = loadSettings();

function applyThemeDark(enabled) {
    document.documentElement.classList.toggle('theme-dark', !!enabled);
    window.api?.theme?.set(!!enabled);
}
function applyFx(enabled) {
    document.documentElement.classList.toggle('fx-enabled', !!enabled);
}
applyThemeDark(settings.dark);
applyFx(settings.anim);
btnSettings.addEventListener('click', () => {
    if (fullscreenToggle) fullscreenToggle.checked = !!settings.fullscreen;
    if (nightToggle) nightToggle.checked = !!settings.dark;
    if (animToggle) animToggle.checked = !!settings.anim;
    dlgSettings.showModal();
});
settingsClose.addEventListener('click', () => dlgSettings.close());
settingsOk.addEventListener('click', () => dlgSettings.close());
if (fullscreenToggle) fullscreenToggle.addEventListener('change', () => {
    settings.fullscreen = fullscreenToggle.checked;
    saveSettings();
    window.api?.window?.setFullscreen(!!settings.fullscreen);
});
if (nightToggle) nightToggle.addEventListener('change', () => {
    settings.dark = nightToggle.checked; saveSettings(); applyThemeDark(settings.dark);
});
if (animToggle) animToggle.addEventListener('change', () => {
    settings.anim = animToggle.checked; saveSettings(); applyFx(settings.anim);
});
// ===== 动画 & 粒子效果 =====
let fxLayer = null;
let fxCanvas, fxCtx, fxDPR = 1, fxRunning = false, fxParticles = [];
function ensureFxLayer() {
    if (!fxLayer) {
        fxLayer = document.getElementById('fxLayer');
        if (!fxLayer) {
            fxLayer = document.createElement('div');
            fxLayer.id = 'fxLayer';
            Object.assign(fxLayer.style, {
                position: 'fixed',
                inset: '0',
                zIndex: '10000',
                pointerEvents: 'none'
            });
            document.body.appendChild(fxLayer);
        }
    }
    return fxLayer;
}
function shakeScreenRandom(maxAmp = 8, duration = 0.5) {
    const t = document.getElementById('workspace') || document.body;
    const rand = (n) => (Math.random()*2 - 1) * n;
    const A = Math.max(2, maxAmp);
    const rot = () => (Math.random()*2 - 1) * 2;
  
    t.style.setProperty('--shakeT', `${duration}s`);
    t.style.setProperty('--sx1', `${rand(A)}px`);
    t.style.setProperty('--sy1', `${rand(A)}px`);
    t.style.setProperty('--rot1', `${rot()}deg`);
    t.style.setProperty('--sx2', `${rand(A)}px`);
    t.style.setProperty('--sy2', `${rand(A)}px`);
    t.style.setProperty('--rot2', `${rot()}deg`);
    t.style.setProperty('--sx3', `${rand(A)}px`);
    t.style.setProperty('--sy3', `${rand(A)}px`);
    t.style.setProperty('--rot3', `${rot()}deg`);
    t.style.setProperty('--sx4', `${rand(A)}px`);
    t.style.setProperty('--sy4', `${rand(A)}px`);
    t.style.setProperty('--rot4', `${rot()}deg`);
  
    t.classList.remove('fx-shake-rand');
    void t.offsetWidth;
    t.classList.add('fx-shake-rand');
    t.addEventListener('animationend', () => t.classList.remove('fx-shake-rand'), { once:true });
  }
  
function ensureFxCanvas() {
    if (!fxCanvas) {
        if (!fxLayer) { fxLayer = document.getElementById('fxLayer') || document.createElement('div'); fxLayer.id = 'fxLayer'; document.body.appendChild(fxLayer); }
        fxCanvas = document.createElement('canvas');
        fxCanvas.id = 'fxCanvas';
        fxLayer.appendChild(fxCanvas);
        fxCtx = fxCanvas.getContext('2d');
        const resize = () => {
            fxDPR = Math.min(window.devicePixelRatio || 1, 2);
            fxCanvas.width = Math.floor(window.innerWidth * fxDPR);
            fxCanvas.height = Math.floor(window.innerHeight * fxDPR);
            fxCanvas.style.width = window.innerWidth + 'px';
            fxCanvas.style.height = window.innerHeight + 'px';
        };
        resize();
        window.addEventListener('resize', resize);
    }
}
function startFxLoop() {
    if (fxRunning) return;
    fxRunning = true;
    let last = performance.now();
    const loop = (now) => {
        if (!fxRunning) return;
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;
        fxCtx.setTransform(fxDPR, 0, 0, fxDPR, 0, 0);
        fxCtx.clearRect(0, 0, fxCanvas.width / fxDPR, fxCanvas.height / fxDPR);
        const bp = document.getElementById('bottomPanel')?.getBoundingClientRect();
        const landY = (bp ? bp.top : window.innerHeight - 190);
        const g = 1800; // px/s^2
        fxParticles = fxParticles.filter(p => {
            if (!p.landed) {
                p.vy += g * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                if (p.y + p.size >= landY) {
                    p.y = landY - p.size;
                    p.vy = 0;
                    p.landed = true;
                    p.landTime = now;
                }
            } else {
                p.vx *= 0.94;
                p.x += p.vx * dt;
                const t = (now - p.landTime) / 1000;
                p.alpha = Math.max(0, 1 - t / 1.0);
            }
            const grd = fxCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 1.6);
            grd.addColorStop(0, `rgba(255,220,130,${0.9 * p.alpha})`);
            grd.addColorStop(0.5, `rgba(255,190,70,${0.7 * p.alpha})`);
            grd.addColorStop(1, `rgba(255,160,20,0)`);
            fxCtx.fillStyle = grd;
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            fxCtx.fill();
            let tailK = 1;
            if (p.landed) {
                const t150 = (now - p.landTime) / 150;
                tailK = Math.max(0, 1 - t150);
            }
            if (tailK > 0.02) {
                fxCtx.strokeStyle = `rgba(255,200,80,${0.8 * p.alpha * tailK})`;
                fxCtx.lineWidth = Math.max(1, p.size * 0.4 * tailK);
                fxCtx.beginPath();
                fxCtx.moveTo(p.x - p.vx * 0.04 * tailK, p.y - p.vy * 0.04 * tailK);
                fxCtx.lineTo(p.x, p.y);
                fxCtx.stroke();
            }
            return p.alpha > 0 && p.x > -50 && p.x < window.innerWidth + 50;
        });
        if (fxParticles.length === 0) {
            fxRunning = false;
            return;
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}
function goldenSparksBurst(dir = +1) {
    if (!settings.anim) return;
    ensureFxCanvas();

    const side = sidebarEl.getBoundingClientRect();
    const originX = (dir > 0) ? side.right - 2 : side.right - 2;
    const y0 = side.top, y1 = side.bottom;
    const count = (dir > 0) ? 140 : 90;

    for (let i = 0; i < count; i++) {
        const y = y0 + Math.random() * (y1 - y0);
        const speed = 550 + Math.random() * 520;
        const angle = (Math.random() * 0.6 - 0.3);
        const vx = dir * Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed * 0.35 - 100;
        fxParticles.push({
            x: originX,
            y,
            vx,
            vy,
            size: 1.5 + Math.random() * 2.2,
            alpha: 1,
            landed: false,
            landTime: 0
        });
    }
    startFxLoop();
    const target = document.getElementById('workspace') || document.body;
    target.classList.remove('fx-shake-strong'); void target.offsetWidth; target.classList.add('fx-shake-strong');
}
function spawnRipple(x, y) {
    if (!settings.anim) return;
    ensureFxLayer();
    const ring = document.createElement('div');
    ring.className = 'fx-ripple';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    fxLayer.appendChild(ring);
    ring.addEventListener('animationend', () => ring.remove());
}
function spawnParticles(x, y) {
    if (!settings.anim) return;
    ensureFxLayer();
    const count = 26;
    const isDark = document.documentElement.classList.contains('theme-dark');
    const palette = isDark
        ? ['#7aa2f7', '#b7e3ff', '#a6da95', '#f5a97f', '#ed8796', '#e5e9f0']
        : ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#8E77ED', '#2EC4B6'];

    const shapes = ['circle', 'square', 'triangle'];
    for (let i = 0; i < count; i++) {
        const el = document.createElement('span');
        el.className = 'fx-particle';
        const angle = Math.random() * Math.PI * 2;
        const dist = 80 + Math.random() * 140;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const rot = (Math.random() * 360) | 0;
        const size = 6 + Math.random() * 10;
        const shape = shapes[(Math.random() * shapes.length) | 0];

        el.style.setProperty('--dx', dx + 'px');
        el.style.setProperty('--dy', dy + 'px');
        el.style.setProperty('--rot', rot + 'deg');
        el.style.width = size + 'px';
        el.style.height = size + 'px';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.background = palette[i % palette.length];

        if (shape === 'square') el.style.borderRadius = '3px';
        if (shape === 'triangle') {
            el.style.background = 'transparent';
            el.style.borderLeft = `${size / 2}px solid transparent`;
            el.style.borderRight = `${size / 2}px solid transparent`;
            el.style.borderBottom = `${size}px solid ${palette[i % palette.length]}`;
            el.style.width = '0px'; el.style.height = '0px';
        }

        fxLayer.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
        setTimeout(() => el.remove(), 1500);
    }
}
function spawnShockwave(x, y) {
    if (!settings.anim) return;
    ensureFxLayer();
    const sw = document.createElement('div');
    sw.className = 'fx-shockwave';
    sw.style.left = x + 'px';
    sw.style.top = y + 'px';
    fxLayer.appendChild(sw);
    sw.addEventListener('animationend', () => sw.remove());
}
function spawnMeteors(x, y) {
    if (!settings.anim) return;
    ensureFxLayer();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
        const m = document.createElement('div');
        m.className = 'fx-meteor';
        const deg = (Math.random() * 60 - 30) + (Math.random() < .5 ? 180 : 0);
        const dx = 140 + Math.random() * 120;
        const dy = (Math.random() * 60 - 30);
        m.style.setProperty('--deg', deg + 'deg');
        m.style.setProperty('--x', x + 'px');
        m.style.setProperty('--y', y + 'px');
        m.style.setProperty('--dx', dx + 'px');
        m.style.setProperty('--dy', dy + 'px');
        fxLayer.appendChild(m);
        m.addEventListener('animationend', () => m.remove());
    }
}
function spawnConfetti(x, y) {
    if (!settings.anim) return;
    ensureFxLayer();
    const count = 22;
    const isDark = document.documentElement.classList.contains('theme-dark');
    const palette = isDark
        ? ['#7aa2f7', '#a6da95', '#f5a97f', '#ed8796', '#c6a0f6', '#91d7e3']
        : ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#8E77ED', '#2EC4B6'];

    for (let i = 0; i < count; i++) {
        const c = document.createElement('div');
        c.className = 'fx-confetti';
        const w = 6 + Math.random() * 6;
        const h = 8 + Math.random() * 8;
        const cx = x, cy = y;
        const dx = (Math.random() * 2 - 1) * 180;
        const dy = (Math.random() * 2 - 1) * 40;
        c.style.width = w + 'px';
        c.style.height = h + 'px';
        c.style.background = palette[i % palette.length];
        c.style.setProperty('--cx', cx + 'px');
        c.style.setProperty('--cy', cy + 'px');
        c.style.setProperty('--dx', dx + 'px');
        c.style.setProperty('--dy', dy + 'px');
        fxLayer.appendChild(c);
        c.addEventListener('animationend', () => c.remove());
    }
}
function bounce(el) {
    if (!settings.anim || !el) return;
    el.classList.remove('fx-pop');
    void el.offsetWidth;
    el.classList.add('fx-pop');
}
window.addEventListener('click', (e) => {
    if (!settings.anim) return;
    const t = e.target.closest('button, .port-status, #bottomNav button, input[type="checkbox"], .cmd-card .send');
    if (!t) return;
    spawnRipple(e.clientX, e.clientY);
    spawnParticles(e.clientX, e.clientY);
    if (Math.random() < 0.8) spawnShockwave(e.clientX, e.clientY);
    if (Math.random() < 0.6) spawnConfetti(e.clientX, e.clientY);
    if (Math.random() < 0.5) spawnMeteors(e.clientX, e.clientY);
    bounce(t);
    const text = (t.textContent || '').trim();
    if (/删除|弹出|关闭串口|打开串口|发送文件|运行脚本|保存|确定/.test(text)
        || t.classList.contains('btnPop') || t.id === 'btnSendFile'
        || t.id === 'btnScriptRun' || t.id === 'btnScriptStop') {
        shakeScreenRandom(9, 0.55);
    }
}, true);

const btnNew = $('#btnNew');
const btnRefreshPorts = $('#btnRefreshPorts');
const btnScriptStop = $('#btnScriptStop');
let currentRunId = null;
const SIDEBAR_COLLAPSED_W = 50;
const LEFT_GUTTER = 12;
const activeLabel = $('#activePanelLabel');
const selPort = $('#selPort');
const baud = $('#baud');
const databits = $('#databits');
const stopbits = $('#stopbits');
const parity = $('#parity');
const inputData = $('#inputData');
const hexMode = $('#hexMode');
const appendSel = $('#append');
const bufferInput = $('#bufferTime');
const btnSend = $('#btnSend');

const dlgNew = $('#dlgNew');
const dlgPortList = $('#dlgPortList');
const dlgCreate = $('#dlgCreate');
const dlgCancel = $('#dlgCancel');

const fileNameInput = $('#fileName');
const fileChooser = $('#fileChooser');
const btnChooseFile = $('#btnChooseFile');
const btnSendFile = $('#btnSendFile');

const cmdGrid = $('#cmdGrid');
const cmdPrev = $('#cmdPrev');
const cmdNext = $('#cmdNext');
const cmdEditPage = $('#cmdEditPage');
const cmdRepeat = $('#cmdRepeat');
const cmdRepeatMs = $('#cmdRepeatMs');

const dlgCmdEdit = $('#dlgCmdEdit');
const cmdTableBody = $('#cmdTableBody');
const cmdAdd = $('#cmdAdd');
const cmdCancel = $('#cmdCancel');
const cmdSave = $('#cmdSave');

const openScriptBtn = $('#openScript');
const dlgScript = $('#dlgScript');
const scriptEditor = $('#scriptEditor');
const scriptList = $('#scriptList');
const btnScriptNew = $('#btnScriptNew');
const currentScriptNameEl = $('#currentScriptName');
let currentScript = '';
const scriptDirHint = $('#scriptDirHint');
const btnScriptSave = $('#btnScriptSave');
const btnScriptDelete = $('#btnScriptDelete');
const btnScriptRun = $('#btnScriptRun');
const btnScriptClose = $('#btnScriptClose');
// 示例脚本模板
const DEFAULT_SCRIPT_TEMPLATE = `/**
 * SAEcom 脚本 API 速览
 * - send(data, mode='text'|'hex', end='none'|'CR'|'LF'|'CRLF'): Promise<void>
 * - sleep(ms): Promise<void>
 * - onData?(handler): 串口有数据到达时触发
 *
 * 示例功能：
 * 1) 每 1000ms 发送一个随机 10 位字符串（演示 send/sleep）
 * 2) 当串口收到数据时，原样回发（回声服务，演示读写）
 */

// 生成随机字符串
function rand(n = 10) {
  const cs = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = ''; for (let i = 0; i < n; i++) s += cs[(Math.random()*cs.length)|0]; return s;
}

// 如果宿主提供了 onData，就注册一个回调：收到文本→原样回发
if (typeof onData === 'function') {
  onData(async (evt) => {
    // evt 可能是 { text, bytes } 或类似结构，做三种兜底
    let text = '';
    if (evt && typeof evt.text === 'string') {
      text = evt.text;
    } else if (evt && evt.bytes) {
      try {
        const TD = (typeof TextDecoder !== 'undefined') ? TextDecoder : (await import('util')).TextDecoder;
        text = new TD('utf-8', { fatal:false }).decode(evt.bytes);
      } catch { /* ignore */ }
    } else if (typeof evt === 'string') {
      text = evt;
    }
    if (text && text.trim()) {
      await send(text, 'text', 'CRLF'); // 回声
    }
  });
}

// 持续发送示例数据（可用“停止运行”按钮终止）
while (true) {
  await send(rand(10), 'text', 'CRLF');
  await sleep(1000);
}
`;

const dlgScriptName = $('#dlgScriptName');
const scriptNameInput = $('#scriptNameInput');
const scriptNameOk = $('#scriptNameOk');
const scriptNameCancel = $('#scriptNameCancel');
const btnSaveLog = $('#btnSaveLog');
btnSaveLog.addEventListener('click', async () => {
    const id = state.activeId;
    if (!id) return alert('请先选择一个面板');
    const pane = state.panes.get(id);
    if (!pane) return alert('面板不存在');

    const body = pane.el.querySelector('.body');
    const text = body.innerText || body.textContent || '';
    if (!text.trim()) return alert('当前面板没有数据');

    const res = await window.api.panel.saveLog(pane.info.name, text);
    if (res.ok) {
        alert('已保存到：' + res.filePath);
    } else if (!res.canceled) {
        alert('保存失败：' + res.error);
    }
});

const state = {
    panes: new Map(), // id -> {el, info:{path,name}, options, open:boolean, viewMode, logs}
    activeId: null,
    knownPorts: [],
    buffers: new Map(),
    savedConfig: [],

    commands: [],     // { id, name, data, mode: 'text'|'hex' }
    cmdPage: 0,
    cmdCols: 1,
    cmdRows: 1,
    cmdIntervalMap: new Map() // id -> intervalId
};

function exportPanelsConfig() {
    return Array.from(state.panes.values()).map(p => ({
        id: p.info.path,
        name: p.info.name,
        options: p.options,
        left: p.el.style.left || "30px",
        top: p.el.style.top || "30px",
        width: p.el.style.width || "420px",
        height: p.el.style.height || "240px",
        hidden: p.el.classList.contains('hidden')   // ← 新增
    }));
}


function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/* ===== 脚本 ===== */
async function refreshScriptList() {
    const dir = await window.api.scripts.dir();
    scriptDirHint.textContent = dir || '';
    const items = await window.api.scripts.list();
    scriptList.innerHTML = '';
    items.forEach(name => {
        const li = document.createElement('li');
        li.textContent = name;
        li.onclick = async () => {
            const code = await window.api.scripts.read(name);
            currentScript = name;
            currentScriptNameEl.textContent = name;

            scriptEditor.readOnly = false;
            scriptEditor.value = code || '';
            scriptEditor.focus();
        };
        scriptList.appendChild(li);
    });
}

function showTempStatus(text) {
    const old = currentScriptNameEl.textContent;
    currentScriptNameEl.textContent = (old || '') + `（${text}）`;
    setTimeout(() => { currentScriptNameEl.textContent = currentScript || '（未选择）'; }, 1200);
}

function askScriptName(defaultBase = '新脚本') {
    return new Promise((resolve) => {
        if (!dlgScriptName || !scriptNameInput || !scriptNameOk || !scriptNameCancel) {
            const input = prompt('输入脚本名称（无需后缀）', defaultBase) || '';
            if (!input.trim()) return resolve('');
            return resolve(input.endsWith('.js') ? input : `${input}.js`);
        }

        scriptNameInput.value = defaultBase;
        dlgScriptName.showModal();

        const ok = () => {
            let n = (scriptNameInput.value || '').trim();
            dlgScriptName.close();
            resolve(n ? (n.endsWith('.js') ? n : n + '.js') : '');
        };
        const cancel = () => { dlgScriptName.close(); resolve(''); };

        scriptNameOk.onclick = ok;
        scriptNameCancel.onclick = cancel;
        scriptNameInput.onkeydown = (e) => { if (e.key === 'Enter') ok(); };

        setTimeout(() => scriptNameInput.select(), 0);
    });
}

btnScriptNew.addEventListener('click', async () => {
    const name = await askScriptName('新脚本');
    if (!name) return;

    await window.api.scripts.write(name, DEFAULT_SCRIPT_TEMPLATE);
    await refreshScriptList();

    currentScript = name;
    currentScriptNameEl.textContent = name;

    scriptEditor.readOnly = false;
    scriptEditor.value = DEFAULT_SCRIPT_TEMPLATE;
    scriptEditor.focus();
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
        e.preventDefault();
        const v = !settings.fullscreen;
        settings.fullscreen = v;
        saveSettings();
        fullscreenToggle && (fullscreenToggle.checked = v);
        window.api?.window?.setFullscreen(v);
    }
});

openScriptBtn.addEventListener('click', async () => {
    await refreshScriptList();
    currentScript = '';
    currentScriptNameEl.textContent = '（未命名）';
    scriptEditor.readOnly = false;
    if (!scriptEditor.value) scriptEditor.value = '';
    dlgScript.showModal();
});

btnScriptSave.addEventListener('click', async () => {
    if (!currentScript) {
        const name = await askScriptName('新脚本');
        if (!name) return;
        currentScript = name;
    }

    await window.api.scripts.write(currentScript, scriptEditor.value || '');
    await refreshScriptList();
    currentScriptNameEl.textContent = currentScript;

    scriptEditor.readOnly = false;
    scriptEditor.focus();
    showTempStatus('已保存');
});

btnScriptDelete.addEventListener('click', async () => {
    if (!currentScript) return alert('未选择脚本');
    if (!confirm(`删除脚本：${currentScript} ?`)) return;

    await window.api.scripts.delete(currentScript);
    await refreshScriptList();

    currentScript = '';
    currentScriptNameEl.textContent = '（未命名）';
    scriptEditor.readOnly = false;
    scriptEditor.value = '';
});

btnScriptRun.addEventListener('click', async () => {
    if (currentRunId) return alert('已有脚本在运行，请先停止或等待结束');
    const id = state.activeId;
    if (!id) return alert('请先选择一个面板');

    const code = scriptEditor.value || '';
    const { ok, runId, error } = await window.api.scripts.run(code, { id });
    if (!ok) return alert('启动失败：' + (error || '未知错误'));

    currentRunId = runId;
    btnScriptRun.disabled = true;
    btnScriptStop.disabled = false;

    dlgScript.close();
});
btnScriptStop.addEventListener('click', async () => {
    if (!currentRunId) return;
    const { ok, error } = await window.api.scripts.stop(currentRunId);
    if (!ok) alert('停止失败：' + (error || '未知错误'));
});
window.api.scripts.onEnded(({ runId, ok, error, logs }) => {
    if (currentRunId && runId !== currentRunId) return;
    currentRunId = null;
    btnScriptRun.disabled = false;
    btnScriptStop.disabled = true;

    if (ok) {
        alert((logs || []).join('\n') || '脚本运行结束');
    } else {
        const msg = (error === 'ABORTED') ? '已停止脚本' : ('脚本运行失败：' + error);
        alert(msg + (logs?.length ? '\n' + logs.join('\n') : ''));
    }
});

btnScriptClose.addEventListener('click', () => dlgScript.close());

function nowTs() {
    const d = new Date();
    const pad = (n, len = 2) => n.toString().padStart(len, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.`
        + `${pad(d.getMilliseconds(), 3)}`;
}

function echoIfEnabled(id, text) {
    const echo = $('#echoSend');
    if (!echo || !echo.checked) return;
    const pane = state.panes.get(id);
    if (!pane) return;
    const body = pane.el.querySelector('.body');
    const ts = nowTs();
    body.innerHTML += `<span style="color:red">[${ts}]\n${escHtml(text)}\n</span>`;
    body.scrollTop = body.scrollHeight;
}

function setActive(id) {
    state.activeId = id;
    $$('.pane').forEach(p => p.classList.remove('active'));
    const pane = state.panes.get(id);
    if (pane) {
        pane.el.classList.add('active');
        activeLabel.textContent = pane.info.name;
        fillPortSelect(id);
    } else {
        activeLabel.textContent = '（未选择）';
    }
}

function fillPortSelect(activeId) {
    const pane = state.panes.get(activeId);
    if (!selPort) {
        if (pane) {
            baud.value = pane.options?.baudRate || 115200;
            databits.value = pane.options?.dataBits || 8;
            stopbits.value = pane.options?.stopBits || 1;
            parity.value = pane.options?.parity || 'none';
        }
        return;
    }

    selPort.innerHTML = '';
    state.knownPorts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = `${p.path} ${p.friendlyName ? `(${p.friendlyName})` : ''}`;
        selPort.appendChild(opt);
    });
    if (pane) {
        selPort.value = pane.info.path;
        baud.value = pane.options?.baudRate || 115200;
        databits.value = pane.options?.dataBits || 8;
        stopbits.value = pane.options?.stopBits || 1;
        parity.value = pane.options?.parity || 'none';
    }
}

function createPane(portPath, name) {
    const id = portPath;
    if (state.panes.has(id)) {
        setActive(id);
        window.api.config.save(exportPanelsConfig());
        return;
    }
    const el = document.createElement('div');
    el.className = 'pane';
    const ws = document.getElementById('workspace');
    const sideW = sidebarEl ? sidebarEl.offsetWidth : 0;
    const margin = 16;

    const paneW = 420;
    const paneH = 240;

    const wsW = ws.clientWidth;
    const wsH = ws.clientHeight;
    const leftMin = sideW + margin;
    const leftMax = Math.max(leftMin, wsW - paneW - margin);
    const topMin = margin;
    const topMax = Math.max(topMin, wsH - paneH - margin);

    const initLeft = leftMax;
    const initTop = Math.min(topMax, topMin + Math.floor(Math.random() * 120));

    el.style.left = `${initLeft}px`;
    el.style.top = `${initTop}px`;

    el.innerHTML = `
    <div class="title">
      <div class="name">${name}</div>
      <div class="btns">
        <button class="btnToggle" title="打开/关闭串口">打开串口</button>
        <button class="btnHex" title="切换Hex显示">HEX显示</button>
        <button class="btnHide" title="隐藏面板">隐藏</button>
        <button class="btnPop" title="弹出独立窗口">弹出</button>
      </div>
    </div>
    <div class="body" data-id="${id}"></div>
    <div class="resizer"></div>
  `;
    panesEl.appendChild(el);

    const btnToggle = el.querySelector('.btnToggle');
    btnToggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pane = state.panes.get(id);
        if (!pane) return;
        if (pane.open) {
            await window.api.serial.close(id);
            pane.open = false;
            btnToggle.textContent = '打开串口';
        } else {
            pane.options = {
                baudRate: parseInt(baud.value, 10),
                dataBits: parseInt(databits.value, 10),
                stopBits: parseInt(stopbits.value, 10),
                parity: parity.value
            };
            const res = await window.api.serial.open(pane.info.path, pane.options);
            if (res.ok) {
                pane.open = true;
                btnToggle.textContent = '关闭串口';
            } else {
                alert('打开失败：' + res.error);
            }
        }
        refreshPanelList();
        window.api.config.save(exportPanelsConfig());
    });

    const btnHex = el.querySelector('.btnHex');
    btnHex.addEventListener('click', () => {
        const pane = state.panes.get(id);
        if (!pane) return;
        pane.viewMode = (pane.viewMode === 'text' ? 'hex' : 'text');
        btnHex.textContent = pane.viewMode === 'hex' ? '文本显示' : 'HEX显示';
        redrawPane(id);
    });

    el.querySelector('.btnHide').addEventListener('click', (e) => {
        e.stopPropagation();
        el.classList.add('hidden');
        refreshPanelList();
        window.api.config.save(exportPanelsConfig());
    });

    el.querySelector('.btnPop').addEventListener('click', (e) => {
        e.stopPropagation();
        const html = el.querySelector('.body').innerHTML;
        window.api.panel.popout(id, name, html);
        el.classList.add('hidden');
        refreshPanelList();
        window.api.config.save(exportPanelsConfig());
    });

    el.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        setActive(id);
        window.api.config.save(exportPanelsConfig());
    });

    // ===== 拖动 =====
    const titleEl = el.querySelector('.title');
    titleEl.addEventListener('dragstart', e => e.preventDefault());
    el.addEventListener('dragstart', e => e.preventDefault());
    el.querySelector('.body').addEventListener('dragstart', e => e.preventDefault());

    let pressed = false;
    let dragging = false;
    let suppressClick = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const DRAG_THRESHOLD = 3;

    function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

    function endDrag() {
        if (!pressed && !dragging) return;
        pressed = false;
        if (dragging) {
            dragging = false;
            el.classList.remove('dragging');
            el.style.cursor = 'grab';
            window.api.config.save(exportPanelsConfig());
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 50);
        }
    }

    titleEl.addEventListener('pointerdown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        setActive(id);
        pressed = true;
        dragging = false;
        titleEl.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
        startX = e.clientX; startY = e.clientY;
        startLeft = parseInt(el.style.left, 10) || 0;
        startTop = parseInt(el.style.top, 10) || 0;
    });

    titleEl.addEventListener('pointermove', (e) => {
        if (!pressed) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
            dragging = true;
            el.classList.add('dragging');
        }
        if (!dragging) return;

        const ws = document.getElementById('workspace');
        const wsW = ws.clientWidth;
        const wsH = ws.clientHeight;

        const leftMin = SIDEBAR_COLLAPSED_W + LEFT_GUTTER;

        const maxLeft = Math.max(leftMin, wsW - el.offsetWidth);
        const maxTop = Math.max(0, wsH - el.offsetHeight);

        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        if (newLeft < leftMin) newLeft = leftMin;
        if (newLeft > maxLeft) newLeft = maxLeft;
        if (newTop < 0) newTop = 0;
        if (newTop > maxTop) newTop = maxTop;

        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
    });


    titleEl.addEventListener('pointerup', endDrag);
    titleEl.addEventListener('pointercancel', endDrag);
    titleEl.addEventListener('lostpointercapture', endDrag);
    window.addEventListener('blur', endDrag);

    el.addEventListener('click', (e) => {
        if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    const resizer = el.querySelector('.resizer');
    let resizing = false, startX2 = 0, startY2 = 0, startW = 0, startH = 0;
    resizer.addEventListener('pointerdown', (e) => {
        resizing = true;
        resizer.setPointerCapture(e.pointerId);
        startX2 = e.clientX; startY2 = e.clientY;
        startW = el.offsetWidth; startH = el.offsetHeight;
    });
    resizer.addEventListener('pointermove', (e) => {
        if (!resizing) return;
        const dx = e.clientX - startX2;
        const dy = e.clientY - startY2;

        const ws = document.getElementById('workspace');
        const wsW = ws.clientWidth;
        const wsH = ws.clientHeight;

        const left = parseInt(el.style.left, 10) || 0;
        const top = parseInt(el.style.top, 10) || 0;

        const minW = 200, minH = 120;
        const maxW = Math.max(minW, wsW - left);
        const maxH = Math.max(minH, wsH - top);

        const newW = Math.min(Math.max(minW, startW + dx), maxW);
        const newH = Math.min(Math.max(minH, startH + dy), maxH);

        el.style.width = `${newW}px`;
        el.style.height = `${newH}px`;
    });

    resizer.addEventListener('pointerup', () => {
        resizing = false;
        window.api.config.save(exportPanelsConfig());
    });

    state.panes.set(id, {
        el,
        info: { path: id, name: name || id },
        options: { baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' },
        open: false,
        viewMode: 'text',
        logs: []
    });

    const saved = (state.savedConfig || []).find(p => p.id === id);
    if (saved) {
        el.style.left = saved.left; el.style.top = saved.top;
        el.style.width = saved.width; el.style.height = saved.height;
        if (saved.options) state.panes.get(id).options = saved.options;
        if (saved.hidden) el.classList.add('hidden');
    }

    refreshPanelList();
    if (!saved || !saved.hidden) setActive(id);
    window.api.config.save(exportPanelsConfig());
}

function refreshPanelList() {
    panelListEl.innerHTML = '';
    state.panes.forEach((pane, id) => {
        const li = document.createElement('li');
        li.className = 'port-row'; // ← 给样式用

        const statusBtn = document.createElement('button');
        statusBtn.className = 'port-status ' + (pane.open ? 'open' : 'closed');
        statusBtn.title = pane.open ? '关闭串口' : '打开串口';
        statusBtn.onclick = async (e) => {
            e.stopPropagation();
            const p = state.panes.get(id);
            if (!p) return;

            if (p.open) {
                await window.api.serial.close(id);
                p.open = false;
            } else {
                p.options = {
                    baudRate: parseInt(baud.value, 10),
                    dataBits: parseInt(databits.value, 10),
                    stopBits: parseInt(stopbits.value, 10),
                    parity: parity.value
                };
                const res = await window.api.serial.open(p.info.path, p.options);
                if (!res.ok) return alert('打开失败：' + res.error);
                p.open = true;
            }
            const btnToggle = p.el.querySelector('.btnToggle');
            if (btnToggle) btnToggle.textContent = p.open ? '关闭串口' : '打开串口';

            refreshPanelList();
            window.api.config.save(exportPanelsConfig());
        };

        const nameEl = document.createElement('span');
        nameEl.className = 'port-name';
        nameEl.textContent = pane.info.name || id;
        nameEl.title = pane.info.name || id;
        nameEl.onclick = () => { pane.el.classList.remove('hidden'); setActive(id); };

        const act = document.createElement('div');
        act.className = 'actions';

        const bClear = document.createElement('button');
        bClear.textContent = '清空';
        bClear.onclick = () => {
            if (!confirm(`确定要清空面板 “${pane.info.name}” 的数据吗？`)) return;
            const body = pane.el.querySelector('.body');
            body.innerHTML = '';
            pane.logs = [];
        };

        const bDel = document.createElement('button');
        bDel.textContent = '删除';
        bDel.onclick = async () => {
            if (!confirm(`确定要删除面板 “${pane.info.name}” 吗？`)) return;
            await window.api.serial.close(id);
            pane.el.remove();
            state.panes.delete(id);
            refreshPanelList();
            window.api.config.save(exportPanelsConfig());
            if (state.activeId === id) setActive(null);
        };

        act.append(bClear, bDel);
        li.append(statusBtn, nameEl, act);
        panelListEl.appendChild(li);
    });
}

function formatBytes(bytes, mode = 'text') {
    if (mode === 'hex') return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ') + ' ';
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
    catch { return Array.from(bytes).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join(''); }
}

window.api.serial.onData(({ id, bytes }) => {
    const bufferTime = parseInt(bufferInput.value || '0', 10);
    if (bufferTime > 0) {
        if (!state.buffers.has(id)) state.buffers.set(id, { timer: null, data: [] });
        const bufObj = state.buffers.get(id);
        bufObj.data.push(bytes);
        if (bufObj.timer) clearTimeout(bufObj.timer);
        bufObj.timer = setTimeout(() => {
            const merged = new Uint8Array(bufObj.data.reduce((acc, b) => acc + b.length, 0));
            let offset = 0;
            bufObj.data.forEach(b => { merged.set(b, offset); offset += b.length; });
            bufObj.data = [];
            showData(id, merged);
        }, bufferTime);
    } else {
        showData(id, bytes);
    }
});

function showData(id, bytes) {
    const pane = state.panes.get(id);
    if (!pane) return;
    const ts = nowTs();
    pane.logs.push({ ts, bytes });

    const body = pane.el.querySelector('.body');
    const dataStr = formatBytes(bytes, pane.viewMode);
    body.innerHTML += `[${ts}]\n${escHtml(dataStr)}\n`;
    body.scrollTop = body.scrollHeight;
}

function redrawPane(id) {
    const pane = state.panes.get(id);
    if (!pane) return;
    const body = pane.el.querySelector('.body');
    body.innerHTML = '';
    pane.logs.forEach(log => {
        const dataStr = formatBytes(log.bytes, pane.viewMode);
        body.innerHTML += `[${log.ts}]\n${escHtml(dataStr)}\n`;
    });
    body.scrollTop = body.scrollHeight;
}

window.api.serial.onEvent((evt) => {
    const pane = state.panes.get(evt.id);
    if (!pane) return;
    const body = pane.el.querySelector('.body');
    if (evt.type === 'close') { pane.open = false; body.textContent += `\n[已关闭]\n`; }
    else if (evt.type === 'error') { body.textContent += `\n[错误] ${evt.message}\n`; }
    refreshPanelList();
});

window.api.panel.onFocusFromPopout(({ id }) => { if (state.panes.has(id)) setActive(id); });
window.api.panel.onDockRequest(({ id, html }) => {
    if (!state.panes.has(id)) {
        const known = state.knownPorts.find(p => p.path === id);
        const label = known ? (known.friendlyName || known.path) : id;
        createPane(id, label);
    }
    const pane = state.panes.get(id);
    pane.el.querySelector('.body').innerHTML = html;
    pane.el.classList.remove('hidden');
    setActive(id);
});

toggleSidebarBtn.addEventListener('click', () => {
    const opening = !sidebarEl.classList.contains('open');
    sidebarEl.classList.toggle('open');
    if (!settings.anim) return;
    setTimeout(() => goldenSparksBurst(opening ? +1 : -1), 10);
});

btnNew.addEventListener('click', async () => {
    await refreshPortsCombo();
    dlgPortList.innerHTML = '';
    state.knownPorts.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = `${p.path} ${p.friendlyName ? `(${p.friendlyName})` : ''}`;
        dlgPortList.appendChild(opt);
    });
    dlgNew.showModal();
});
dlgCancel.addEventListener('click', () => dlgNew.close());
dlgCreate.addEventListener('click', () => {
    const path = dlgPortList.value;
    if (!path) return;
    createPane(path, path);
    dlgNew.close();
});

async function refreshPortsCombo() {
    const list = await window.api.serial.list();
    state.knownPorts = list;
    fillPortSelect(state.activeId);
}
btnRefreshPorts.addEventListener('click', refreshPortsCombo);

btnSend.addEventListener('click', async () => {
    const id = state.activeId;
    if (!id) return alert('请先选择一个面板');
    const data = inputData.value || '';
    const mode = (hexMode && hexMode.checked) ? 'hex' : 'text';
    const append = appendSel.value;
    const res = await window.api.serial.write(id, data, mode, append);
    if (!res.ok) return alert('发送失败：' + res.error);
    echoIfEnabled(id, data);
});

function attachOptionListeners() {
    const writeOptions = () => {
        const id = state.activeId;
        if (!id) return;
        const pane = state.panes.get(id);
        if (!pane) return;
        pane.options = {
            baudRate: parseInt(baud.value, 10),
            dataBits: parseInt(databits.value, 10),
            stopBits: parseInt(stopbits.value, 10),
            parity: parity.value
        };
        window.api.config.save(exportPanelsConfig());
    };
    baud.addEventListener('input', writeOptions);
    baud.addEventListener('change', writeOptions);
    databits.addEventListener('change', writeOptions);
    stopbits.addEventListener('change', writeOptions);
    parity.addEventListener('change', writeOptions);
}
attachOptionListeners();

bufferInput.addEventListener('keydown', (e) => {
    const allow = new Set(['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']);
    if (allow.has(e.key)) return;
    if (e.ctrlKey || e.metaKey) return;
    if (!/^\d$/.test(e.key)) e.preventDefault();
});
bufferInput.addEventListener('input', () => {
    bufferInput.value = bufferInput.value.replace(/[^\d]/g, '');
});
bufferInput.addEventListener('blur', () => {
    let v = parseInt(bufferInput.value || '0', 10);
    if (Number.isNaN(v) || v < 0) v = 0;
    bufferInput.value = String(v);
});

fileNameInput.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
fileNameInput.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length > 0) {
        const f = e.dataTransfer.files[0];
        fileNameInput.value = f.name;
        fileNameInput.dataset.fullPath = f.path;
    }
});
btnChooseFile.addEventListener('click', () => fileChooser.click());
fileChooser.addEventListener('change', () => {
    if (fileChooser.files.length > 0) {
        const f = fileChooser.files[0];
        fileNameInput.value = f.name;
        fileNameInput.dataset.fullPath = f.path;
    }
});
btnSendFile.addEventListener('click', async () => {
    const id = state.activeId;
    if (!id) return alert('请先选择一个面板');
    const filePath = fileNameInput.dataset.fullPath;
    if (!filePath) return alert('请先选择文件');

    try {
        const { hex, length, error } = await window.api.file.readHex(filePath);
        if (error) return alert('读取文件失败：' + error);

        const chunkSize = 2048;
        for (let i = 0; i < hex.length; i += chunkSize) {
            const chunk = hex.slice(i, i + chunkSize);
            const res = await window.api.serial.write(id, chunk, 'hex', 'none');
            if (!res.ok) return alert('文件发送失败：' + res.error);
        }
        alert(`文件 ${fileNameInput.value} 已发送 (${length} 字节)`);
    } catch (e) {
        alert('文件处理异常：' + e.message);
    }
});
function isDraggingFiles(e) {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes('Files');
}
document.addEventListener('dragover', (e) => {
    if (isDraggingFiles(e) && e.target !== fileNameInput) e.preventDefault();
});
document.addEventListener('drop', (e) => {
    if (isDraggingFiles(e) && e.target !== fileNameInput) e.preventDefault();
});

function calcCmdLayout() {
    const grid = cmdGrid.getBoundingClientRect();
    const colW = 300;
    const cols = Math.max(1, Math.floor(grid.width / (colW + 8)));
    const rows = 4;
    state.cmdCols = cols;
    state.cmdRows = rows;
}

function totalCmdPages() {
    const pageSize = state.cmdCols * state.cmdRows;
    return Math.max(1, Math.ceil(state.commands.length / pageSize));
}
function pageSlice(pageIdx) {
    const pageSize = state.cmdCols * state.cmdRows;
    const start = pageIdx * pageSize;
    return state.commands.slice(start, start + pageSize);
}

function buildPreview(cmd) {
    const prev = document.createElement('div');
    prev.className = 'preview';
    prev.textContent = cmd.data || '';
    prev.title = '点击快速编辑';

    prev.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = cmd.data || '';
        input.className = 'preview-edit';

        prev.replaceWith(input);
        input.focus();

        const finish = () => {
            cmd.data = input.value;
            const nextPrev = buildPreview(cmd);
            input.replaceWith(nextPrev);
            saveCommands();
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(); });
    });

    return prev;
}

function renderCmdGrid() {
    calcCmdLayout();
    const pages = totalCmdPages();
    if (state.cmdPage >= pages) state.cmdPage = pages - 1;

    const pageSize = state.cmdCols * state.cmdRows;
    const list = pageSlice(state.cmdPage);

    cmdGrid.innerHTML = '';

    list.forEach(cmd => {
        const card = document.createElement('div');
        card.className = 'cmd-card';
        card.dataset.cmdId = cmd.id;

        const btn = document.createElement('button');
        btn.className = 'send';
        btn.textContent = cmd.name || '(未命名)';
        btn.title = '点击发送';
        btn.onclick = () => sendCommand(cmd, card);
        const prev = buildPreview(cmd);
        if (state.cmdIntervalMap.has(cmd.id)) card.classList.add('auto');
        card.append(btn, prev);
        cmdGrid.appendChild(card);
    });

    const blanks = pageSize - list.length;
    for (let i = 0; i < blanks; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'cmd-card placeholder';
        cmdGrid.appendChild(placeholder);
    }
}

async function sendCommand(cmd, cardEl) {
    const id = state.activeId;
    if (!id) return alert('请先选择一个面板');

    const append = appendSel.value;
    const ms = parseInt(cmdRepeatMs.value || '1000', 10);
    const repeating = cmdRepeat.checked && ms >= 1;

    if (repeating) {
        if (state.cmdIntervalMap.has(cmd.id)) {
            clearInterval(state.cmdIntervalMap.get(cmd.id));
            state.cmdIntervalMap.delete(cmd.id);
            document.querySelectorAll(`.cmd-card[data-cmd-id="${cmd.id}"]`)
                .forEach(el => el.classList.remove('auto'));
            return;
        }
        const timer = setInterval(async () => {
            const res = await window.api.serial.write(id, cmd.data || '', cmd.mode || 'text', append);
            if (res.ok) echoIfEnabled(id, cmd.data || '');
        }, ms);
        state.cmdIntervalMap.set(cmd.id, timer);
        if (cardEl) cardEl.classList.add('auto');
    } else {
        const res = await window.api.serial.write(id, cmd.data || '', cmd.mode || 'text', append);
        if (!res.ok) return alert('发送失败：' + res.error);
        echoIfEnabled(id, cmd.data || '');
    }
}

cmdRepeat.addEventListener('change', () => {
    if (!cmdRepeat.checked) {
        state.cmdIntervalMap.forEach((timerId) => clearInterval(timerId));
        state.cmdIntervalMap.clear();
        document.querySelectorAll('.cmd-card.auto').forEach(el => el.classList.remove('auto'));
    }
});

cmdPrev.addEventListener('click', () => {
    const pages = totalCmdPages();
    state.cmdPage = (state.cmdPage - 1 + pages) % pages;
    renderCmdGrid();
});
cmdNext.addEventListener('click', () => {
    const pages = totalCmdPages();
    state.cmdPage = (state.cmdPage + 1) % pages;
    renderCmdGrid();
});

cmdEditPage.addEventListener('click', () => {
    cmdTableBody.innerHTML = '';
    state.commands.forEach((cmd) => {
        cmdTableBody.appendChild(makeCmdRow(cmd));
    });
    dlgCmdEdit.showModal();
});

function makeCmdRow(cmd) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    const inputName = document.createElement('input');
    inputName.type = 'text'; inputName.value = cmd.name || '';
    inputName.oninput = () => cmd.name = inputName.value;
    tdName.appendChild(inputName);

    const tdData = document.createElement('td');
    const inputData = document.createElement('input');
    inputData.type = 'text'; inputData.value = cmd.data || '';
    inputData.oninput = () => cmd.data = inputData.value;
    tdData.appendChild(inputData);

    const tdMode = document.createElement('td');
    const sel = document.createElement('select');
    sel.innerHTML = `<option value="text">文本</option><option value="hex">HEX</option>`;
    sel.value = cmd.mode || 'text';
    sel.onchange = () => cmd.mode = sel.value;
    tdMode.appendChild(sel);

    const tdOp = document.createElement('td');
    const btnDel = document.createElement('button');
    btnDel.textContent = '删除';
    btnDel.onclick = () => {
        if (!confirm(`删除命令：${cmd.name || '(未命名)'} ?`)) return;
        state.commands = state.commands.filter(c => c.id !== cmd.id);
        tr.remove();
    };
    tdOp.appendChild(btnDel);

    tr.append(tdName, tdData, tdMode, tdOp);
    return tr;
}

cmdAdd.addEventListener('click', () => {
    const newCmd = { id: cryptoRandomId(), name: '新命令', data: '', mode: 'text' };
    state.commands.push(newCmd);
    cmdTableBody.appendChild(makeCmdRow(newCmd));
});

cmdCancel.addEventListener('click', () => dlgCmdEdit.close());
cmdSave.addEventListener('click', () => {
    saveCommands();
    dlgCmdEdit.close();
    renderCmdGrid();
});

function saveCommands() { window.api.commands.save(state.commands); }
async function loadCommands() {
    const list = await window.api.commands.load();
    state.commands = (list || []).map(c => ({
        id: c.id || cryptoRandomId(),
        name: c.name || '',
        data: c.data || '',
        mode: c.mode || 'text'
    }));
}

function cryptoRandomId() {
    return 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function updateTitlebarSafeArea() {
    const root = document.documentElement;
    let h = 30, inset = 38;

    const wco = navigator.windowControlsOverlay;
    if (wco && typeof wco.getTitlebarAreaRect === 'function') {
        const r = wco.getTitlebarAreaRect();   // {x,y,width,height}
        if (r && r.height) {
            h = Math.max(28, Math.round(r.height));
            inset = h + 8;
        }
        wco.addEventListener?.('geometrychange', () => {
            const r2 = wco.getTitlebarAreaRect();
            if (r2 && r2.height) {
                const hh = Math.max(28, Math.round(r2.height));
                root.style.setProperty('--titlebar-height', hh + 'px');
                root.style.setProperty('--content-top-inset', (hh + 8) + 'px');
                adjustPanesAwayFromTop(hh + 8);
            }
        });
    }
    root.style.setProperty('--titlebar-height', h + 'px');
    root.style.setProperty('--content-top-inset', inset + 'px');
}

function adjustPanesAwayFromTop(safeTop) {
    const val = typeof safeTop === 'number' ? safeTop :
        parseInt(getComputedStyle(document.documentElement)
            .getPropertyValue('--content-top-inset')) || 38;
    document.querySelectorAll('.pane').forEach(el => {
        const top = parseInt(el.style.top || '0', 10) || 0;
        if (top < val) el.style.top = val + 'px';
    });
}

// ===== 启动初始化 =====
(async function init() {
    if (settings.fullscreen) window.api?.window?.setFullscreen(true);
    updateTitlebarSafeArea();
    await refreshPortsCombo();
    const saved = await window.api.config.load();
    state.savedConfig = saved;
    saved.forEach(p => createPane(p.id, p.name));
    await loadCommands();
    document.getElementById('echoSend').checked = true;
    renderCmdGrid();
    window.addEventListener('resize', () => renderCmdGrid());

    const navButtons = document.querySelectorAll('#bottomNav button');
    const pages = document.querySelectorAll('#bottomContent .page');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.page;
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pages.forEach(p => p.style.display = 'none');
            document.getElementById(`page-${target}`).style.display = 'block';
            if (target === 'commands') renderCmdGrid();
        });
    });
    navButtons[0].classList.add('active');
})();
