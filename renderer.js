(function ensureDnDStyle() {
    if (!document.getElementById('cmd-dnd-style')) {
        const s = document.createElement('style');
        s.id = 'cmd-dnd-style';
        s.textContent = '.cmd-drag-float{pointer-events:none!important}';
        document.head.appendChild(s);
    }
})();
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
const animExtremeToggle = document.getElementById('animExtremeToggle');
const nightToggle = $('#nightToggle');
const animToggle = $('#animToggle');
const LOG_MAX_CHARS = 1000000;
const cmdDeleteSel = $('#cmdDeleteSel');
const cmdTableBody = document.getElementById('cmdTableBody');
const cmdSelectAll = document.getElementById('cmdSelectAll');
const useTcp = $('#useTcp');
const tcpFields = $('#tcpFields');
const serialFields = $('#serialFields');
const tcpHost = $('#tcpHost');
const tcpPort = $('#tcpPort');
let commandsSnapshot = null;
let CMD_DND = {
    active: false,
    row: null,
    handle: null,
    floatEl: null,
    placeholder: null,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    tableRect: null,
    lastIndex: -1,
};
let CMD_SCROLL = { container: null, bounds: null, speed: 0, raf: 0, lastY: 0 };

function autoScrollCheck(mouseY) {
    CMD_SCROLL.lastY = mouseY;
    if (!CMD_SCROLL.container) return;
    CMD_SCROLL.bounds = CMD_SCROLL.container.getBoundingClientRect();
    const t = 28;
    let sp = 0;
    if (mouseY < CMD_SCROLL.bounds.top + t) {
        sp = -Math.ceil((CMD_SCROLL.bounds.top + t - mouseY) / 4);
    } else if (mouseY > CMD_SCROLL.bounds.bottom - t) {
        sp = Math.ceil((mouseY - (CMD_SCROLL.bounds.bottom - t)) / 4);
    }
    CMD_SCROLL.speed = Math.max(-16, Math.min(16, sp));
}

function autoScrollTick() {
    if (!CMD_DND.active || !CMD_SCROLL.container) { CMD_SCROLL.raf = 0; return; }
    if (CMD_SCROLL.speed) {
        const c = CMD_SCROLL.container;
        const before = c.scrollTop;
        c.scrollTop = Math.max(0, Math.min(c.scrollHeight - c.clientHeight, before + CMD_SCROLL.speed));
        if (c.scrollTop !== before) {
            const idx = calcInsertIndex(CMD_SCROLL.lastY);
            placePlaceholderAt(idx);
        }
    }
    CMD_SCROLL.raf = requestAnimationFrame(autoScrollTick);
}
function ensureSysModal() {
    let dlg = document.getElementById('sysModal');
    if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'sysModal';
        dlg.className = 'sys-modal';
        dlg.innerHTML = `
        <form method="dialog" class="box">
          <div class="title" id="smTitle">提示</div>
          <div class="msg" id="smMsg"></div>
          <input id="smInput" class="prompt-input" style="display:none" />
          <div class="actions">
            <button value="cancel" id="smCancel">取消</button>
            <button value="ok" id="smOk" class="primary">确定</button>
          </div>
        </form>`;
        document.body.appendChild(dlg);

        dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg.close('cancel'); });
        dlg.addEventListener('click', (e) => {
            if (e.target === dlg) dlg.close('cancel');
        });
        dlg.addEventListener('close', () => {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                try { safeRefocusInput(); } catch { }
            }));
        });
    }
    return {
        dlg,
        title: dlg.querySelector('#smTitle'),
        msg: dlg.querySelector('#smMsg'),
        input: dlg.querySelector('#smInput'),
        ok: dlg.querySelector('#smOk'),
        cancel: dlg.querySelector('#smCancel')
    };
}

function uiAlert(message, { title = '提示', okText = '知道了' } = {}) {
    const { dlg, title: t, msg, input, ok, cancel } = ensureSysModal();
    t.textContent = title;
    msg.innerHTML = '';
    const node = (/\n/.test(message) || message.length > 80) ? document.createElement('pre') : document.createTextNode(message);
    if (node.tagName === 'PRE') node.textContent = message;
    msg.appendChild(node);
    input.style.display = 'none';
    cancel.style.display = 'none';
    ok.textContent = okText;

    return new Promise(resolve => {
        const done = () => resolve();
        ok.onclick = () => { dlg.close('ok'); done(); };
        cancel.onclick = () => { dlg.close('ok'); done(); };
        try { dlg.showModal(); } catch { }
        ok.focus();
    });
}

function uiConfirm(message, { title = '确认', okText = '确定', cancelText = '取消', danger = false } = {}) {
    const { dlg, title: t, msg, input, ok, cancel } = ensureSysModal();
    t.textContent = title;
    msg.innerHTML = '';
    const node = (/\n/.test(message) || message.length > 80) ? document.createElement('pre') : document.createTextNode(message);
    if (node.tagName === 'PRE') node.textContent = message;
    msg.appendChild(node);
    input.style.display = 'none';
    cancel.style.display = '';
    ok.textContent = okText;
    cancel.textContent = cancelText;
    ok.classList.toggle('danger', !!danger);

    return new Promise(resolve => {
        ok.onclick = () => { dlg.close('ok'); resolve(true); };
        cancel.onclick = () => { dlg.close('cancel'); resolve(false); };
        try { dlg.showModal(); } catch { }
        cancel.focus();
    });
}
function logToPane(pane, text) {
    const msg = String(text ?? '');
    pane.textBuffer += msg;
    pane.hexBuffer += msg;
    pane.chunks.push({ text: msg, hex: msg, isEcho: false });
    appendTextTail(pane, msg);
}
function uiPrompt(message, { title = '输入', okText = '确定', cancelText = '取消', defaultValue = '' } = {}) {
    const { dlg, title: t, msg, input, ok, cancel } = ensureSysModal();
    t.textContent = title;
    msg.textContent = message || '';
    input.style.display = '';
    input.value = defaultValue || '';
    ok.textContent = okText;
    cancel.textContent = cancelText;

    return new Promise(resolve => {
        ok.onclick = () => { const v = input.value; dlg.close('ok'); resolve(v); };
        cancel.onclick = () => { dlg.close('cancel'); resolve(''); };
        input.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); };
        try { dlg.showModal(); } catch { }
        setTimeout(() => input.select(), 0);
    });
}

window._nativeAlert = window.alert;
window.alert = (msg) => { uiAlert(String(msg)); };

function preventSelectWhileDragging(e) {
    if (CMD_DND.active) e.preventDefault();
}

function autoScrollStart() {
    if (CMD_SCROLL.raf) return;
    CMD_SCROLL.container = document.querySelector('#dlgCmdEdit .cmd-table-wrap');
    if (!CMD_SCROLL.container) return;
    CMD_SCROLL.bounds = CMD_SCROLL.container.getBoundingClientRect();
    CMD_SCROLL.raf = requestAnimationFrame(autoScrollTick);
}

function autoScrollStop() {
    if (CMD_SCROLL.raf) cancelAnimationFrame(CMD_SCROLL.raf);
    CMD_SCROLL.raf = 0;
    CMD_SCROLL.speed = 0;
    CMD_SCROLL.container = null;
}

function listRows() {
    return Array.from(cmdTableBody.querySelectorAll('tr')).filter(tr => tr !== CMD_DND.placeholder);
}
function calcInsertIndex(mouseY) {
    const rows = listRows();
    for (let i = 0; i < rows.length; i++) {
        const box = rows[i].getBoundingClientRect();
        const mid = box.top + box.height / 2;
        if (mouseY < mid) return i;
    }
    return rows.length;
}
function placePlaceholderAt(index) {
    const rows = listRows();
    const old = CMD_DND.lastIndex;
    CMD_DND.lastIndex = index;

    if (index >= rows.length) cmdTableBody.appendChild(CMD_DND.placeholder);
    else cmdTableBody.insertBefore(CMD_DND.placeholder, rows[index]);

    if (old !== -1 && old !== index) {
        const [from, to] = old < index ? [old, index - 1] : [index, old - 1];
        for (let i = from; i <= to; i++) {
            const tr = listRows()[i];
            if (!tr) continue;
            tr.classList.remove('anim-up', 'anim-down');
            void tr.offsetHeight;
            tr.classList.add(old < index ? 'anim-up' : 'anim-down');
            setTimeout(() => tr.classList.remove('anim-up', 'anim-down'), 160);
        }
    }
}
function startCmdDrag(e, tr, handle) {
    if (CMD_DND.active) return;

    const rect = tr.getBoundingClientRect();
    CMD_DND.active = true;
    CMD_DND.row = tr;
    CMD_DND.handle = handle;
    CMD_DND.offsetX = e.clientX - rect.left;
    CMD_DND.offsetY = e.clientY - rect.top;
    CMD_DND.lastIndex = -1;
    CMD_DND.rowH = rect.height;
    document.body.classList.add('cmd-dragging');

    const ph = document.createElement('tr');
    ph.className = 'cmd-drag-placeholder';
    ph.style.height = rect.height + 'px';
    CMD_DND.placeholder = ph;
    tr.parentNode.insertBefore(ph, tr.nextSibling);

    const float = document.createElement('div');
    float.className = 'cmd-drag-float';
    float.style.width = rect.width + 'px';

    const host = document.getElementById('dlgCmdEdit') || document.body;
    const hostRect = host.getBoundingClientRect();
    CMD_DND.hostEl = host;
    CMD_DND.hostRect = hostRect;

    CMD_DND.baseLeft = rect.left - hostRect.left;

    const wrap = document.querySelector('#dlgCmdEdit .cmd-table-wrap');
    const rows = Array.from(cmdTableBody.querySelectorAll('tr')).filter(r => r !== ph);
    let topLimitAbs, bottomLimitAbs;
    if (rows.length) {
        const firstRect = rows[0].getBoundingClientRect();
        const lastRect = rows[rows.length - 1].getBoundingClientRect();
        topLimitAbs = firstRect.top;
        bottomLimitAbs = lastRect.bottom;
    } else {
        const wr = (wrap ? wrap.getBoundingClientRect() : hostRect);
        topLimitAbs = wr.top;
        bottomLimitAbs = wr.bottom;
    }
    CMD_DND.boundsY = {
        top: topLimitAbs - hostRect.top,
        bottom: bottomLimitAbs - hostRect.top
    };
    CMD_DND.boundsAbs = { top: topLimitAbs, bottom: bottomLimitAbs };

    float.style.left = Math.round(CMD_DND.baseLeft) + 'px';
    float.style.top = Math.round(e.clientY - hostRect.top - CMD_DND.offsetY) + 'px';
    float.style.zIndex = '2147483647';

    const table = document.createElement('table');
    table.className = 'cmd-table';
    table.style.borderCollapse = 'collapse';
    table.style.width = rect.width + 'px';

    const tbody = document.createElement('tbody');
    const ghost = tr.cloneNode(true);
    ghost.style.opacity = '1';
    ghost.style.display = '';
    tbody.appendChild(ghost);
    table.appendChild(tbody);

    float.appendChild(table);
    float.style.pointerEvents = 'none';

    host.appendChild(float);
    CMD_DND.floatEl = float;

    tr.style.display = 'none';
    placePlaceholderAt(calcInsertIndex(e.clientY));

    autoScrollStart();
    autoScrollCheck(e.clientY);
    document.addEventListener('selectstart', preventSelectWhileDragging, true);
    document.body.style.userSelect = 'none';
}

function moveCmdDrag(e) {
    CMD_DND.lastMouseY = e.clientY;
    autoScrollCheck(e.clientY);
    if (!CMD_DND.active) return;

    let hostRect = CMD_DND.hostRect;
    if (!hostRect || !CMD_DND.hostEl) {
        CMD_DND.hostEl = document.getElementById('dlgCmdEdit') || document.body;
        hostRect = CMD_DND.hostEl.getBoundingClientRect();
        CMD_DND.hostRect = hostRect;
    }

    const nx = CMD_DND.baseLeft;

    let ny = e.clientY - hostRect.top - CMD_DND.offsetY;

    const minY = (CMD_DND.boundsY && Number.isFinite(CMD_DND.boundsY.top)) ? CMD_DND.boundsY.top : ny;
    const maxY = (CMD_DND.boundsY && Number.isFinite(CMD_DND.boundsY.bottom)) ? (CMD_DND.boundsY.bottom - (CMD_DND.rowH || 0)) : ny;
    ny = Math.max(minY, Math.min(maxY, ny));

    CMD_DND.floatEl.style.left = Math.round(nx) + 'px';
    CMD_DND.floatEl.style.top = Math.round(ny) + 'px';

    const cy = Math.max(
        (CMD_DND.boundsAbs?.top ?? e.clientY) + 1,
        Math.min(e.clientY, (CMD_DND.boundsAbs?.bottom ?? e.clientY) - 1)
    );
    const idx = calcInsertIndex(cy);
    placePlaceholderAt(idx);
}


function endCmdDrag(force = false) {
    if (!CMD_DND.active && !force) return;

    const row = CMD_DND.row;
    const ph = CMD_DND.placeholder;
    const flt = CMD_DND.floatEl;

    if (CMD_DND.active && row && ph && ph.parentNode === cmdTableBody) {
        cmdTableBody.insertBefore(row, ph);
    }
    if (row) row.style.display = '';

    if (ph && ph.parentNode) ph.remove();
    if (flt && flt.parentNode) flt.remove();

    document.querySelectorAll('.cmd-drag-float,.cmd-drag-placeholder').forEach(n => n.remove());

    if (CMD_DND.active) {
        const order = Array.from(cmdTableBody.querySelectorAll('tr')).map(x => x.dataset.id);
        state.commands = order.map(id => state.commands.find(c => c.id === id)).filter(Boolean);
    }

    autoScrollStop();
    document.body.classList.remove('cmd-dragging');

    CMD_DND.active = false;
    CMD_DND.row = CMD_DND.handle = CMD_DND.floatEl = CMD_DND.placeholder = null;
    CMD_DND.lastIndex = -1;
    document.removeEventListener('selectstart', preventSelectWhileDragging, true);
    document.body.style.userSelect = '';
}

window.addEventListener('pointermove', moveCmdDrag, true);
window.addEventListener('pointerup', endCmdDrag, true);

let draggingRow = null;

// 设置持久化
const SETTINGS_KEY = 'appSettings';
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return {
            fullscreen: !!s.fullscreen,
            dark: !!s.dark,
            anim: !!s.anim,
            animExtreme: !!s.animExtreme,
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
    if (animExtremeToggle) animExtremeToggle.checked = !!settings.animExtreme;
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
if (animExtremeToggle) {
    animExtremeToggle.addEventListener('change', () => {
        settings.animExtreme = animExtremeToggle.checked;
        saveSettings();
    });
}
// ===== 动画 & 粒子效果 =====
let fxLayer = null;
let fxEmitActive = 0;
let fxPile = null; // { left, right, baseY, binW, count, heights: Float32Array }
let fxCanvas, fxCtx, fxDPR = 1, fxRunning = false, fxParticles = [];
let fxLastEmitAt = 0;
const FX_HOLD_AFTER_EMIT_MS = 3000;
const FX_FADE_MS_EXTREME = 1600;
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
    const rand = (n) => (Math.random() * 2 - 1) * n;
    const A = Math.max(2, maxAmp);
    const rot = () => (Math.random() * 2 - 1) * 2;

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
    t.addEventListener('animationend', () => t.classList.remove('fx-shake-rand'), { once: true });
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
    ensureFxCanvas();
    if (fxRunning) return;
    fxRunning = true;

    let last = performance.now();

    const loop = (now) => {
        if (!fxRunning) return;

        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;

        // 画布复位 & 清屏
        fxCtx.setTransform(fxDPR, 0, 0, fxDPR, 0, 0);
        fxCtx.clearRect(0, 0, fxCanvas.width / fxDPR, fxCanvas.height / fxDPR);

        // 边界
        const bp = document.getElementById('bottomPanel')?.getBoundingClientRect();
        const wsr = document.getElementById('workspace')?.getBoundingClientRect();
        const landY = (bp ? bp.top : window.innerHeight - 190);
        const boundLeft = wsr ? wsr.left : 0;
        const boundRight = wsr ? wsr.right : window.innerWidth;
        const boundTop = wsr ? wsr.top : 0;

        // 仅在“更惊人的动画”开启时启用堆栈
        if (settings.animExtreme) {
            const binW = 4;
            const pileLeft = boundLeft;
            const pileRight = boundRight;
            const count = Math.max(1, Math.floor((pileRight - pileLeft) / binW));
            if (!fxPile || fxPile.count !== count || fxPile.left !== pileLeft || fxPile.right !== pileRight || fxPile.baseY !== landY) {
                fxPile = {
                    left: pileLeft,
                    right: pileRight,
                    baseY: landY,
                    binW,
                    count,
                    heights: new Float32Array(count)
                };
            }
        } else {
            fxPile = null;
        }

        // —— 极致模式的“统一延时淡出”判定 —— 
        const extremeHold = settings.animExtreme && (fxEmitActive > 0 || (now - fxLastEmitAt < FX_HOLD_AFTER_EMIT_MS));
        const extremeFadeT = Math.max(0, now - (fxLastEmitAt + FX_HOLD_AFTER_EMIT_MS)); // 距开始淡出的毫秒数
        const extremeFadeK = settings.animExtreme
            ? Math.max(0, 1 - (extremeFadeT / FX_FADE_MS_EXTREME))
            : 1; // 1→0

        const g = 1800;

        fxParticles = fxParticles.filter(p => {
            if (!p.landed) {
                // 受力
                p.vy += g * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;

                // 左/右/上反弹
                if (p.x - p.size < boundLeft) { p.x = boundLeft + p.size; p.vx = -p.vx * 0.55; }
                if (p.x + p.size > boundRight) { p.x = boundRight - p.size; p.vx = -p.vx * 0.55; }
                if (p.y - p.size < boundTop) { p.y = boundTop + p.size; p.vy = -p.vy * 0.55; }

                // 触底
                if (p.y + p.size >= landY - 0.5) {
                    if (settings.animExtreme && fxPile) {
                        const idx = Math.max(0, Math.min(fxPile.count - 1, Math.floor((p.x - fxPile.left) / fxPile.binW)));
                        const hC = fxPile.heights[idx] || 0;
                        const hL = idx > 0 ? fxPile.heights[idx - 1] : hC;
                        const hR = idx < fxPile.count - 1 ? fxPile.heights[idx + 1] : hC;
                        const avgNeighbor = (hL + hC + hR) / 3;
                        const packing = 1.05;
                        const newTopH = Math.max(hC, avgNeighbor) + p.size * packing;

                        p.y = fxPile.baseY - newTopH + p.size * (packing - 1);
                        p.vy = 0;
                        p.vx = 0;              // 极致模式：落地即静止，不再漂移
                        p.landed = true;
                        p.landTime = now;
                        fxPile.heights[idx] = newTopH;
                    } else {
                        p.y = landY - p.size;
                        p.vy = 0;
                        p.landed = true;
                        p.landTime = now;
                    }
                }
            } else {
                // —— 已着陆 —— 
                if (settings.animExtreme) {
                    // 极致模式：静止堆积，不做水平滑移
                    p.vx = 0; // 防御式清零
                    // 延时淡出：最后一次发射 3 秒内不降 alpha，之后统一按极致淡出曲线
                    p.alpha = extremeHold ? 1 : extremeFadeK;

                } else {
                    // 普通模式：略微滑移 + 个人淡出
                    p.vx *= 0.92;
                    p.x += p.vx * dt;
                    if (p.x - p.size < boundLeft) p.x = boundLeft + p.size;
                    if (p.x + p.size > boundRight) p.x = boundRight - p.size;

                    const t = (now - p.landTime) / 1000;
                    p.alpha = Math.max(0, 1 - t / 1.0);
                }
            }

            // 绘制（落地后不画长尾，避免“漂浮感”）
            const grd = fxCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 1.6);
            grd.addColorStop(0, `rgba(255,220,130,${0.9 * p.alpha})`);
            grd.addColorStop(0.5, `rgba(255,190,70,${0.7 * p.alpha})`);
            grd.addColorStop(1, `rgba(255,160,20,0)`);
            fxCtx.fillStyle = grd;
            fxCtx.beginPath();
            fxCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            fxCtx.fill();

            if (!p.landed) {
                const tailK = 1;
                fxCtx.strokeStyle = `rgba(255,200,80,${0.8 * p.alpha * tailK})`;
                fxCtx.lineWidth = Math.max(1, p.size * 0.4 * tailK);
                fxCtx.beginPath();
                fxCtx.moveTo(p.x - p.vx * 0.04 * tailK, p.y - p.vy * 0.04 * tailK);
                fxCtx.lineTo(p.x, p.y);
                fxCtx.stroke();
            }

            // 存活
            return p.alpha > 0 && p.x > -50 && p.x < window.innerWidth + 50;
        });

        // 全部消失 → 关闭循环并重置堆
        if (fxParticles.length === 0) { fxRunning = false; fxPile = null; return; }

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
function goldenBurstAtRect(rect, count = 160) {
    if (!settings.anim) return;
    ensureFxCanvas();

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    for (let i = 0; i < count; i++) {
        const speed = 520 + Math.random() * 620;
        const angle = Math.random() * Math.PI * 2;
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed * 0.85 - 60;
        fxParticles.push({
            x: cx, y: cy, vx, vy,
            size: 1.6 + Math.random() * 2.4,
            alpha: 1,
            landed: false,
            landTime: 0
        });
    }
    startFxLoop();
}
function emitBurstDuring(rect, ms = 900, every = 70, base = 32, spread = 28) {
    const end = performance.now() + ms;
    fxEmitActive++;
    const tick = () => {
        const now = performance.now();
        if (now > end) {
            fxEmitActive = Math.max(0, fxEmitActive - 1);
            if (settings.animExtreme && fxEmitActive === 0) {
                fxLastEmitAt = performance.now();
            }
            return;
        }

        const n = base + ((Math.random() * spread) | 0);
        goldenBurstAtRect(rect, n);
        setTimeout(tick, every);
    };
    setTimeout(tick, 0);
}

function triggerExtremeSerialToggleFx() {
    if (!settings.animExtreme) return;

    const panes = Array
        .from(document.querySelectorAll('.pane'))
        .filter(p => p.offsetParent !== null && p.offsetWidth > 0 && p.offsetHeight > 0);

    panes.forEach(p => {
        p.classList.remove('fx-spin');
        void p.offsetWidth;
        p.classList.add('fx-spin');
    });

    panes.forEach(p => {
        const r = p.getBoundingClientRect();
        emitBurstDuring(r, 900, 70, 28, 18);
    });

    startFxLoop();
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
function applyBottomPanelForPane(pane) {
    const btnTab = document.querySelector('#bottomNav button[data-page="serial"]');
    const serialPage = document.getElementById('page-serial');
    if (!btnTab || !serialPage) return;

    const rows = serialPage.querySelectorAll('.row');
    const serialParamsRow = rows && rows[1];

    const isTcp = !!pane && (pane.type === 'tcp' || (pane.info?.path || '').startsWith('tcp://'));
    btnTab.textContent = isTcp ? '端口' : '串口';
    if (serialParamsRow) serialParamsRow.style.display = isTcp ? 'none' : '';
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
function updateDeleteSelectedBtn() {
    const btn = document.getElementById('cmdDeleteSel');
    const any = !!cmdTableBody?.querySelector('.rowSel:checked');
    if (!btn) return;
    btn.disabled = !any;
    btn.classList.toggle('danger', any);
}

const btnNew = $('#btnNew');
const btnRefreshPorts = $('#btnRefreshPorts');
const btnScriptStop = $('#btnScriptStop');
let currentRunId = null;
const SIDEBAR_COLLAPSED_W = 56;
const board_margin = 2;
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
    panes: new Map(),
    activeId: null,
    knownPorts: [],
    buffers: new Map(),
    savedConfig: [],

    commands: [],
    cmdPage: 0,
    cmdCols: 1,
    cmdRows: 1,
    cmdIntervalMap: new Map(),

    paneOrder: []
};

function applyPaneZOrder() {
    const base = 100;
    state.paneOrder.forEach((id, idx) => {
        const p = state.panes.get(id);
        if (p && p.el) p.el.style.zIndex = String(base + (state.paneOrder.length - idx));
    });
}

function promotePaneToFront(id) {
    const arr = state.paneOrder;
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    arr.unshift(id);
    state.paneOrder = arr.filter(x => state.panes.has(x));
    applyPaneZOrder();
}

function exportPanelsConfig() {
    return Array.from(state.panes.values()).map(p => ({
        id: p.info.path,
        path: p.info.path,
        name: p.info.name,
        type: p.type || ((p.info.path || '').startsWith('tcp://') ? 'tcp' : 'serial'),
        options: p.options,
        left: p.el.style.left || "30px",
        top: p.el.style.top || "30px",
        width: p.el.style.width || "420px",
        height: p.el.style.height || "240px",
        hidden: p.el.classList.contains('hidden')
    }));
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function trimPane(pane) {
    const MAX = LOG_MAX_CHARS;
    const LIMIT = MAX * 1.2;
    if (pane.textBuffer.length <= LIMIT && pane.hexBuffer.length <= LIMIT) return;

    while (pane.textBuffer.length > MAX && pane.chunks && pane.chunks.length > 1) {
        const c = pane.chunks.shift();
        pane.textBuffer = pane.textBuffer.slice(c.text.length);
        pane.hexBuffer = pane.hexBuffer.slice(c.hex.length);
    }
}

function appendTextTail(pane, text) {
    const body = pane.el.querySelector('.body');
    const last = body.lastChild;
    if (pane.tailTextNode && last === pane.tailTextNode) {
        pane.tailTextNode.appendData(text);
    } else {
        const tn = document.createTextNode(text);
        body.appendChild(tn);
        pane.tailTextNode = tn;
        pane.bodyTextNode = tn;
    }
    if (pane.autoScroll) body.scrollTop = body.scrollHeight;
}

function appendNodeTail(pane, node) {
    const body = pane.el.querySelector('.body');
    body.appendChild(node);
    pane.tailTextNode = null;
    if (pane.autoScroll) body.scrollTop = body.scrollHeight;
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
    if (!currentScript) return uiAlert('未选择脚本');
    const ok = await uiConfirm(`删除脚本：${currentScript} ?`, { danger: true, okText: '删除' });
    if (!ok) return;
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

    const ts = nowTs();
    const addText = `[${ts}]\n${text}\n`;

    pane.textBuffer += addText;
    pane.hexBuffer += addText;
    pane.chunks.push({ text: addText, hex: addText, isEcho: true });
    trimPane(pane);

    const el = document.createElement('span');
    el.className = 'echo-line';
    el.textContent = addText;
    appendNodeTail(pane, el);
}

function setActive(id) {
    state.activeId = id;
    $$('.pane').forEach(p => p.classList.remove('active'));
    const pane = state.panes.get(id);
    if (pane) {
        pane.el.classList.add('active');
        activeLabel.textContent = pane.info.name;
        fillPortSelect(id);
        promotePaneToFront(id);
        applyBottomPanelForPane(pane); // ← 新增
    } else {
        activeLabel.textContent = '（未选择）';
        applyBottomPanelForPane(null); // ← 新增
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
    const isTcpId = typeof portPath === 'string' && portPath.startsWith('tcp://');
    const tcpInfo = isTcpId ? (() => { const s = portPath.slice(6); const i = s.lastIndexOf(':'); return { host: s.slice(0, i), port: parseInt(s.slice(i + 1), 10) }; })() : null;
    const paneType = isTcpId ? 'tcp' : 'serial';
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
        <button class="btnToggle" title="${paneType === 'tcp' ? '打开/关闭连接' : '打开/关闭串口'}">${paneType === 'tcp' ? '打开连接' : '打开串口'}</button>
        <button class="btnHex" title="切换Hex显示">HEX显示</button>
        <button class="btnHide" title="隐藏面板">隐藏</button>
        <button class="btnPop" title="弹出独立窗口">弹出</button>
      </div>
    </div>
    <div class="body" data-id="${id}"></div>
    <div class="resizer t"></div>
    <div class="resizer r"></div>
    <div class="resizer b"></div>
    <div class="resizer l"></div>
    <div class="resizer tl"></div>
    <div class="resizer tr"></div>
    <div class="resizer bl"></div>
    <div class="resizer br"></div>
  `;
    panesEl.appendChild(el);
    const bodyEl = el.querySelector('.body');
    let autoScrollFlag = true;
    const isAtBottom = () => (bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 4);
    bodyEl.addEventListener('scroll', () => { autoScrollFlag = isAtBottom(); });

    const btnToggle = el.querySelector('.btnToggle');
    btnToggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const pane = state.panes.get(id);
        if (!pane) return;

        if (pane.open) {
            if (pane.type === 'tcp') await window.api.tcp.close(id);
            else await window.api.serial.close(id);
            pane.open = false;
            btnToggle.textContent = pane.type === 'tcp' ? '打开连接' : '打开串口';
        } else {
            if (pane.type === 'tcp') {
                btnToggle.textContent = '正在连接…';
                const r = await window.api.tcp.open(tcpInfo.host, tcpInfo.port, null);
                if (r && r.ok) {
                    pane.open = true;
                    btnToggle.textContent = '关闭连接';
                    if (!pane._openNotified) {
                        const add = '\n[已打开]\n';
                        pane.textBuffer += add; pane.hexBuffer += add;
                        pane.chunks.push({ text: add, hex: add, isEcho: false });
                        appendTextTail(pane, add);
                        pane._openNotified = true;
                    }
                } else {
                    btnToggle.textContent = '打开连接';
                    const msg = '\n[错误] ' + (r?.error || '连接失败') + '\n';
                    pane.textBuffer += msg; pane.hexBuffer += msg;
                    pane.chunks.push({ text: msg, hex: msg, isEcho: false });
                    appendTextTail(pane, msg);
                }
            } else {
                pane.options = {
                    baudRate: parseInt(baud.value, 10),
                    dataBits: parseInt(databits.value, 10),
                    stopBits: parseInt(stopbits.value, 10),
                    parity: parity.value
                };
                const r = await window.api.serial.open(id, pane.options);
                if (r && r.ok) {
                    pane.open = true;
                    btnToggle.textContent = '关闭串口';
                } else {
                    btnToggle.textContent = '打开串口';
                    const msg = '\n[错误] ' + (r?.error || '打开失败') + '\n';
                    pane.textBuffer += msg; pane.hexBuffer += msg;
                    pane.chunks.push({ text: msg, hex: msg, isEcho: false });
                    appendTextTail(pane, msg);
                }
            }
        }
        refreshPanelList();
        window.api.config.save(exportPanelsConfig());
        triggerExtremeSerialToggleFx();
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
            titleEl.style.cursor = 'grab';
            window.api.config.save(exportPanelsConfig());
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 50);
        }
    }
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('mouseup', endDrag, true);
    window.addEventListener('mouseleave', endDrag, true);

    titleEl.addEventListener('pointerdown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        setActive(id);
        pressed = true;
        dragging = false;
        titleEl.setPointerCapture(e.pointerId);
        titleEl.style.cursor = 'grabbing';
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

        const leftMin = SIDEBAR_COLLAPSED_W + board_margin;

        const maxLeft = Math.max(leftMin, wsW - el.offsetWidth) - 2;
        const maxTop = Math.max(0, wsH - el.offsetHeight) - 2;

        let newLeft = startLeft + dx;
        let newTop = startTop + dy;

        if (newLeft < leftMin) newLeft = leftMin;
        if (newLeft > maxLeft) newLeft = maxLeft;
        if (newTop < 2) newTop = 2;
        if (newTop > maxTop) newTop = maxTop;

        el.style.left = `${newLeft}px`;
        el.style.top = `${newTop}px`;
    });


    titleEl.addEventListener('pointerup', endDrag);
    titleEl.addEventListener('pointercancel', endDrag);
    titleEl.addEventListener('lostpointercapture', endDrag);
    window.addEventListener('blur', endDrag);

    window.addEventListener('pointerup', endDrag);

    el.addEventListener('click', (e) => {
        if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    const handles = el.querySelectorAll('.resizer');
    let rs = { active: false, dir: '', sx: 0, sy: 0, sl: 0, st: 0, sw: 0, sh: 0 };

    function endResize() {
        if (!rs.active) return;
        rs.active = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        window.api.config.save(exportPanelsConfig());
    }

    function onResizeMove(e) {
        if (!rs.active) return;

        const ws = document.getElementById('workspace');
        const wsW = ws.clientWidth, wsH = ws.clientHeight;
        const minW = 200, minH = 120;

        const leftMin = (sidebarEl?.offsetWidth || SIDEBAR_COLLAPSED_W) + board_margin;
        const topMin = 0;

        let dx = e.clientX - rs.sx;
        let dy = e.clientY - rs.sy;

        let left = rs.sl, top = rs.st, w = rs.sw, h = rs.sh;

        if (rs.dir.includes('r')) {
            const maxW = wsW - rs.sl;
            w = Math.max(minW, Math.min(maxW, rs.sw + dx));
        }

        if (rs.dir.includes('b')) {
            const maxH = wsH - rs.st;
            h = Math.max(minH, Math.min(maxH, rs.sh + dy));
        }

        if (rs.dir.includes('l')) {
            const leftMax = rs.sl + rs.sw - minW;
            const leftNew = Math.max(leftMin, Math.min(leftMax, rs.sl + dx));
            w = rs.sw + (rs.sl - leftNew);
            left = leftNew;
        }

        if (rs.dir.includes('t')) {
            const topMax = rs.st + rs.sh - minH;
            const topNew = Math.max(topMin, Math.min(topMax, rs.st + dy));
            h = rs.sh + (rs.st - topNew);
            top = topNew;
        }

        if (left + w > wsW) w = Math.max(minW, wsW - left);
        if (top + h > wsH) h = Math.max(minH, wsH - top);

        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
    }


    handles.forEach(h => {
        h.addEventListener('pointerdown', (e) => {
            rs.active = true;
            document.body.style.userSelect = 'none';
            document.body.style.cursor = getComputedStyle(h).cursor || 'default';
            rs.dir = Array.from(h.classList).find(c => /^(t|r|b|l|tl|tr|bl|br)$/.test(c)) || 'br';
            rs.sx = e.clientX; rs.sy = e.clientY;
            rs.sl = parseInt(el.style.left || '0', 10) || 0;
            rs.st = parseInt(el.style.top || '0', 10) || 0;
            rs.sw = el.offsetWidth;
            rs.sh = el.offsetHeight;
            h.setPointerCapture(e.pointerId);
        });
    });

    window.addEventListener('pointermove', onResizeMove, true);
    window.addEventListener('pointerup', endResize, true);
    window.addEventListener('blur', endResize, true);


    state.panes.set(id, {
        el,
        info: { path: id, name: name || id },
        type: paneType,
        options: { baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' },
        open: false,
        viewMode: 'text',
        logs: [],

        chunks: [],
        bodyTextNode: null,
        tailTextNode: null,
        textBuffer: '',
        hexBuffer: '',
        groupTimer: null,
        groupOpen: false,
        autoScroll: true
    });

    const paneObj = state.panes.get(id);
    if (paneObj) paneObj.autoScroll = autoScrollFlag;
    bodyEl.addEventListener('scroll', () => {
        const p = state.panes.get(id);
        if (p) p.autoScroll = (bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 4);
    });


    const saved = (state.savedConfig || []).find(p => (p.id || p.path) === id);
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
        li.className = 'port-row';

        const kind = pane.type === 'tcp' ? '连接' : '串口';

        const statusBtn = document.createElement('button');
        statusBtn.className = 'port-status ' + (pane.open ? 'open' : 'closed');
        statusBtn.title = pane.open ? `关闭${kind}` : `打开${kind}`;
        statusBtn.onclick = async (e) => {
            e.stopPropagation();
            const p = state.panes.get(id);
            if (!p) return;
            if (p.open) {
                if (p.type === 'tcp') await window.api.tcp.close(id);
                else await window.api.serial.close(id);
                p.open = false;
            } else {
                if (p.type === 'tcp') {
                    const s = p.info.path.slice(6); const i = s.lastIndexOf(':');
                    const r = await window.api.tcp.open(s.slice(0, i), parseInt(s.slice(i + 1), 10), null);
                    if (!(r && r.ok)) { refreshPanelList(); return; }
                } else {
                    p.options = {
                        baudRate: parseInt(baud.value, 10),
                        dataBits: parseInt(databits.value, 10),
                        stopBits: parseInt(stopbits.value, 10),
                        parity: parity.value
                    };
                    const r = await window.api.serial.open(id, p.options);
                    if (!(r && r.ok)) { refreshPanelList(); return; }
                }
                p.open = true;
                const btn = p.el?.querySelector('.btnToggle');
                if (btn) btn.textContent = (p.type === 'tcp') ? '关闭连接' : '关闭串口';
                if (!p._openNotified) {
                    const add = '\n[已打开]\n';
                    p.textBuffer += add; p.hexBuffer += add;
                    p.chunks.push({ text: add, hex: add, isEcho: false });
                    appendTextTail(p, add);
                    p._openNotified = true;
                }
            }
            refreshPanelList();
        };

        const nameEl = document.createElement('span');
        nameEl.className = 'port-name';
        nameEl.title = pane.info.name || id;
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = pane.info.name || id;
        nameEl.appendChild(label);
        nameEl.onclick = () => { pane.el.classList.remove('hidden'); setActive(id); };
        const applyMarquee = () => {
            const delta = Math.max(0, label.scrollWidth - nameEl.clientWidth);
            nameEl.classList.toggle('marquee', delta > 0);
            nameEl.style.setProperty('--deltaX', `${delta}px`);
        };
        requestAnimationFrame(applyMarquee);
        new ResizeObserver(applyMarquee).observe(nameEl);

        const act = document.createElement('div');
        act.className = 'actions';

        const bClear = document.createElement('button');
        bClear.textContent = '清空';
        bClear.onclick = async () => {
            const ok = await uiConfirm(`确定要清空面板 “${pane.info.name}” 的数据吗？`, { danger: true, okText: '清空' });
            if (!ok) { safeRefocusInput(); return; }
            const body = pane.el.querySelector('.body');
            body.innerHTML = '';
            pane.logs = []; pane.chunks = [];
            pane.textBuffer = ''; pane.hexBuffer = '';
            pane.bodyTextNode = null; pane.tailTextNode = null;
            safeRefocusInput();
        };

        const bDel = document.createElement('button');
        bDel.textContent = '删除';
        bDel.onclick = async () => {
            const ok = await uiConfirm(`确定删除面板 “${pane.info.name}” 吗？`, { danger: true, okText: '删除' });
            if (!ok) { safeRefocusInput(); return; }
            pane.el.remove();
            state.panes.delete(id);
            window.api.config.save(exportPanelsConfig());
            if (state.activeId === id) setActive(null);
            refreshPanelList();
            safeRefocusInput();
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
    const pane = state.panes.get(id);
    if (!pane) return;
    if (!state.buffers.has(id)) state.buffers.set(id, { timer: null, open: false });
    const g = state.buffers.get(id);
    const appendChunk = (withTs) => {
        const ts = nowTs();
        const textStr = formatBytes(bytes, 'text');
        const hexStr = formatBytes(bytes, 'hex');
        const addText = (withTs ? `[${ts}] ` : '') + textStr;
        const addHex = (withTs ? `[${ts}] ` : '') + hexStr;
        pane.textBuffer += addText;
        pane.hexBuffer += addHex;
        pane.chunks.push({ text: addText, hex: addHex, isEcho: false });
        trimPane(pane);
        const piece = (pane.viewMode === 'hex') ? addHex : addText;
        appendTextTail(pane, piece);
    };
    if (bufferTime > 0) {
        if (!g.open) { g.open = true; appendChunk(true); }
        else { appendChunk(false); }
        if (g.timer) clearTimeout(g.timer);
        g.timer = setTimeout(() => {
            if (!pane.textBuffer.endsWith('\n')) {
                pane.textBuffer += '\n';
                pane.hexBuffer += '\n';
                pane.chunks.push({ text: '\n', hex: '\n', isEcho: false });
                appendTextTail(pane, '\n');
            }
            g.open = false;
            g.timer = null;
        }, bufferTime);
    } else {
        appendChunk(true);
        if (!pane.textBuffer.endsWith('\n')) {
            pane.textBuffer += '\n';
            pane.hexBuffer += '\n';
            pane.chunks.push({ text: '\n', hex: '\n', isEcho: false });
            appendTextTail(pane, '\n');
        }
    }

});

window.api.tcp.onData(({ id, bytes }) => {
    const bufferTime = parseInt(bufferInput.value || '0', 10);
    const pane = state.panes.get(id);
    if (!pane) return;
    if (!state.buffers.has(id)) state.buffers.set(id, { timer: null, open: false });
    const g = state.buffers.get(id);
    const appendChunk = (withTs) => {
        const ts = nowTs();
        const textStr = formatBytes(bytes, 'text');
        const hexStr = formatBytes(bytes, 'hex');
        const addText = (withTs ? `[${ts}] ` : '') + textStr;
        const addHex = (withTs ? `[${ts}] ` : '') + hexStr;
        pane.textBuffer += addText;
        pane.hexBuffer += addHex;
        pane.chunks.push({ text: addText, hex: addHex, isEcho: false });
        trimPane(pane);
        const piece = (pane.viewMode === 'hex') ? addHex : addText;
        appendTextTail(pane, piece);
    };
    if (bufferTime > 0) {
        if (!g.open) { g.open = true; appendChunk(true); }
        else { appendChunk(false); }
        if (g.timer) clearTimeout(g.timer);
        g.timer = setTimeout(() => {
            if (!pane.textBuffer.endsWith('\n')) {
                pane.textBuffer += '\n';
                pane.hexBuffer += '\n';
                pane.chunks.push({ text: '\n', hex: '\n', isEcho: false });
                appendTextTail(pane, '\n');
            }
            g.open = false;
            g.timer = null;
        }, bufferTime);
    } else {
        appendChunk(true);
        if (!pane.textBuffer.endsWith('\n')) {
            pane.textBuffer += '\n';
            pane.hexBuffer += '\n';
            pane.chunks.push({ text: '\n', hex: '\n', isEcho: false });
            appendTextTail(pane, '\n');
        }
    }
});

function showData(id, bytes) {
    const pane = state.panes.get(id);
    if (!pane) return;
    const ts = nowTs();
    const textStr = formatBytes(bytes, 'text');
    const hexStr = formatBytes(bytes, 'hex');
    const addText = `[${ts}]\n` + textStr + '\n';
    const addHex = `[${ts}]\n` + hexStr + '\n';

    pane.textBuffer += addText;
    pane.hexBuffer += addHex;
    pane.chunks.push({ text: addText, hex: addHex, isEcho: false });
    trimPane(pane);

    const piece = (pane.viewMode === 'hex') ? addHex : addText;
    appendTextTail(pane, piece);
}


function redrawPane(id) {
    const pane = state.panes.get(id);
    if (!pane) return;
    const body = pane.el.querySelector('.body');

    const mode = (pane.viewMode === 'hex') ? 'hex' : 'text';
    body.innerHTML = '';

    const frag = document.createDocumentFragment();
    let acc = '';
    for (const c of (pane.chunks || [])) {
        const s = (mode === 'hex') ? c.hex : c.text;
        if (c.isEcho) {
            if (acc) { frag.appendChild(document.createTextNode(acc)); acc = ''; }
            const span = document.createElement('span');
            span.className = 'echo-line';
            span.textContent = s;
            frag.appendChild(span);
        } else {
            acc += s;
        }
    }
    if (acc) frag.appendChild(document.createTextNode(acc));

    body.appendChild(frag);
    const last = body.lastChild;
    pane.bodyTextNode = (last && last.nodeType === 3) ? last : null;
    pane.tailTextNode = pane.bodyTextNode;

    if (pane.autoScroll) body.scrollTop = body.scrollHeight;
}

window.api.serial.onEvent((evt) => {
    const pane = state.panes.get(evt.id);
    if (!pane) return;

    let add = '';
    if (evt.type === 'open') {
        if (!pane._openNotified) { add = `\n[已打开]\n`; pane._openNotified = true; }
        pane.open = true;
        const btn = pane.el.querySelector('.btnToggle');
        if (btn) btn.textContent = '关闭串口';
    } else if (evt.type === 'close') {
        add = `\n[已关闭]\n`;
        pane.open = false;
        pane._openNotified = false;
        if (pane.autoTimer) { clearInterval(pane.autoTimer); pane.autoTimer = null; }
        const btn = pane.el.querySelector('.btnToggle');
        if (btn) btn.textContent = '打开串口';
    } else if (evt.type === 'error') {
        add = `\n[错误] ${evt.message}\n`;
    }

    if (add) {
        pane.textBuffer += add;
        pane.hexBuffer += add;
        pane.chunks.push({ text: add, hex: add, isEcho: false });
        trimPane(pane);
        appendTextTail(pane, add);
        refreshPanelList();
    }
});

window.api.tcp.onEvent((evt) => {
    const pane = state.panes.get(evt.id);
    if (!pane) return;
    let add = '';
    if (evt.type === 'open') {
        pane.open = true;
        const btn = pane.el.querySelector('.btnToggle');
        if (btn) btn.textContent = (pane.type === 'tcp') ? '关闭连接' : '关闭串口';
        if (!pane._openNotified) { add = `\n[已打开]\n`; pane._openNotified = true; }
    } else if (evt.type === 'close') {
        add = `\n[已关闭]\n`;
        pane.open = false;
        pane._openNotified = false;
        if (pane.autoTimer) { clearInterval(pane.autoTimer); pane.autoTimer = null; }
        const btn = pane.el.querySelector('.btnToggle');
        if (btn) btn.textContent = (pane.type === 'tcp') ? '打开连接' : '打开串口';
    } else if (evt.type === 'error') {
        add = `\n[错误] ${evt.message}\n`;
    }
    if (add) {
        pane.textBuffer += add;
        pane.hexBuffer += add;
        pane.chunks.push({ text: add, hex: add, isEcho: false });
        trimPane(pane);
        appendTextTail(pane, add);
        refreshPanelList();
    }
});

window.api.panel.onFocusFromPopout(({ id }) => { if (state.panes.has(id)) setActive(id); });
window.api.panel.onDockRequest(({ id, html }) => {
    if (!state.panes.has(id)) {
        const known = state.knownPorts.find(p => p.path === id);
        const label = known ? (known.friendlyName || known.path) : id;
        createPane(id, label);
    }

    const pane = state.panes.get(id);
    const body = pane.el.querySelector('.body');

    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    const text = tmp.innerText || tmp.textContent || '';

    pane.textBuffer = text;
    pane.hexBuffer = text;
    pane.chunks = [{ text, hex: text, isEcho: false }];

    body.innerHTML = '';
    const tn = document.createTextNode(text);
    body.appendChild(tn);
    pane.bodyTextNode = tn;
    pane.tailTextNode = tn;

    pane.autoScroll = true;
    body.scrollTop = body.scrollHeight;

    pane.el.classList.remove('hidden');
    setActive(id);
});




toggleSidebarBtn.addEventListener('click', () => {
    const opening = !sidebarEl.classList.contains('open');
    sidebarEl.classList.toggle('open');
    if (!settings.anim) return;
    setTimeout(() => goldenSparksBurst(opening ? +1 : -1), 10);
    clampAllPanesToWorkspace();
});

btnNew.addEventListener('click', async () => {
    await refreshPortsCombo();

    if (useTcp) {
        useTcp.checked = false;
        tcpFields.style.display = 'none';
        serialFields.style.display = '';
        useTcp.onchange = () => {
            const on = useTcp.checked;
            tcpFields.style.display = on ? '' : 'none';
            serialFields.style.display = on ? 'none' : '';
        };
    }

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
    if (useTcp && useTcp.checked) {
        const host = (tcpHost.value || '').trim();
        const port = parseInt(tcpPort.value, 10);
        if (!host || !port) return;
        const id = `tcp://${host}:${port}`;
        createPane(id, `${host}:${port}`);
        dlgNew.close();
        return;
    }
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

    const pane = state.panes.get(id);
    const data = inputData.value || '';
    const mode = (hexMode && hexMode.checked) ? 'hex' : 'text';
    const append = appendSel.value;

    const log = (msg) => {
        const line = `[系统] ${msg}\n`;
        pane.textBuffer += line;
        pane.hexBuffer += line;
        pane.chunks.push({ text: line, hex: line, isEcho: false });
        appendTextTail(pane, line);
    };

    try {
        if (mode === 'hex') {
            const clean = (data || '').replace(/[\s,]/g, '');
            if (clean.length % 2 !== 0) {
                log('HEX长度必须为偶数');
                return;
            }
        }
        if (!pane.open) {
            logToPane(pane, '[错误] 端口未打开，无法发送\n');
            return;
        }
        const res = (pane.type === 'tcp')
            ? await window.api.tcp.write(id, data, mode, append)
            : await window.api.serial.write(id, data, mode, append);
        if (!res.ok) {
            log('发送失败：' + res.error);
            return;
        }
        echoIfEnabled(id, data);
    } finally {
        const refocus = () => {
            try {
                inputData.disabled = false;
                inputData.readOnly = false;
                inputData.style.pointerEvents = 'auto';
                inputData.blur(); inputData.focus();
                const len = inputData.value.length;
                inputData.setSelectionRange(len, len);
            } catch { }
        };
        requestAnimationFrame(() => { refocus(); requestAnimationFrame(refocus); });
    }
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

    const pane = state.panes.get(id);
    const log = (msg) => {
        const line = `[系统] ${msg}\n`;
        pane.textBuffer += line;
        pane.hexBuffer += line;
        pane.chunks.push({ text: line, hex: line, isEcho: false });
        appendTextTail(pane, line);
    };

    try {
        const { hex, length, error } = await window.api.file.readHex(filePath);
        if (error) { log('读取文件失败：' + error); return; }

        log(`开始发送文件：${fileNameInput.value}（${length} 字节）`);
        const chunkSize = 2048;

        const isTcp = (pane.type === 'tcp');
        for (let i = 0; i < hex.length; i += chunkSize) {
            const chunk = hex.slice(i, i + chunkSize);
            const res = isTcp
                ? await window.api.tcp.write(id, chunk, 'hex', 'none')
                : await window.api.serial.write(id, chunk, 'hex', 'none');
            if (!res.ok) { log('文件发送失败：' + res.error); return; }
        }
        log(`文件发送完成：${fileNameInput.value}（${length} 字节）`);
    } catch (e) {
        log('文件处理异常：' + (e?.message || e));
    } finally {
        const inp = $('#inputData');
        if (inp) {
            btnSendFile.blur();
            fileChooser.blur?.();

            const refocus = () => {
                try {
                    inp.disabled = false; inp.readOnly = false; inp.style.pointerEvents = 'auto';
                    inp.blur(); inp.focus();
                    const len = inp.value.length; inp.setSelectionRange(len, len);
                } catch { }
            };
            requestAnimationFrame(() => { refocus(); requestAnimationFrame(refocus); });

        }
    }
});

inputData.addEventListener('pointerdown', () => {
    requestAnimationFrame(() => {
        try {
            inputData.focus();
            const len = inputData.value.length;
            inputData.setSelectionRange(len, len);
        } catch { }
    });
});
inputData.addEventListener('click', () => {
    try {
        inputData.focus();
        const len = inputData.value.length;
        inputData.setSelectionRange(len, len);
    } catch { }
}, true);

function safeRefocusInput() {
    const inp = document.getElementById('inputData');
    if (!inp || inp.offsetParent === null) return;
    requestAnimationFrame(() => {
        try {
            inp.disabled = false;
            inp.readOnly = false;
            inp.style.pointerEvents = 'auto';
            inp.blur(); inp.focus();
            const len = inp.value.length;
            inp.setSelectionRange(len, len);
        } catch { }
    });
}

function forceUnlockUI(opts = {}) {
    const { closeDialogs = false, refocusInput = true } = opts;
    try {
        autoScrollStop();
        endCmdDrag(true);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.documentElement.classList.remove('cmd-dragging');
        document.querySelectorAll('.cmd-drag-float,.cmd-drag-placeholder').forEach(n => n.remove());
        document.querySelectorAll('[inert]').forEach(n => n.removeAttribute('inert'));
        try { document.activeElement && document.activeElement.blur(); } catch { }
        if (closeDialogs) {
            document.querySelectorAll('dialog[open]').forEach(d => { try { d.close(); } catch { } });
        }
        if (refocusInput) {
            requestAnimationFrame(() => {
                try { window.focus(); } catch { }
                requestAnimationFrame(() => {
                    try { window.focus(); } catch { }
                    safeRefocusInput();
                });
            });
        }
    } catch { }
}

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

    const pane = state.panes.get(id);
    const doWrite = (data, mode = 'text', append = append) =>
    (pane.type === 'tcp'
        ? window.api.tcp.write(id, data, mode, append)
        : window.api.serial.write(id, data, mode, append));
    if (repeating) {
        if (state.cmdIntervalMap.has(cmd.id)) {
            clearInterval(state.cmdIntervalMap.get(cmd.id));
            state.cmdIntervalMap.delete(cmd.id);
            document.querySelectorAll(`.cmd-card[data-cmd-id="${cmd.id}"]`)
                .forEach(el => el.classList.remove('auto'));
            return;
        }
        const timer = setInterval(async () => {
            const res = await doWrite(cmd.data || '', cmd.mode || 'text', append);
            if (res.ok) echoIfEnabled(id, cmd.data || '');
        }, ms);
        state.cmdIntervalMap.set(cmd.id, timer);
        if (cardEl) cardEl.classList.add('auto');
    } else {
        const res = await doWrite(cmd.data || '', cmd.mode || 'text', append);
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

function makeCmdRow(cmd) {
    const tr = document.createElement('tr');
    tr.dataset.id = cmd.id;

    const tdDrag = document.createElement('td');
    tdDrag.className = 'drag cmd-cell-drag';
    const handle = document.createElement('span');
    handle.className = 'cmd-drag-handle'; handle.textContent = '≡'; handle.title = '拖拽排序';
    tdDrag.appendChild(handle);

    const tdSel = document.createElement('td'); tdSel.className = 'sel';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.className = 'rowSel'; chk.dataset.id = cmd.id;
    tdSel.appendChild(chk);
    chk.addEventListener('change', updateDeleteSelectedBtn);

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
    btnDel.onclick = async () => {
        const ok = await uiConfirm(`删除命令：${cmd.name || '(未命名)'} ?`, { danger: true, okText: '删除' });
        if (!ok) { updateDeleteSelectedBtn(); safeRefocusInput(); return; }
        state.commands = state.commands.filter(c => c.id !== cmd.id);
        tr.remove();
        updateDeleteSelectedBtn();
        safeRefocusInput();
    };
    tdOp.appendChild(btnDel);

    tr.append(tdDrag, tdSel, tdName, tdData, tdMode, tdOp);
    tdDrag.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        startCmdDrag(e, tr, tdDrag);
    });
    return tr;
}

cmdAdd.addEventListener('click', () => {
    const newCmd = { id: cryptoRandomId(), name: '新命令', data: '', mode: 'text' };
    state.commands.push(newCmd);
    cmdTableBody.appendChild(makeCmdRow(newCmd));
});

cmdSave.addEventListener('click', () => {
    saveCommands();
    dlgCmdEdit.close();
    renderCmdGrid();
    forceUnlockUI({ closeDialogs: false, refocusInput: true });
    commandsSnapshot = JSON.parse(JSON.stringify(state.commands));
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
function clampAllPanesToWorkspace() {
    const ws = document.getElementById('workspace');
    if (!ws) return;
    const wsW = ws.clientWidth;
    const wsH = ws.clientHeight;
    const sideW = sidebarEl?.offsetWidth || SIDEBAR_COLLAPSED_W;
    const leftMin = sideW + board_margin;

    document.querySelectorAll('.pane').forEach(el => {
        let left = parseInt(el.style.left || '0', 10) || 0;
        let top = parseInt(el.style.top || '0', 10) || 0;
        let w = el.offsetWidth;
        let h = el.offsetHeight;

        const maxLeft = Math.max(leftMin, wsW - w);
        const maxTop = Math.max(0, wsH - h);

        if (left < leftMin) left = leftMin;
        if (left > maxLeft) left = maxLeft;
        if (top < 0) top = 0;
        if (top > maxTop) top = maxTop;

        if (w > wsW - leftMin) { w = wsW - leftMin; el.style.width = w + 'px'; }
        if (h > wsH) { h = wsH; el.style.height = h + 'px'; }

        el.style.left = left + 'px';
        el.style.top = top + 'px';
    });
    window.api.config.save(exportPanelsConfig());
}

// ===== 启动初始化 =====
(async function init() {
    if (settings.fullscreen) window.api?.window?.setFullscreen(true);
    updateTitlebarSafeArea();
    await refreshPortsCombo();
    const saved = await window.api.config.load();
    state.savedConfig = Array.isArray(saved) ? saved : [];
    state.savedConfig.forEach(p => {
        const id = p.id || p.path;
        const name = p.name || id || '';
        if (id) createPane(id, name);
    });
    await loadCommands();
    document.getElementById('echoSend').checked = true;
    renderCmdGrid();
    window.addEventListener('resize', () => { renderCmdGrid(); clampAllPanesToWorkspace(); });

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

    const dlgCmdEdit = document.getElementById('dlgCmdEdit');
    const cmdCancel = document.getElementById('cmdCancel');

    if (dlgCmdEdit && dlgCmdEdit.hasAttribute('open')) dlgCmdEdit.close();

    dlgCmdEdit?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            attemptCloseCmdEditor('esc');
        }
    });
    dlgCmdEdit?.addEventListener('close', () => {
        forceUnlockUI({ closeDialogs: false, refocusInput: true });
        renderCmdGrid();
    });

    dlgCmdEdit?.addEventListener('cancel', (e) => {
        e.preventDefault();
        attemptCloseCmdEditor('backdrop');
        endCmdDrag(true);
    });

    function openCmdEditor() {
        endCmdDrag(true);
        try { dlgCmdEdit.close(); } catch { }
        cmdSelectAll.checked = false;
        commandsSnapshot = JSON.parse(JSON.stringify(state.commands));
        cmdTableBody.innerHTML = '';
        state.commands.forEach((cmd) => cmdTableBody.appendChild(makeCmdRow(cmd)));
        dlgCmdEdit.showModal();
        updateDeleteSelectedBtn();
    }
    cmdEditPage.addEventListener('click', openCmdEditor);

    async function attemptCloseCmdEditor(reason = 'cancel') {
        const dlg = document.getElementById('dlgCmdEdit');
        const changed = JSON.stringify(state.commands) !== JSON.stringify(commandsSnapshot);
        if (changed) {
            const giveup = await uiConfirm('检测到未保存的修改。是否放弃这些改动并返回？', { okText: '放弃修改', cancelText: '继续编辑' });
            if (!giveup) return false;
            state.commands = JSON.parse(JSON.stringify(commandsSnapshot));
            saveCommands();
            renderCmdGrid();
        }
        try { dlg.close(); } catch { }
        safeRefocusInput();
        return true;
    }
    cmdCancel?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        attemptCloseCmdEditor('cancelBtn');
    });


    function getDragAfterRow(container, mouseY) {
        const els = [...container.querySelectorAll('tr:not(.dragging)')];
        let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
        for (const el of els) {
            const box = el.getBoundingClientRect();
            const offset = mouseY - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) closest = { offset, element: el };
        }
        return closest.element;
    }

    cmdSelectAll?.addEventListener('change', () => {
        cmdTableBody.querySelectorAll('.rowSel').forEach(ch => ch.checked = cmdSelectAll.checked);
        updateDeleteSelectedBtn();
    });

    document.getElementById('cmdDeleteSel')?.addEventListener('click', async () => {
        const ids = Array.from(cmdTableBody.querySelectorAll('.rowSel:checked')).map(ch => ch.dataset.id);
        if (ids.length === 0) { updateDeleteSelectedBtn(); return; }
        const ok = await uiConfirm(`确认删除选中的 ${ids.length} 条命令？`, { danger: true, okText: '删除' });
        if (!ok) { updateDeleteSelectedBtn(); safeRefocusInput(); return; }

        state.commands = state.commands.filter(c => !ids.includes(c.id));
        ids.forEach(id => cmdTableBody.querySelector(`tr[data-id="${id}"]`)?.remove());
        if (cmdSelectAll) cmdSelectAll.checked = false;
        updateDeleteSelectedBtn();
        safeRefocusInput();
    });

    window.addEventListener('focus', () => setTimeout(safeRefocusInput, 0));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(safeRefocusInput, 0);
    });

    updateDeleteSelectedBtn();

})();
