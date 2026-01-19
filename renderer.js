(function ensureDnDStyle() {
    if (!document.getElementById('cmd-dnd-style')) {
        const s = document.createElement('style');
        s.id = 'cmd-dnd-style';
        s.textContent = '.cmd-drag-float{pointer-events:none!important}';
        document.head.appendChild(s);
    }
})();
let activeTransfer = null;
let lockConfig = false;
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
const cmdMoveSel = $('#cmdMoveSel');
const cmdCopySel = $('#cmdCopySel');
const useTcp = $('#useTcp');
const tcpFields = $('#tcpFields');
const serialFields = $('#serialFields');
const tcpHost = $('#tcpHost');
const tcpPort = $('#tcpPort');
const btnCheckUpdate = document.getElementById('btnCheckUpdate');
const btnChangelog = document.getElementById('btnChangelog');
const sendProtocol = $('#sendProtocol');
let commandsSnapshot = null;
let cmdGroupsMetaSnapshot = null;
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
          <select id="smSelect" class="prompt-select" style="display:none"></select>
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
        select: dlg.querySelector('#smSelect'),
        ok: dlg.querySelector('#smOk'),
        cancel: dlg.querySelector('#smCancel')
    };
}

function uiAlert(message, { title = '提示', okText = '知道了' } = {}) {
    const { dlg, title: t, msg, input, select, ok, cancel } = ensureSysModal();
    ok.classList.remove('danger');

    t.textContent = title;
    msg.textContent = message || '';
    input.style.display = 'none';
    if (select) select.style.display = 'none';
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
    const { dlg, title: t, msg, input, select, ok, cancel } = ensureSysModal();
    t.textContent = title;
    msg.textContent = message || '';
    input.style.display = 'none';
    if (select) select.style.display = 'none';
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
    const { dlg, title: t, msg, input, select, ok, cancel } = ensureSysModal();
    ok.classList.remove('danger');

    t.textContent = title;
    msg.textContent = message || '';
    input.style.display = '';
    if (select) select.style.display = 'none';
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

function uiSelect(message, {
    title = '选择',
    okText = '确定',
    cancelText = '取消',
    items = []
} = {}) {
    const { dlg, title: t, msg, input, select, ok, cancel } = ensureSysModal();
    ok.classList.remove('danger');

    t.textContent = title;
    msg.textContent = message || '';
    input.style.display = 'none';
    select.style.display = '';
    select.innerHTML = '';

    (items || []).forEach(it => {
        const opt = document.createElement('option');
        if (typeof it === 'string') {
            opt.value = it;
            opt.textContent = it;
        } else {
            opt.value = it.value;
            opt.textContent = it.label;
        }
        select.appendChild(opt);
    });

    ok.textContent = okText;
    cancel.textContent = cancelText;
    cancel.style.display = '';

    return new Promise(resolve => {
        ok.onclick = () => { const v = select.value; dlg.close('ok'); resolve(v); };
        cancel.onclick = () => { dlg.close('cancel'); resolve(''); };
        try { dlg.showModal(); } catch { }
        setTimeout(() => select.focus(), 0);
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

    const origCells = tr.children;
    const ghostCells = ghost.children;
    for (let i = 0; i < origCells.length; i++) {
        const w = origCells[i].getBoundingClientRect().width;
        ghostCells[i].style.width = w + 'px';
        ghostCells[i].style.boxSizing = 'border-box';
    }

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
const popTopToggle = document.getElementById('popTopToggle');
const dockJumpToggle = document.getElementById('dockJumpToggle');
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        return {
            fullscreen: !!s.fullscreen,
            dark: !!s.dark,
            anim: !!s.anim,
            animExtreme: !!s.animExtreme,
            popTop: s.popTop !== false,
            dockJump: s.dockJump !== false,
            winter: !!s.winter
        };
    } catch {
        return { fullscreen: false, dark: false, anim: false, popTop: true, dockJump: true, winter: false };
    }
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
    if (popTopToggle) popTopToggle.checked = !!settings.popTop;
    if (dockJumpToggle) dockJumpToggle.checked = !!settings.dockJump;
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
if (popTopToggle) {
    popTopToggle.addEventListener('change', () => {
        settings.popTop = popTopToggle.checked;
        saveSettings();
    });
}
if (dockJumpToggle) {
    dockJumpToggle.addEventListener('change', () => {
        settings.dockJump = dockJumpToggle.checked;
        saveSettings();
    });
}
// ===== 动画 & 粒子效果 =====
let fxLayer = null;
let fxEmitActive = 0;
let fxPile = null;
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

        fxCtx.setTransform(fxDPR, 0, 0, fxDPR, 0, 0);
        fxCtx.clearRect(0, 0, fxCanvas.width / fxDPR, fxCanvas.height / fxDPR);

        const bp = document.getElementById('bottomPanel')?.getBoundingClientRect();
        const wsr = document.getElementById('workspace')?.getBoundingClientRect();
        const landY = (bp ? bp.top : window.innerHeight - 190);
        const boundLeft = wsr ? wsr.left : 0;
        const boundRight = wsr ? wsr.right : window.innerWidth;
        const boundTop = wsr ? wsr.top : 0;

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

        const extremeHold = settings.animExtreme && (fxEmitActive > 0 || (now - fxLastEmitAt < FX_HOLD_AFTER_EMIT_MS));
        const extremeFadeT = Math.max(0, now - (fxLastEmitAt + FX_HOLD_AFTER_EMIT_MS));
        const extremeFadeK = settings.animExtreme
            ? Math.max(0, 1 - (extremeFadeT / FX_FADE_MS_EXTREME))
            : 1;

        const g = 1800;

        fxParticles = fxParticles.filter(p => {
            if (!p.landed) {
                p.vy += g * dt;
                p.x += p.vx * dt;
                p.y += p.vy * dt;

                if (p.x - p.size < boundLeft) { p.x = boundLeft + p.size; p.vx = -p.vx * 0.55; }
                if (p.x + p.size > boundRight) { p.x = boundRight - p.size; p.vx = -p.vx * 0.55; }
                if (p.y - p.size < boundTop) { p.y = boundTop + p.size; p.vy = -p.vy * 0.55; }

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
                        p.vx = 0;
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
                if (settings.animExtreme) {
                    p.vx = 0;
                    p.alpha = extremeHold ? 1 : extremeFadeK;

                } else {
                    p.vx *= 0.92;
                    p.x += p.vx * dt;
                    if (p.x - p.size < boundLeft) p.x = boundLeft + p.size;
                    if (p.x + p.size > boundRight) p.x = boundRight - p.size;

                    const t = (now - p.landTime) / 1000;
                    p.alpha = Math.max(0, 1 - t / 1.0);
                }
            }

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

            return p.alpha > 0 && p.x > -50 && p.x < window.innerWidth + 50;
        });

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

    const serialParamsRow = document.getElementById('serial-param-row') || serialPage.querySelectorAll('.row')[2];

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
    ) {
        shakeScreenRandom(9, 0.55);
    }
}, true);

function updateDeleteSelectedBtn() {
    const btnDel = document.getElementById('cmdDeleteSel');
    const btnMove = document.getElementById('cmdMoveSel');
    const btnCopy = document.getElementById('cmdCopySel');
    const any = !!cmdTableBody?.querySelector('.rowSel:checked');

    if (btnDel) {
        btnDel.disabled = !any;
        btnDel.classList.toggle('danger', any);
    }
    if (btnMove) {
        btnMove.disabled = !any;
        btnMove.classList.toggle('active', any);
    }
    if (btnCopy) {
        btnCopy.disabled = !any;
        btnCopy.classList.toggle('active', any);
    }
}

const btnNew = $('#btnNew');
const btnRefreshPorts = $('#btnRefreshPorts');
let currentRunId = null;
const SIDEBAR_COLLAPSED_W = 56;
const board_margin = 2;
const activeLabel = $('#activePanelLabel');
const selPort = $('#selPort');
const baud = $('#baud');
const databits = $('#databits');
const stopbits = $('#stopbits');
const parity = $('#parity');
const sendRowMain = $('#row-send-main');
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

const cmdGroupSelect = document.getElementById('cmdGroupSelect');
const cmdGroupNew = document.getElementById('cmdGroupNew');
const cmdGroupRename = document.getElementById('cmdGroupRename');
const cmdGroupDelete = document.getElementById('cmdGroupDelete');
const cmdGroupShow = document.getElementById('cmdGroupShow');

const dlgCmdEdit = $('#dlgCmdEdit');
const cmdAdd = $('#cmdAdd');
const cmdCancel = $('#cmdCancel');
const cmdSave = $('#cmdSave');

const btnSaveLog = $('#btnSaveLog');
const btnAddNote = $('#btnAddNote');
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
btnAddNote.addEventListener('click', async () => {
    const id = state.activeId;
    if (!id) return alert('请先选择一个面板');
    const pane = state.panes.get(id);
    if (!pane) return;
    const v = await uiPrompt('输入备注名', { title: '备注', okText: '确定', cancelText: '重置名称', defaultValue: pane.note || '' });
    if (v === null || v === undefined) return;
    const vv = String(v).slice(0, 15);
    if (vv === '') pane.note = '';
    else pane.note = vv;
    activeLabel.textContent = pane.note || pane.info.name;
    refreshPanelList();
    window.api.config.save(exportPanelsConfig());
    const titleNameEl = pane.el.querySelector('.title .name');
    if (titleNameEl) titleNameEl.textContent = pane.note || pane.info.name;
});

const CMD_GROUPS_KEY = 'cmdGroupsMeta';

function loadCmdGroupsMeta() {
    try {
        const raw = localStorage.getItem(CMD_GROUPS_KEY);
        let obj;
        if (!raw) obj = { groups: ['默认分组'], active: '默认分组' };
        else {
            obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') obj = { groups: ['默认分组'], active: '默认分组' };
        }

        if (!Array.isArray(obj.groups) || !obj.groups.length) obj.groups = ['默认分组'];
        if (!obj.active || !obj.groups.includes(obj.active)) obj.active = obj.groups[0];

        if (!Array.isArray(obj.visible)) obj.visible = [...obj.groups];
        else {
            obj.visible = obj.visible.filter(g => obj.groups.includes(g));
            if (!obj.visible.length) obj.visible = [...obj.groups];
        }

        return obj;
    } catch {
        return { groups: ['默认分组'], active: '默认分组', visible: ['默认分组'] };
    }
}


function saveCmdGroupsMeta(meta) {
    try {
        localStorage.setItem(CMD_GROUPS_KEY, JSON.stringify(meta || { groups: ['默认分组'], active: '默认分组' }));
    } catch { }
}

function getActiveGroup() {
    const meta = state.cmdGroupsMeta;
    if (!meta || !meta.active) return '默认分组';
    return meta.active;
}

function getVisibleGroups() {
    const meta = state.cmdGroupsMeta || { groups: ['默认分组'], active: '默认分组', visible: null };
    const groups = Array.isArray(meta.groups) && meta.groups.length ? meta.groups : ['默认分组'];

    let visible = Array.isArray(meta.visible)
        ? meta.visible.filter(g => groups.includes(g))
        : [];
    if (!visible.length) visible = groups;

    return visible;
}

function getVisibleCommands() {
    const vs = new Set(getVisibleGroups());
    return state.commands.filter(c => vs.has(c.group || '默认分组'));
}

function syncCmdGroupsMetaWithCommands() {
    let meta = state.cmdGroupsMeta;
    if (!meta || typeof meta !== 'object') meta = { groups: [], active: '', visible: [] };
    if (!Array.isArray(meta.groups)) meta.groups = [];

    const groupsSet = new Set(meta.groups);

    if (meta.groups.length === 0) {
        meta.groups.push('默认分组');
        groupsSet.add('默认分组');
    }

    state.commands.forEach(cmd => {
        if (!cmd.group) {
            cmd.group = meta.groups[0];
        }

        let g = cmd.group;
        if (!groupsSet.has(g)) {
            groupsSet.add(g);
            meta.groups.push(g);
        }
    });

    if (!meta.active || !groupsSet.has(meta.active)) {
        meta.active = meta.groups[0];
    }

    if (!Array.isArray(meta.visible)) meta.visible = [...meta.groups];
    else {
        meta.visible = meta.visible.filter(g => groupsSet.has(g));
        if (!meta.visible.length) meta.visible = [...meta.groups];
    }

    state.cmdGroupsMeta = meta;
    saveCmdGroupsMeta(meta);
}
let globalZIndex = 5000;
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
    cmdGroupsMeta: loadCmdGroupsMeta(),

    paneOrder: []
};

function applyPaneZOrder() {

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
    const panes = Array.from(state.panes.values());

    if (Array.isArray(state.listOrder) && state.listOrder.length > 0) {
        const orderMap = new Map(state.listOrder.map((id, index) => [id, index]));
        panes.sort((a, b) => {
            const ia = orderMap.has(a.info.path) ? orderMap.get(a.info.path) : 999999;
            const ib = orderMap.has(b.info.path) ? orderMap.get(b.info.path) : 999999;
            return ia - ib;
        });
    }
    return panes.map(p => ({
        id: p.info.path,
        path: p.info.path,
        name: p.info.name,
        type: p.type || ((p.info.path || '').startsWith('tcp://') ? 'tcp' : 'serial'),
        options: p.options,
        left: p.el.style.left || "30px",
        top: p.el.style.top || "30px",
        width: p.el.style.width || "420px",
        height: p.el.style.height || "240px",
        hidden: p.el.classList.contains('hidden'),
        note: p.note || ''
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

function appendSysLine(pane, text) {
    const needBreak = pane.textBuffer && !/\n$/.test(pane.textBuffer);
    const add = (needBreak ? '\n' : '') + text + '\n';
    pane.textBuffer += add;
    pane.hexBuffer += add;
    pane.chunks.push({ text: add, hex: add, isEcho: false });
    trimPane(pane);
    appendTextTail(pane, add);
}

function appendNodeTail(pane, node) {
    const body = pane.el.querySelector('.body');
    body.appendChild(node);
    pane.tailTextNode = null;
    if (pane.autoScroll) body.scrollTop = body.scrollHeight;
}

if (btnCheckUpdate) {
    btnCheckUpdate.addEventListener('click', () => {
        btnCheckUpdate.classList.remove('shining-btn');
        updateAboutBadge();
        window.api.app.checkUpdate();
    });
}

if (btnChangelog) {
    btnChangelog.addEventListener('click', async () => {
        btnChangelog.classList.remove('shining-btn');
        updateAboutBadge();

        try {
            const ver = await window.api.app.getVersion();
            localStorage.setItem('lastReadVersion', ver);
        } catch { }

        if (window.api.changelog && window.api.changelog.request) {
            window.api.changelog.request();
        } else {
            console.warn('window.api.changelog.request not found');
            if (changelogContent) {
                changelogContent.innerHTML = '<div style="padding:20px">暂无法获取日志内容</div>';
                dlgChangelog.showModal();
            }
        }
    });
}

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
    const addText = `[${ts}] ${text}\n`;

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
    lockConfig = true;

    if (state.activeId && inputData) {
        const prevPane = state.panes.get(state.activeId);
        if (prevPane) {
            prevPane.sendText = inputData.value || '';
        }
    }

    state.activeId = id;
    $$('.pane').forEach(p => p.classList.remove('active'));
    const pane = state.panes.get(id);

    if (pane) {
        pane.el.classList.add('active');
        activeLabel.textContent = pane.note || pane.info.name;
        const currentZ = parseInt(pane.el.style.zIndex || 0);
        if (currentZ !== globalZIndex) {
            pane.el.style.zIndex = ++globalZIndex;
        }

        if (typeof pane.sendText === 'string' && inputData) {
            inputData.value = pane.sendText;
        }

        mountSendBarForPane(pane);

        fillPortSelect(id);
        applyBottomPanelForPane(pane);
    } else {
        activeLabel.textContent = '（未选择）';
        applyBottomPanelForPane(null);

        if (sendRowMain) {
            sendRowMain.style.display = 'none';
        }
    }

    setTimeout(() => { lockConfig = false; }, 50);
}

const winterToggle = document.getElementById('winterToggle');
const WINTER_CONFIG = {
    enabled: false,
    gravity: 0.5,
    powerScale: 0.18,
    snowInterval: null,
    gameLoop: null,
    snowmen: [],
    projectiles: []
};

if (winterToggle) {
    winterToggle.addEventListener('change', () => {
        settings.winter = winterToggle.checked;
        saveSettings();
        applyWinter(settings.winter);
    });
}

(function patchSettings() {
    const s = loadSettings();
    if (winterToggle) winterToggle.checked = !!s.winter;
    applyWinter(!!s.winter);
})();

function applyWinter(enabled) {
    WINTER_CONFIG.enabled = enabled;
    const layer = document.getElementById('winterLayer') || createWinterLayer();

    let rack = document.getElementById('snowballRack');

    if (enabled) {
        if (!rack) {
            rack = createSnowballRack();
        }
        rack.style.display = 'flex';
    } else {
        if (rack) {
            rack.remove();
        }
    }

    const gameArea = document.getElementById('winterGameArea') || createGameArea();
    layer.style.display = enabled ? 'block' : 'none';
    gameArea.style.display = enabled ? 'block' : 'none';

    if (enabled) {
        startSnowFall();
        startGameLoop();
    } else {
        stopSnowFall();
        stopGameLoop();
    }
}

function createWinterLayer() {
    const div = document.createElement('div');
    div.id = 'winterLayer';
    document.body.appendChild(div);
    return div;
}

function createGameArea() {
    const div = document.createElement('div');
    div.id = 'winterGameArea';
    const ws = document.getElementById('workspace');
    if (ws) ws.appendChild(div);
    return div;
}

function createSnowballRack() {
    const rack = document.createElement('div');
    rack.id = 'snowballRack';
    for (let i = 0; i < 5; i++) {
        const ball = document.createElement('div');
        ball.className = 'ammo-snowball';
        ball.dataset.idx = i;
        ball.addEventListener('mousedown', onAmmoDragStart);
        rack.appendChild(ball);
    }

    const sb = document.getElementById('sidebar');
    const actions = sb.querySelector('.sidebar-actions');
    if (actions) {
        actions.insertAdjacentElement('afterend', rack);
    } else {
        sb.appendChild(rack);
    }
    return rack;
}

function startSnowFall() {
    if (WINTER_CONFIG.snowInterval) return;
    const layer = document.getElementById('winterLayer');
    WINTER_CONFIG.snowInterval = setInterval(() => {
        if (!WINTER_CONFIG.enabled) return;
        const flake = document.createElement('div');
        flake.className = 'snowflake';
        flake.textContent = ['❄', '❅', '❆', '•'][Math.floor(Math.random() * 4)];
        flake.style.left = Math.random() * 100 + 'vw';
        flake.style.opacity = Math.random();
        flake.style.fontSize = (10 + Math.random() * 20) + 'px';
        const duration = 5 + Math.random() * 10;
        flake.style.animationDuration = duration + 's';

        layer.appendChild(flake);

        setTimeout(() => { if (flake.parentNode) flake.remove(); }, duration * 1000);
    }, 400);
}

function stopSnowFall() {
    if (WINTER_CONFIG.snowInterval) clearInterval(WINTER_CONFIG.snowInterval);
    WINTER_CONFIG.snowInterval = null;
    const layer = document.getElementById('winterLayer');
    if (layer) layer.innerHTML = '';
}

let dragData = { active: false, startX: 0, startY: 0, currentX: 0, currentY: 0, ballEl: null, aimDots: [] };

function onAmmoDragStart(e) {
    if (!WINTER_CONFIG.enabled) return;
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open')) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = e.target.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    dragData.active = true;
    dragData.startX = centerX;
    dragData.startY = centerY;
    dragData.currentX = centerX;
    dragData.currentY = centerY;
    dragData.ballEl = e.target;
    dragData.aimDots = [];

    document.addEventListener('mousemove', onAmmoDragMove);
    document.addEventListener('mouseup', onAmmoDragEnd);
}

function onAmmoDragMove(e) {
    if (!dragData.active) return;
    dragData.currentX = e.clientX;
    dragData.currentY = e.clientY;
    updateAimLine();
}

function updateAimLine() {
    dragData.aimDots.forEach(d => d.remove());
    dragData.aimDots = [];

    const dx = dragData.startX - dragData.currentX;
    const dy = dragData.startY - dragData.currentY;

    if (Math.sqrt(dx * dx + dy * dy) < 10) return;

    const vx = dx * WINTER_CONFIG.powerScale;
    const vy = dy * WINTER_CONFIG.powerScale;

    for (let t = 1; t <= 15; t++) {
        const time = t * 2.5;

        const futureX = dragData.startX + vx * time;
        const futureY = dragData.startY + vy * time + 0.5 * WINTER_CONFIG.gravity * time * time;

        if (futureY > window.innerHeight) break;

        const dot = document.createElement('div');
        dot.className = 'aim-dot';
        dot.style.left = futureX + 'px';
        dot.style.top = futureY + 'px';

        dot.style.opacity = (1 - t / 20).toString();
        dot.style.transform = `translate(-50%, -50%) scale(${1 - t * 0.03})`;

        document.body.appendChild(dot);
        dragData.aimDots.push(dot);
    }
}

function onAmmoDragEnd(e) {
    if (!dragData.active) return;
    document.removeEventListener('mousemove', onAmmoDragMove);
    document.removeEventListener('mouseup', onAmmoDragEnd);

    dragData.aimDots.forEach(d => d.remove());
    dragData.aimDots = [];

    const dx = dragData.startX - e.clientX;
    const dy = dragData.startY - e.clientY;

    if (Math.sqrt(dx * dx + dy * dy) > 20) {
        fireSnowball(dragData.startX, dragData.startY, dx * WINTER_CONFIG.powerScale, dy * WINTER_CONFIG.powerScale);
    }

    dragData.active = false;
    dragData.ballEl = null;
}

function fireSnowball(x, y, vx, vy) {
    const ball = document.createElement('div');
    ball.className = 'projectile';
    ball.style.left = x + 'px';
    ball.style.top = y + 'px';
    document.body.appendChild(ball);

    WINTER_CONFIG.projectiles.push({
        el: ball,
        x: x, y: y,
        vx: vx, vy: vy,
        r: 10
    });
}

function startGameLoop() {
    if (WINTER_CONFIG.gameLoop) return;

    let spawnTimer = 0;
    const sidebarWidth = 260;

    const loop = () => {
        if (!WINTER_CONFIG.enabled) return;

        const sidebar = document.getElementById('sidebar');
        const gameArea = document.getElementById('winterGameArea');
        const isSidebarOpen = sidebar.classList.contains('open');

        const areaRect = gameArea ? gameArea.getBoundingClientRect() : null;
        const groundY = areaRect ? areaRect.bottom : (window.innerHeight - 10);

        if (!isSidebarOpen) {
            spawnTimer++;
            if (spawnTimer > 180) {
                spawnSnowman();
                spawnTimer = 0;
            }
        }

        for (let i = WINTER_CONFIG.projectiles.length - 1; i >= 0; i--) {
            const p = WINTER_CONFIG.projectiles[i];

            p.vy += WINTER_CONFIG.gravity;
            p.x += p.vx;
            p.y += p.vy;

            p.el.style.left = p.x + 'px';
            p.el.style.top = p.y + 'px';

            if (p.y > groundY - 5) {
                spawnSplat(p.x, groundY);
                p.el.remove();
                WINTER_CONFIG.projectiles.splice(i, 1);
                continue;
            }

            if (p.x > window.innerWidth || p.x < -50) {
                p.el.remove();
                WINTER_CONFIG.projectiles.splice(i, 1);
                continue;
            }

            checkCollision(p, i);
        }

        const areaWidth = gameArea?.clientWidth || window.innerWidth;

        for (let i = WINTER_CONFIG.snowmen.length - 1; i >= 0; i--) {
            const s = WINTER_CONFIG.snowmen[i];

            if (typeof s.rot === 'undefined') s.rot = 0;
            if (typeof s.isFlying === 'undefined') s.isFlying = false;

            if (isSidebarOpen) {
                if (s.x < sidebarWidth + 20 && !s.isFlying) {
                    s.isFlying = true;
                    s.vx = 10 + Math.random() * 5;
                    s.vy = -12 - Math.random() * 5;
                }
            }

            if (s.isFlying) {
                s.vy += 0.6;
                s.x += s.vx;
                s.y += s.vy;
                if (typeof s.flyY === 'undefined') s.flyY = 0;
                s.flyY += s.vy;

                s.rot += 15;

                if (s.flyY > 200) {
                    s.el.remove();
                    WINTER_CONFIG.snowmen.splice(i, 1);
                    continue;
                }

                s.el.style.left = s.x + 'px';
                s.el.style.transform = `translateY(${s.flyY}px) rotate(${s.rot}deg)`;

                continue;
            }

            const now = Date.now();
            if (now < s.frozenUntil) {
                if (!s.el.classList.contains('frozen')) s.el.classList.add('frozen');
                continue;
            } else {
                s.el.classList.remove('frozen');
            }

            if (isSidebarOpen) {
                s.vx = 0;
                s.el.classList.add('with-arms');
            } else {
                s.el.classList.remove('with-arms');
                if (Math.abs(s.vx) < 0.1) s.vx = (Math.random() * 1.5 + 0.5) * (Math.random() < 0.5 ? 1 : -1);
                s.el.style.transform = `rotate(0deg)`;
                s.rot = 0;
            }

            s.x += s.vx;

            if (s.x > areaWidth - 40) s.vx = -Math.abs(s.vx);
            if (s.x < 0) s.vx = Math.abs(s.vx);

            s.el.style.left = s.x + 'px';
        }

        WINTER_CONFIG.gameLoop = requestAnimationFrame(loop);
    };
    WINTER_CONFIG.gameLoop = requestAnimationFrame(loop);
}

function spawnSplat(x, y) {
    const splat = document.createElement('div');
    splat.className = 'snow-splat';
    splat.style.left = (x - 15) + 'px';
    splat.style.top = (y - 5) + 'px';

    const scale = 0.8 + Math.random() * 0.4;
    splat.style.transform = `scale(${scale})`;

    document.body.appendChild(splat);

    setTimeout(() => {
        if (splat.parentNode) splat.remove();
    }, 800);
}

function stopGameLoop() {
    if (WINTER_CONFIG.gameLoop) cancelAnimationFrame(WINTER_CONFIG.gameLoop);
    WINTER_CONFIG.gameLoop = null;
    WINTER_CONFIG.projectiles.forEach(p => p.el.remove());
    WINTER_CONFIG.projectiles = [];
    WINTER_CONFIG.snowmen.forEach(s => s.el.remove());
    WINTER_CONFIG.snowmen = [];
}

function spawnSnowman() {
    const area = document.getElementById('winterGameArea');
    if (!area) return;

    if (WINTER_CONFIG.snowmen.length >= 5) return;

    const el = document.createElement('div');
    el.className = 'snowman';
    el.innerHTML = `<div class="snowman-head"></div><div class="snowman-scarf"></div><div class="snowman-body"></div>`;

    const maxW = area.clientWidth - 50;
    const startX = Math.random() * maxW;
    el.style.left = startX + 'px';

    area.appendChild(el);

    WINTER_CONFIG.snowmen.push({
        el: el,
        x: startX,
        vx: (Math.random() * 1.5 + 0.5) * (Math.random() < 0.5 ? 1 : -1),
        frozenUntil: 0
    });
}

function checkCollision(projectile, pIdx) {
    const pRect = projectile.el.getBoundingClientRect();
    const px = pRect.left + pRect.width / 2;
    const py = pRect.top + pRect.height / 2;

    for (const snowman of WINTER_CONFIG.snowmen) {
        if (snowman.isFlying) continue;

        const sRect = snowman.el.getBoundingClientRect();

        if (px > sRect.left && px < sRect.right &&
            py > sRect.top && py < sRect.bottom) {

            spawnShockwave(px, py);
            spawnConfetti(px, py);

            const isFrozen = Date.now() < snowman.frozenUntil;

            if (isFrozen) {
                snowman.isFlying = true;
                snowman.flyY = 0;
                snowman.vx = (projectile.vx > 0 ? 1 : -1) * (5 + Math.random() * 5);
                snowman.vy = -10 - Math.random() * 5;

                snowman.el.classList.remove('frozen');
            } else {
                snowman.frozenUntil = Date.now() + 3000;
                snowman.el.style.transform = `scale(0.95)`;
                setTimeout(() => snowman.el.style.transform = '', 100);
            }

            projectile.el.remove();
            WINTER_CONFIG.projectiles.splice(pIdx, 1);
            return;
        }
    }
}

function mountSendBarForPane(pane) {
    if (!sendRowMain || !pane) return;

    if (!mountSendBarForPane._movedOnce && sendRowMain.parentElement) {
        sendRowMain.parentElement.removeChild(sendRowMain);
        mountSendBarForPane._movedOnce = true;
    }

    sendRowMain.classList.add('pane-send-row');
    sendRowMain.style.display = '';

    const body = pane.el.querySelector('.body');
    const firstResizer = pane.el.querySelector('.resizer');

    if (body && firstResizer && firstResizer.parentElement === pane.el) {
        pane.el.insertBefore(sendRowMain, firstResizer);
    } else if (body) {
        body.insertAdjacentElement('afterend', sendRowMain);
    } else {
        pane.el.appendChild(sendRowMain);
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
    el.dataset.id = id;
    el.style.zIndex = ++globalZIndex;
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
                }
            } else {
                if (!state.knownPorts.some(p => p.path === id)) {
                    appendSysLine(state.panes.get(id), '[错误] 端口不存在或已拔出');
                    await refreshPortsCombo();
                    btnToggle.textContent = '打开串口';
                    refreshPanelList();
                    return;
                }
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
                    appendSysLine(pane, '[错误] ' + (r && r.error ? r.error : '打开失败'));
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
        const pane = state.panes.get(id);
        const popTitle = (pane && pane.note) ? pane.note : name;
        window.api.panel.popout(
            id,
            popTitle,
            JSON.stringify(pane.chunks || []),
            !!settings.popTop,
            pane.open,
            pane.viewMode,
            JSON.stringify(pane.options || {})
        );
        el.classList.add('hidden');
        if (state.activeId === id) {
            setActive(null);
        }
        refreshPanelList();
        window.api.config.save(exportPanelsConfig());
    });

    el.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        setActive(id);
        window.api.config.save(exportPanelsConfig());
    });

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
        autoScroll: true,
        sendText: '',
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
        const paneObjSaved = state.panes.get(id);
        if (saved.options) paneObjSaved.options = saved.options;
        if (saved.hidden) el.classList.add('hidden');
        if (typeof saved.note === 'string') paneObjSaved.note = saved.note;
        const t = el.querySelector('.title .name');
        if (t) t.textContent = (paneObjSaved.note && paneObjSaved.note.trim()) ? paneObjSaved.note : (paneObjSaved.info.name || id);
    }


    refreshPanelList();
    if (!saved || !saved.hidden) setActive(id);
    window.api.config.save(exportPanelsConfig());
}

function refreshPanelList() {
    state.panes.forEach((pane) => {
        const t = pane.el?.querySelector('.title .name');
        if (t) t.textContent = (pane.note && pane.note.trim()) ? pane.note : (pane.info.name || pane.id || '');
    });
    panelListEl.innerHTML = '';
    state.panes.forEach((pane, id) => {
        const li = document.createElement('li');
        li.className = 'port-row';
        li.draggable = true;
        li.dataset.id = id;
        li.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'move';
            state.draggingId = id;
        });
        li.addEventListener('dragend', () => { state.draggingId = null; });


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
                    if (!state.knownPorts.some(pp => pp.path === id)) {
                        const p2 = state.panes.get(id);
                        if (p2) appendSysLine(p2, '[错误] 端口不存在或已拔出');
                        await refreshPortsCombo();
                        refreshPanelList();
                        return;
                    }
                    const opts = (p.options && typeof p.options === 'object')
                        ? p.options
                        : {
                            baudRate: 115200,
                            dataBits: 8,
                            stopBits: 1,
                            parity: 'none'
                        };

                    const r = await window.api.serial.open(id, opts);
                    if (r && r.ok) {
                        p.options = opts;
                    }
                    if (!(r && r.ok)) {
                        const p2 = state.panes.get(id);
                        if (p2) appendSysLine(p2, '[错误] ' + (r && r.error ? r.error : '打开失败'));
                        refreshPanelList();
                        return;
                    }
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
        label.textContent = (pane.note && pane.note.trim()) ? pane.note : (pane.info.name || id);
        nameEl.appendChild(label);
        nameEl.onclick = () => {
            const hidden = pane.el.classList.contains('hidden');
            if (hidden) {
                pane.el.classList.remove('hidden');
                setActive(id);
            } else {
                pane.el.classList.add('hidden');
                if (state.activeId === id) setActive(null);
            }
            window.api.config.save(exportPanelsConfig());
        };

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
    if (!panelListEl._dndInited) {
        panelListEl._dndInited = true;

        function captureRects() {
            const m = new Map();
            panelListEl.querySelectorAll('li.port-row:not(.drag-hidden)').forEach(li => {
                m.set(li.dataset.id, li.getBoundingClientRect().top);
            });
            return m;
        }

        function animateFLIP(before) {
            const after = new Map();
            panelListEl.querySelectorAll('li.port-row:not(.drag-hidden)').forEach(li => {
                after.set(li.dataset.id, li.getBoundingClientRect().top);
            });
            panelListEl.querySelectorAll('li.port-row:not(.drag-hidden)').forEach(li => {
                const id = li.dataset.id;
                const dy = (before.get(id) ?? after.get(id)) - after.get(id);
                if (!dy) return;
                li.style.transform = `translateY(${dy}px)`;
                li.getBoundingClientRect();
                li.style.transition = 'transform .18s ease';
                li.style.transform = '';
                li.addEventListener('transitionend', function te() {
                    li.style.transition = '';
                    li.removeEventListener('transitionend', te);
                });
            });
        }

        panelListEl.addEventListener('dragstart', (e) => {
            const li = e.target.closest('li.port-row');
            if (!li) return;
            const id = li.dataset.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            state.draggingId = id;

            const ph = document.createElement('li');
            ph.className = 'port-row port-placeholder';
            ph.style.setProperty('--ph', li.offsetHeight + 'px');
            state.placeholderEl = ph;

            requestAnimationFrame(() => {
                li.classList.add('drag-hidden');
                if (!ph.parentNode) {
                    panelListEl.insertBefore(ph, li.nextSibling);
                }
            });
        });

        panelListEl.addEventListener('dragover', (e) => {
            const draggingId = state.draggingId;
            if (!draggingId) return;
            e.preventDefault();

            const beforeRects = captureRects();
            const ph = state.placeholderEl;
            if (!ph.parentNode) panelListEl.appendChild(ph);

            const targetLi = e.target.closest('li.port-row');
            if (targetLi && targetLi !== ph && !targetLi.classList.contains('drag-hidden')) {
                const rect = targetLi.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                if (before) panelListEl.insertBefore(ph, targetLi);
                else panelListEl.insertBefore(ph, targetLi.nextSibling);
            } else if (!targetLi) {
                panelListEl.appendChild(ph);
            }

            animateFLIP(beforeRects);
        });

        panelListEl.addEventListener('drop', (e) => {
            e.preventDefault();
            const ph = state.placeholderEl;
            const draggingId = state.draggingId;
            const hiddenLi = panelListEl.querySelector('li.port-row.drag-hidden');

            if (ph && hiddenLi) {
                panelListEl.insertBefore(hiddenLi, ph);
            }
            if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
            if (hiddenLi) hiddenLi.classList.remove('drag-hidden');

            state.placeholderEl = null;
            state.draggingId = null;

            state.listOrder = Array.from(panelListEl.querySelectorAll('li.port-row')).map(li => li.dataset.id);
            window.api.config.save(exportPanelsConfig());
        });

        panelListEl.addEventListener('dragend', () => {
            const ph = state.placeholderEl;
            const hiddenLi = panelListEl.querySelector('li.port-row.drag-hidden');
            if (ph && hiddenLi) panelListEl.insertBefore(hiddenLi, ph);
            if (ph && ph.parentNode) ph.parentNode.removeChild(ph);
            if (hiddenLi) hiddenLi.classList.remove('drag-hidden');
            state.placeholderEl = null;
            state.draggingId = null;
        });
    }

    if (Array.isArray(state.listOrder) && state.listOrder.length) {
        const orderMap = new Map(state.listOrder.map((x, i) => [x, i]));
        const nodes = Array.from(panelListEl.children);
        nodes.sort((a, b) => (orderMap.get(a.dataset.id) ?? 1e9) - (orderMap.get(b.dataset.id) ?? 1e9));
        nodes.forEach(n => panelListEl.appendChild(n));
    }
}

function formatBytes(bytes, mode = 'text') {
    if (mode === 'hex') {
        let str = Array.from(bytes).map(b => {
            const h = b.toString(16).padStart(2, '0').toUpperCase();
            return (b === 10) ? `${h}\n` : h;
        }).join(' ').replace(/\n /g, '\n');

        if (!str.endsWith('\n')) str += ' ';
        return str;
    }
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); }
    catch { return Array.from(bytes).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join(''); }
}

window.api.serial.onData(({ id, bytes }) => {
    if (activeTransfer && activeTransfer.id === id) {
        activeTransfer.onData(bytes);
        return;
    }
    const strData = new TextDecoder().decode(bytes);
    feedWaveData(id, strData);
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
    if (activeTransfer && activeTransfer.id === id) {
        activeTransfer.onData(bytes);
        return;
    }
    const strData = new TextDecoder().decode(bytes);
    feedWaveData(id, strData);
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
        if (!pane._openNotified) { add = `[已打开]\n`; pane._openNotified = true; }
        pane.open = true;
        const btn = pane.el.querySelector('.btnToggle');
        if (btn) btn.textContent = '关闭串口';
    } else if (evt.type === 'close') {
        add = `[已关闭]\n`;
        pane.open = false;
        pane._openNotified = false;
        if (pane.autoTimer) { clearInterval(pane.autoTimer); pane.autoTimer = null; }
        const btn = pane.el.querySelector('.btnToggle');
        if (btn) btn.textContent = '打开串口';
    } else if (evt.type === 'error') {
        add = `[错误] ${evt.message}\n`;
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
        if (!pane._openNotified) { add = `[已打开]\n`; pane._openNotified = true; }
    } else if (evt.type === 'close') {
        add = `[已关闭]\n`;
        pane.open = false;
        pane._openNotified = false;
        if (pane.autoTimer) { clearInterval(pane.autoTimer); pane.autoTimer = null; }
        const btn = pane.el.querySelector('.btnToggle');
        if (btn) btn.textContent = (pane.type === 'tcp') ? '打开连接' : '打开串口';
    } else if (evt.type === 'error') {
        add = `[错误] ${evt.message}\n`;
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
window.api.panel.onHideRequest(({ id }) => {
    const pane = state.panes.get(id);
    if (pane) {
        pane.el.classList.add('hidden');
        if (state.activeId === id) setActive(null);
        refreshPanelList();
        window.api.config.save(exportPanelsConfig());
    }
});
window.api.panel.onDockRequest(({ id, html }) => {
    if (!state.panes.has(id)) {
        const known = state.knownPorts.find(p => p.path === id);
        const label = known ? (known.friendlyName || known.path) : id;
        createPane(id, label);
    }

    const pane = state.panes.get(id);
    const body = pane.el.querySelector('.body');

    const text = html || '';

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

    if (settings.dockJump) {
        window.api.window.focus();
        const btnSerial = document.querySelector('#bottomNav button[data-page="serial"]');
        if (btnSerial && !btnSerial.classList.contains('active')) {
            btnSerial.click();
        }
    }
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

inputData.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        btnSend.click();
    }
});

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
        if (lockConfig) return;

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

    const protocol = sendProtocol ? sendProtocol.value : 'raw';

    const pane = state.panes.get(id);
    const log = (msg) => {
        const line = `[系统] ${msg}\n`;
        pane.textBuffer += line;
        pane.hexBuffer += line;
        pane.chunks.push({ text: line, hex: line, isEcho: false });
        appendTextTail(pane, line);
    };

    if (protocol !== 'raw') {
        if (protocol === 'zmodem') {
            alert('ZModem 协议暂未实现，请使用 YModem');
            return;
        }

        log(`启动 ${protocol.toUpperCase()} 传输... 请确保接收端已进入接收模式 (等待C字符)`);

        const sender = new YModemSender(id, protocol, (msg) => {
            const line = `[系统] ${msg}\n`;
            pane.textBuffer += line;
            pane.hexBuffer += line;
            pane.chunks.push({ text: line, hex: line, isEcho: false });
            appendTextTail(pane, line);
        });

        activeTransfer = sender;

        try {
            const { hex, length, error } = await window.api.file.readHex(filePath);
            if (error) throw new Error(error);

            const rawBytes = new Uint8Array(
                hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
            );

            await sender.start(rawBytes, fileNameInput.value);

        } catch (e) {
            log(`[错误] ${e.message}`);
            await window.api.serial.write(id, new Uint8Array([0x18, 0x18, 0x18, 0x18, 0x18]), 'raw');
        } finally {
            activeTransfer = null;
        }
        return;
    }

    try {
        const { hex, length, error } = await window.api.file.readHex(filePath);
        if (error) { log('读取文件失败：' + error); return; }

        log(`开始发送文件：${fileNameInput.value}（${length} 字节）`);
        const chunkSize = 2048;
        const isTcp = (pane.type === 'tcp');
        let lastPct = 0;
        for (let i = 0; i < hex.length; i += chunkSize) {
            const chunk = hex.slice(i, i + chunkSize);
            const res = isTcp
                ? await window.api.tcp.write(id, chunk, 'hex', 'none')
                : await window.api.serial.write(id, chunk, 'hex', 'none');

            if (!res.ok) { log('文件发送失败：' + res.error); return; }
            const currentPos = i + chunk.length;
            const percent = Math.floor((currentPos / hex.length) * 100);
            if (percent >= lastPct + 20 || percent === 100) {
                if (percent > lastPct) {
                    log(`发送进度: ${percent}%`);
                    lastPct = percent;
                    await new Promise(r => setTimeout(r, 5));
                }
            }
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
        } catch { }
    });
});
inputData.addEventListener('click', () => {
    try {
        inputData.focus();
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
    const list = getVisibleCommands();
    const total = Math.ceil(list.length / pageSize);
    return Math.max(1, total || 1);
}
function pageSlice(pageIdx) {
    const pageSize = state.cmdCols * state.cmdRows;
    const list = getVisibleCommands();
    const start = pageIdx * pageSize;
    return list.slice(start, start + pageSize);
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
        btn.title = `分组：${cmd.group}`;
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

cmdGrid.addEventListener('wheel', (e) => {
    if (!document.getElementById('page-commands')?.offsetParent) return;
    if (Math.abs(e.deltaY) < 1) return;
    e.preventDefault();
    const pages = totalCmdPages();
    state.cmdPage = (state.cmdPage + (e.deltaY > 0 ? 1 : -1) + pages) % pages;
    renderCmdGrid();
}, { passive: false });

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

    const tdSel = document.createElement('td');
    tdSel.className = 'sel';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'rowSel';
    chk.dataset.id = cmd.id;

    tdSel.appendChild(chk);
    chk.addEventListener('change', updateDeleteSelectedBtn);

    tdSel.addEventListener('click', (e) => {
        if (e.target === chk) return;
        chk.checked = !chk.checked;
        chk.dispatchEvent(new Event('change', { bubbles: false }));
    });

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

function renderCmdTableForCurrentGroup() {
    if (!cmdTableBody) return;
    cmdTableBody.innerHTML = '';

    const active = getActiveGroup();
    state.commands
        .filter(cmd => (cmd.group || '默认分组') === active)
        .forEach(cmd => cmdTableBody.appendChild(makeCmdRow(cmd)));

    if (cmdSelectAll) cmdSelectAll.checked = false;
    updateDeleteSelectedBtn();
}

cmdAdd.addEventListener('click', () => {
    const g = getActiveGroup();
    const newCmd = { id: cryptoRandomId(), name: '新命令', data: '', mode: 'text', group: g };
    state.commands.push(newCmd);
    cmdTableBody.appendChild(makeCmdRow(newCmd));
});

cmdSave.addEventListener('click', () => {
    saveCommands();
    saveCmdGroupsMeta(state.cmdGroupsMeta);
    dlgCmdEdit.close();
    renderCmdGrid();
    forceUnlockUI({ closeDialogs: false, refocusInput: true });
    commandsSnapshot = JSON.parse(JSON.stringify(state.commands));
    cmdGroupsMetaSnapshot = JSON.parse(JSON.stringify(state.cmdGroupsMeta));
});

cmdGroupSelect?.addEventListener('change', () => {
    const val = cmdGroupSelect.value;
    const meta = state.cmdGroupsMeta;
    if (!meta || !Array.isArray(meta.groups) || !meta.groups.includes(val)) return;

    meta.active = val;
    state.cmdGroupsMeta = meta;
    saveCmdGroupsMeta(meta);

    if (cmdGroupShow) {
        const visible = Array.isArray(meta.visible) ? meta.visible : meta.groups;
        cmdGroupShow.checked = !!visible.includes(val);
    }

    renderCmdTableForCurrentGroup();
    renderCmdGrid();
});

cmdGroupShow?.addEventListener('change', () => {
    const meta = state.cmdGroupsMeta || { groups: ['默认分组'], active: '默认分组', visible: [] };
    if (!Array.isArray(meta.groups)) meta.groups = ['默认分组'];
    if (!Array.isArray(meta.visible)) meta.visible = [...meta.groups];

    const g = getActiveGroup();
    const set = new Set(meta.visible);

    if (cmdGroupShow.checked) set.add(g);
    else set.delete(g);

    meta.visible = Array.from(set).filter(x => meta.groups.includes(x));

    if (!meta.visible.length) {
        meta.visible = [g];
        cmdGroupShow.checked = true;
    }

    state.cmdGroupsMeta = meta;
    saveCmdGroupsMeta(meta);
    renderCmdGrid();
});

cmdGroupNew?.addEventListener('click', async () => {
    let name = await uiPrompt('输入新分组名称', {
        title: '新建分组',
        okText: '确定',
        cancelText: '取消',
        defaultValue: ''
    });
    name = (name || '').trim();
    if (!name) return;

    const meta = state.cmdGroupsMeta || { groups: [], active: '' };
    if (!Array.isArray(meta.groups)) meta.groups = [];
    if (meta.groups.includes(name)) {
        uiAlert('该分组已存在');
        return;
    }
    meta.groups.push(name);
    meta.active = name;
    if (!Array.isArray(meta.visible)) meta.visible = [];
    if (!meta.visible.includes(name)) meta.visible.push(name);

    state.cmdGroupsMeta = meta;
    saveCmdGroupsMeta(meta);

    refreshCmdGroupSelect();
    renderCmdTableForCurrentGroup();
    renderCmdGrid();
});

cmdGroupRename?.addEventListener('click', async () => {
    const meta = state.cmdGroupsMeta;
    if (!meta || !Array.isArray(meta.groups) || !meta.groups.length) return;
    const current = getActiveGroup();

    let name = await uiPrompt('输入新的分组名称', {
        title: '重命名分组',
        okText: '确定',
        cancelText: '取消',
        defaultValue: current
    });
    name = (name || '').trim();
    if (!name || name === current) return;

    if (meta.groups.includes(name)) {
        uiAlert('已存在同名分组');
        return;
    }

    meta.groups = meta.groups.map(g => g === current ? name : g);
    meta.active = name;

    state.commands.forEach(cmd => {
        if ((cmd.group || '默认分组') === current) cmd.group = name;
    });

    if (!Array.isArray(meta.visible)) meta.visible = [...meta.groups];
    else {
        meta.visible = meta.visible
            .map(g => g === current ? name : g)
            .filter(g => meta.groups.includes(g));
        if (!meta.visible.length) meta.visible = [...meta.groups];
    }

    state.cmdGroupsMeta = meta;
    saveCmdGroupsMeta(meta);

    refreshCmdGroupSelect();
    renderCmdTableForCurrentGroup();
    renderCmdGrid();
});

cmdGroupDelete?.addEventListener('click', async () => {
    const meta = state.cmdGroupsMeta;
    if (!meta || !Array.isArray(meta.groups) || !meta.groups.length) return;
    const current = getActiveGroup();

    if (meta.groups.length <= 1) {
        uiAlert('至少需要保留一个分组');
        return;
    }

    let target = '默认分组';
    if (!meta.groups.includes('默认分组') || current === '默认分组') {
        target = meta.groups.find(g => g !== current) || current;
    }

    const ok = await uiConfirm(`确定删除分组「${current}」？\n其中的命令将移动到「${target}」。`, {
        danger: true,
        okText: '删除',
        cancelText: '取消'
    });
    if (!ok) { safeRefocusInput(); return; }

    if (!meta.groups.includes(target)) meta.groups.push(target);

    state.commands.forEach(cmd => {
        if ((cmd.group || '默认分组') === current) cmd.group = target;
    });

    meta.groups = meta.groups.filter(g => g !== current);
    if (!meta.groups.length) meta.groups = [target];
    meta.active = target;

    if (!Array.isArray(meta.visible)) meta.visible = [...meta.groups];
    else {
        meta.visible = meta.visible.filter(g => g !== current);
        if (!meta.visible.includes(target)) meta.visible.push(target);
        meta.visible = meta.visible.filter(g => meta.groups.includes(g));
        if (!meta.visible.length) meta.visible = [...meta.groups];
    }

    state.cmdGroupsMeta = meta;
    saveCmdGroupsMeta(meta);

    refreshCmdGroupSelect();
    renderCmdTableForCurrentGroup();
    renderCmdGrid();
    safeRefocusInput();
});

function saveCommands() { window.api.commands.save(state.commands); }
async function loadCommands() {
    const list = await window.api.commands.load();

    const currentGroups = state.cmdGroupsMeta?.groups || [];
    const fallbackGroup = currentGroups.length > 0 ? currentGroups[0] : '默认分组';

    state.commands = (list || []).map(c => ({
        id: c.id || cryptoRandomId(),
        name: c.name || '',
        data: c.data || '',
        mode: c.mode || 'text',
        group: c.group || c.page || fallbackGroup
    }));
    syncCmdGroupsMetaWithCommands();
}

function refreshCmdGroupSelect() {
    if (!cmdGroupSelect) return;
    const meta = state.cmdGroupsMeta || { groups: ['默认分组'], active: '默认分组', visible: null };
    const groups = Array.isArray(meta.groups) && meta.groups.length ? meta.groups : ['默认分组'];

    cmdGroupSelect.innerHTML = '';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        cmdGroupSelect.appendChild(opt);
    });

    let active = getActiveGroup();
    if (!groups.includes(active)) {
        active = groups[0];
        meta.active = active;
        state.cmdGroupsMeta = meta;
        saveCmdGroupsMeta(meta);
    }
    cmdGroupSelect.value = active;

    if (cmdGroupShow) {
        let visible = Array.isArray(meta.visible)
            ? meta.visible.filter(g => groups.includes(g))
            : [];
        if (!visible.length) visible = [...groups];
        cmdGroupShow.checked = visible.includes(active);
    }
}

function cryptoRandomId() {
    return 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
function updateTitlebarSafeArea() {
    const root = document.documentElement;
    let h = 30, inset = 38;

    const wco = navigator.windowControlsOverlay;
    if (wco && typeof wco.getTitlebarAreaRect === 'function') {
        const r = wco.getTitlebarAreaRect();
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

function updateAboutBadge() {
    const btnAbout = document.querySelector('#bottomNav button[data-page="about"]');
    if (!btnAbout) return;

    const hasUpdate = (btnCheckUpdate && btnCheckUpdate.classList.contains('shining-btn'));
    const hasLog = (btnChangelog && btnChangelog.classList.contains('shining-btn'));

    btnAbout.classList.toggle('has-badge', hasUpdate || hasLog);
}

let waveWin = null;
const btnShowWave = $('#btnShowWave');

function openWaveWindow() {
    if (waveWin && !waveWin.closed) {
        waveWin.focus();
        return;
    }

    const paneId = state.activeId;
    const pane = state.panes.get(paneId);
    const paneName = pane ? (pane.note || pane.info.name || '未命名') : '未知面板';
    const portName = paneId || '';
    const titleText = `${paneName} (${portName})`;

    const width = 800;
    const height = 500;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    const features = `width=${width},height=${height},left=${left},top=${top},frame=false,transparent=true,autoHideMenuBar=true,backgroundColor=#1e1e1e`;

    waveWin = window.open('', 'SerialWave', features);

    if (!waveWin) return;

    const doc = waveWin.document;
    doc.open();
    doc.write(`
<!DOCTYPE html>
<html>
<head>
<title>示波器 - ${titleText}</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #1e1e1e; color: #fff; font-family: sans-serif; overflow: hidden; display: flex; flex-direction: column; border: 1px solid #444; box-sizing: border-box; }
  #titlebar { height: 32px; background: #252526; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; border-bottom: 1px solid #333; -webkit-app-region: drag; user-select: none; flex-shrink: 0; }
  .title-left { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #ccc; font-weight: 500; }
  .help-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; border: 1px solid #666; color: #888; font-size: 12px; cursor: help; -webkit-app-region: no-drag; position: relative; }
  .help-icon:hover { color: #fff; border-color: #fff; background: rgba(255,255,255,0.1); }
  .help-icon .tooltip { visibility: hidden; position: absolute; top: 24px; left: 0; width: 220px; background: #2d2d2d; color: #eee; padding: 8px 10px; border-radius: 4px; border: 1px solid #444; box-shadow: 0 4px 12px rgba(0,0,0,0.5); font-size: 12px; line-height: 1.5; z-index: 100; opacity: 0; transform: translateY(-5px); transition: all 0.2s; pointer-events: none; white-space: normal; text-align: left; }
  .help-icon:hover .tooltip { visibility: visible; opacity: 1; transform: translateY(0); }
  .win-controls { display: flex; gap: 0; -webkit-app-region: no-drag; }
  .win-btn { width: 32px; height: 32px; border: none; background: transparent; color: #aaa; display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; outline: none; }
  .win-btn:hover { background: #3e3e42; color: #fff; }
  .win-btn.close:hover { background: #e81123; color: #fff; }
  .win-btn.pinned { 
      background: #409EFF;
      color: #fff;
      box-shadow: 0 0 4px rgba(64, 158, 255, 0.5);
  }
  .win-btn.pinned:hover {
      background: #66b1ff;
  }
  #main { flex: 1; position: relative; display: flex; flex-direction: column; }
  canvas { flex: 1; display: block; width: 100%; height: 100%; cursor: crosshair; }
  #info-overlay { position: absolute; top: 10px; right: 10px; font-family: monospace; font-size: 12px; color: #0f0; background: rgba(0,0,0,0.6); padding: 4px 8px; border-radius: 4px; pointer-events: none; border: 1px solid rgba(0,255,0,0.2); }
  #debug { position: absolute; bottom: 40px; left: 10px; font-family: monospace; font-size: 11px; color: #666; pointer-events: none; max-width: 300px; white-space: nowrap; overflow: hidden; }
  #controls { height: 32px; background: #252526; border-top: 1px solid #333; display: flex; align-items: center; padding: 0 10px; gap: 10px; font-size: 12px; }
  .ctrl-btn { background: #333; border: 1px solid #444; color: #eee; cursor: pointer; padding: 3px 10px; border-radius: 3px; font-size: 12px; }
  .ctrl-btn:hover { background: #444; border-color: #555; }
</style>
</head>
<body>
<div id="titlebar">
  <div class="title-left">
    <span>${titleText}</span>
    <div class="help-icon">?
      <div class="tooltip"><strong>支持的数据格式：</strong><br>1. 纯数字: <code>25.5</code><br>2. 多数据: <code>10, 20.5, 30</code><br>3. 键值对: <code>Temp:25.5</code></div>
    </div>
  </div>
  <div class="win-controls">
    <button class="win-btn" id="btnPin" title="置顶">📌</button>
    <button class="win-btn close" id="btnClose" title="关闭">✕</button>
  </div>
</div>
<div id="main">
  <div id="info-overlay">Waiting for data...</div>
  <div id="debug">Ready.</div>
  <canvas id="c"></canvas>
  <div id="controls">
    <span style="color:#888">绘制点数: <span id="bufSize" style="color:#ccc">0</span></span>
    <div style="flex:1"></div>
    <button class="ctrl-btn" id="btnPause">⏯ 暂停/继续</button>
    <button class="ctrl-btn" id="btnClear">🗑 清空</button>
  </div>
</div>
<script>
  document.getElementById('btnClose').onclick = () => window.close();
  
  const btnPin = document.getElementById('btnPin');
  let isPinned = false;
  btnPin.onclick = () => {
      isPinned = !isPinned;
      btnPin.classList.toggle('pinned', isPinned);
      if (window.opener) {
          window.opener.postMessage({ type: 'toggle-pin', val: isPinned }, '*');
      }
  };

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const info = document.getElementById('info-overlay');
  const debugEl = document.getElementById('debug');
  const bufSize = document.getElementById('bufSize');
  let data = [];
  let paused = false;
  const maxPoints = 1000;

  function resize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
  }
  window.addEventListener('resize', resize);
  setTimeout(resize, 100);

  document.getElementById('btnPause').onclick = () => { 
      paused = !paused; 
      document.getElementById('btnPause').style.background = paused ? '#500' : '';
  };
  document.getElementById('btnClear').onclick = () => { data = []; draw(); };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg === undefined || msg === null) return;
    if (typeof msg === 'object' && msg.type === 'debug') {
         debugEl.textContent = msg.text;
         return;
    }
    const val = parseFloat(msg);
    if(!isNaN(val) && !paused) {
        data.push(val);
        if (data.length > maxPoints) data.shift();
        bufSize.textContent = data.length;
    }
  });

  function draw() {
    requestAnimationFrame(draw);
    if (paused && data.length > 0) return; 
    const w = canvas.width; const h = canvas.height;
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2d2d2d'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h/2); ctx.lineTo(w, h/2); ctx.stroke();

    if (data.length < 2) return;
    let min = Infinity, max = -Infinity;
    for(let v of data) { if(v < min) min = v; if(v > max) max = v; }
    if (min === max) { min -= 1; max += 1; }
    const range = max - min; const padding = 30; const plotH = h - padding * 2;

    ctx.strokeStyle = '#409EFF'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    for(let i = 0; i < data.length; i++) {
        const x = (i / (data.length - 1)) * w;
        const y = h - padding - ((data[i] - min) / range) * plotH;
        if (i===0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    info.innerHTML = \`<span style="color:#aaa">MAX:</span> \${max.toFixed(2)}<br><span style="color:#aaa">MIN:</span> \${min.toFixed(2)}<br><span style="color:#fff;font-weight:bold">NOW:</span> \${data[data.length-1].toFixed(2)}\`;
  }
  draw();
</script>
</body>
</html>
    `);
    doc.close();
}

if (btnShowWave) {
    btnShowWave.addEventListener('click', openWaveWindow);
}

function feedWaveData(id, text) {
    if (!waveWin || waveWin.closed) return;

    waveWin.postMessage({
        type: 'debug',
        text: `[${id}] ${text.replace(/[\\r\\n]/g, ' ').substring(0, 60)}`
    }, '*');

    const matches = text.match(/-?\d+(\.\d+)?/g);
    if (matches) {
        matches.forEach(m => {
            waveWin.postMessage(parseFloat(m), '*');
        });
    }
}

window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'toggle-pin') {
        const shouldPin = event.data.val;
        if (window.api && window.api.window && window.api.window.setOscilloscopeTop) {
            window.api.window.setOscilloscopeTop(shouldPin);
        }
    }
});

(async function init() {
    if (settings.fullscreen) window.api?.window?.setFullscreen(true);
    updateTitlebarSafeArea();
    if (sendRowMain) sendRowMain.style.display = 'none';
    await refreshPortsCombo();
    const saved = await window.api.config.load();
    state.savedConfig = Array.isArray(saved) ? saved : [];
    state.listOrder = state.savedConfig.map(p => p.id || p.path);
    state.savedConfig.forEach(p => {
        const id = p.id || p.path;
        const name = p.name || id || '';
        if (id) createPane(id, name);
    });
    if (window.api.app.onUpdateAvailable) {
        window.api.app.onUpdateAvailable(() => {
            if (btnCheckUpdate) btnCheckUpdate.classList.add('shining-btn');
        });
    }
    await loadCommands();
    document.getElementById('echoSend').checked = true;
    refreshCmdGroupSelect();
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
        cmdGroupsMetaSnapshot = JSON.parse(JSON.stringify(state.cmdGroupsMeta));

        refreshCmdGroupSelect();
        renderCmdTableForCurrentGroup();

        dlgCmdEdit.showModal();
        updateDeleteSelectedBtn();
    }
    cmdEditPage.addEventListener('click', openCmdEditor);

    async function attemptCloseCmdEditor(reason = 'cancel') {
        const dlg = document.getElementById('dlgCmdEdit');
        const changedCommands = JSON.stringify(state.commands) !== JSON.stringify(commandsSnapshot || []);
        const changedGroups = JSON.stringify(state.cmdGroupsMeta || {}) !== JSON.stringify(cmdGroupsMetaSnapshot || {});
        const changed = changedCommands || changedGroups;

        if (changed) {
            const giveup = await uiConfirm('检测到未保存的修改。是否放弃这些改动并返回？', {
                okText: '放弃修改',
                cancelText: '继续编辑'
            });
            if (!giveup) return false;

            if (commandsSnapshot) {
                state.commands = JSON.parse(JSON.stringify(commandsSnapshot));
            }
            if (cmdGroupsMetaSnapshot) {
                state.cmdGroupsMeta = JSON.parse(JSON.stringify(cmdGroupsMetaSnapshot));
            }

            saveCommands();
            saveCmdGroupsMeta(state.cmdGroupsMeta);
            refreshCmdGroupSelect();
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

    document.getElementById('cmdMoveSel')?.addEventListener('click', async () => {
        const ids = Array.from(cmdTableBody.querySelectorAll('.rowSel:checked'))
            .map(ch => ch.dataset.id);
        if (ids.length === 0) {
            updateDeleteSelectedBtn();
            return;
        }

        const meta = state.cmdGroupsMeta;
        if (!meta || !Array.isArray(meta.groups) || meta.groups.length <= 1) {
            uiAlert('当前只有一个分组，没法移动到别的分组');
            return;
        }

        const current = getActiveGroup();
        const candidates = meta.groups.filter(g => g !== current);
        if (!candidates.length) {
            uiAlert('没有可用的目标分组');
            return;
        }

        const target = await uiSelect('选择要移动到的分组：', {
            title: '移动选中的命令',
            okText: '移动',
            cancelText: '取消',
            items: candidates
        });
        if (!target) { safeRefocusInput(); return; }
        if (!candidates.includes(target)) {
            uiAlert('无效的分组');
            safeRefocusInput();
            return;
        }

        state.commands.forEach(cmd => {
            if (ids.includes(cmd.id)) cmd.group = target;
        });

        renderCmdTableForCurrentGroup();
        renderCmdGrid();

        if (cmdSelectAll) cmdSelectAll.checked = false;
        updateDeleteSelectedBtn();
        safeRefocusInput();
    });

    document.getElementById('cmdCopySel')?.addEventListener('click', async () => {
        const ids = Array.from(cmdTableBody.querySelectorAll('.rowSel:checked'))
            .map(ch => ch.dataset.id);
        if (ids.length === 0) {
            updateDeleteSelectedBtn();
            return;
        }

        const meta = state.cmdGroupsMeta;
        if (!meta || !Array.isArray(meta.groups)) {
            uiAlert('分组数据异常');
            return;
        }

        const current = getActiveGroup();

        const candidates = meta.groups.filter(g => g !== current);

        if (candidates.length === 0) {
            uiAlert('没有其他分组可供复制（请先新建分组）');
            return;
        }

        const target = await uiSelect('选择要复制到的目标分组：', {
            title: '复制选中的命令',
            okText: '复制',
            cancelText: '取消',
            items: candidates
        });

        if (!target) { safeRefocusInput(); return; }

        if (!meta.groups.includes(target)) {
            uiAlert('无效的分组');
            safeRefocusInput();
            return;
        }

        const newCommands = [];
        state.commands.forEach(cmd => {
            if (ids.includes(cmd.id)) {
                const copy = { ...cmd, id: cryptoRandomId(), group: target };
                newCommands.push(copy);
            }
        });

        state.commands.push(...newCommands);

        uiAlert(`已成功复制 ${newCommands.length} 条命令到「${target}」`);

        renderCmdGrid();

        const checkedBoxes = cmdTableBody.querySelectorAll('.rowSel:checked');
        checkedBoxes.forEach(box => {
            box.checked = false;
        });

        if (cmdSelectAll) cmdSelectAll.checked = false;

        updateDeleteSelectedBtn();
        safeRefocusInput();
    });

    window.addEventListener('focus', () => setTimeout(safeRefocusInput, 0));
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) setTimeout(safeRefocusInput, 0);
    });

    (function injectShareControls() {
        const containerRow = document.getElementById('row-share-container');
        if (!containerRow) return;

        const shareGroup = document.createElement('div');
        shareGroup.id = 'shareTcpGroup';
        shareGroup.style.display = 'inline-flex';
        shareGroup.style.alignItems = 'center';
        shareGroup.style.gap = '6px';

        shareGroup.innerHTML = `
      <label style="color:#606266;">共享端口：</label> <input id="sharePort" type="number" min="1" max="65535" value="9000" style="width:90px;height:26px">
      <button id="btnShareTcp">共享为 TCP</button>
      <span id="shareInfo" style="margin-left:6px;color:#409EFF;"></span>
      <button id="btnCopyShare" title="复制地址" style="display:none">复制</button>
    `;
        containerRow.appendChild(shareGroup);

        const btn = document.getElementById('btnShareTcp');
        const portInput = document.getElementById('sharePort');
        const info = document.getElementById('shareInfo');
        const btnCopy = document.getElementById('btnCopyShare');

        async function refreshShareUI() {
            const id = state.activeId;
            const pane = id ? state.panes.get(id) : null;
            const isSerial = !!pane && pane.type !== 'tcp';

            containerRow.style.display = isSerial ? 'flex' : 'none';
            shareGroup.style.display = isSerial ? 'inline-flex' : 'none';

            info.textContent = '';
            btnCopy.style.display = 'none';
            if (!isSerial) return;

            const st = await window.api.tcpShare.status(id);
            if (st.active) {
                btn.textContent = '停止共享';
                const first = (st.addrs && st.addrs[0]) || '';
                info.textContent = first ? `已共享：${first}` : `已共享：端口 ${st.port}`;
                btnCopy.style.display = first ? '' : 'none';
                btnCopy.onclick = () => {
                    navigator.clipboard.writeText(first).catch(() => { });
                    info.textContent = `${first}（已复制）`;
                    setTimeout(refreshShareUI, 800);
                };
                portInput.value = String(st.port || 9000);
            } else {
                btn.textContent = '共享为 TCP';
            }
        }

        btn.addEventListener('click', async () => {
            const id = state.activeId;
            if (!id) return alert('请先选择一个面板');
            const pane = state.panes.get(id);
            if (!pane || pane.type === 'tcp') return alert('当前是 TCP 面板，只有串口面板可共享');
            if (!pane.open) return alert('请先打开串口再共享');

            const st = await window.api.tcpShare.status(id);
            if (st.active) {
                await window.api.tcpShare.stop(id);
            } else {
                const p = parseInt(portInput.value || '9000', 10) || 9000;
                const r = await window.api.tcpShare.start(id, p);
                if (!r.ok) return alert('启动共享失败');
            }
            refreshShareUI();
        });

        const _setActive = setActive;
        setActive = function patchedSetActive(id) {
            _setActive(id);
            refreshShareUI();
        };
        window.api.serial.onEvent((evt) => {
            if (evt.id === state.activeId) refreshShareUI();
        });
        setTimeout(refreshShareUI, 300);
    })();

    try {
        const ver = await window.api.app.getVersion();
        const verEl = document.getElementById('appVersion');
        if (verEl) verEl.textContent = ver;
        const lastReadVer = localStorage.getItem('lastReadVersion');
        if (ver && ver !== lastReadVer) {
            if (btnChangelog) {
                btnChangelog.classList.add('shining-btn');
                btnChangelog.title = "发现新版本，点击查看更新内容";
                updateAboutBadge();
            }
        }
    } catch (e) { console.error('获取版本失败', e); }

    function createBrowserPane(url) {
        if (!url.startsWith('http')) url = 'https://' + url;
        const el = document.createElement('div');
        el.className = 'pane browser-pane';

        // 初始化层级
        el.style.zIndex = ++globalZIndex;

        const ws = document.getElementById('workspace');
        const wsW = ws.clientWidth;
        const wsH = ws.clientHeight;
        const paneW = 600;
        const paneH = 450;

        const initLeft = Math.max(60, (wsW - paneW) / 2 + (Math.random() * 40 - 20));
        const initTop = Math.max(10, (wsH - paneH) / 2 + (Math.random() * 40 - 20));

        el.style.left = initLeft + 'px';
        el.style.top = initTop + 'px';
        el.style.width = paneW + 'px';
        el.style.height = paneH + 'px';

        el.innerHTML = `
        <div class="title" style="background:#f0f2f5;">
            <button class="btnChangeUrl" style="margin-right:8px; font-size:12px; padding:0 8px; height:24px;">修改地址</button>
            <div class="name" style="line-height:28px;">Loading...</div>
            <div class="btns">
                <button class="btnBack" title="后退">后退</button>
                <button class="btnRefresh" title="刷新">刷新</button>
                <button class="btnClose" title="关闭窗口" style="color:#F56C6C;">关闭</button>
            </div>
        </div>
        <div class="body" style="padding:0;overflow:hidden;background:#fff;display:flex;flex-direction:column;">
            <webview src="${escHtml(url)}" style="flex:1;width:100%;height:100%;" allowpopups></webview>
        </div>
        <div class="resizer t"></div><div class="resizer r"></div><div class="resizer b"></div><div class="resizer l"></div>
        <div class="resizer tl"></div><div class="resizer tr"></div><div class="resizer bl"></div><div class="resizer br"></div>
        `;

        document.getElementById('panes').appendChild(el);

        const webview = el.querySelector('webview');
        const titleName = el.querySelector('.name');

        const updateTitle = () => {
            try { titleName.textContent = 'Web: ' + new URL(webview.getURL()).hostname; } catch { }
        };

        webview.addEventListener('did-start-loading', () => { titleName.textContent = 'Loading...'; });
        webview.addEventListener('did-stop-loading', updateTitle);
        webview.addEventListener('dom-ready', updateTitle);

        // --- 修改点：定义激活逻辑 ---
        const activateBrowserPane = () => {
            // 1. 调用 setActive(null) 重置底部状态为“未选择”，并清除所有面板的 active 样式
            setActive(null);

            // 2. 手动给自己加上 active 样式（变蓝）
            el.classList.add('active');

            // 3. 提升层级到最前
            const current = parseInt(el.style.zIndex || 0);
            if (current !== globalZIndex) {
                el.style.zIndex = ++globalZIndex;
            }
        };

        // 事件1：Webview 聚焦时激活（点击网页内容）
        webview.addEventListener('focus', activateBrowserPane);

        // 事件2：面板被点击时激活（点击标题栏或边框）
        el.addEventListener('mousedown', (e) => {
            activateBrowserPane();
            // 注意：不要在这里 e.preventDefault()，否则会导致输入框无法聚焦等问题
        });
        // --- 修改结束 ---

        el.querySelector('.btnChangeUrl').onclick = async () => {
            let currentSrc = webview.getURL();
            const newUrl = await uiPrompt('请输入新网址', { title: '跳转', defaultValue: currentSrc });
            if (newUrl) {
                let finalUrl = newUrl;
                if (!finalUrl.startsWith('http')) finalUrl = 'https://' + finalUrl;
                webview.loadURL(finalUrl);
            }
        };

        el.querySelector('.btnBack').onclick = () => { if (webview.canGoBack()) webview.goBack(); };
        el.querySelector('.btnRefresh').onclick = () => { webview.reload(); };
        el.querySelector('.btnClose').onclick = () => { el.remove(); };

        const titleEl = el.querySelector('.title');
        let isDrag = false, startX, startY, startL, startT;

        titleEl.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            isDrag = true;
            startX = e.clientX; startY = e.clientY;
            startL = parseInt(el.style.left || 0); startT = parseInt(el.style.top || 0);
            titleEl.style.cursor = 'grabbing';
            webview.style.pointerEvents = 'none';
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDrag) return;
            let newL = startL + (e.clientX - startX);
            let newT = startT + (e.clientY - startY);

            const ws = document.getElementById('workspace');
            const wsW = ws.clientWidth;
            const wsH = ws.clientHeight;
            const elW = el.offsetWidth;
            const elH = el.offsetHeight;
            const sideW = document.getElementById('sidebar')?.offsetWidth || 56;

            if (newL < sideW) newL = sideW;
            if (newL > wsW - elW) newL = wsW - elW;
            if (newT < 0) newT = 0;
            if (newT > wsH - elH) newT = wsH - elH;

            el.style.left = newL + 'px';
            el.style.top = newT + 'px';
        });

        window.addEventListener('mouseup', () => {
            if (isDrag) {
                isDrag = false;
                titleEl.style.cursor = 'grab';
                webview.style.pointerEvents = 'auto';
            }
        });

        const handles = el.querySelectorAll('.resizer');
        let rs = { active: false, dir: '', sx: 0, sy: 0, sl: 0, st: 0, sw: 0, sh: 0 };

        handles.forEach(h => {
            h.addEventListener('mousedown', (e) => {
                rs.active = true;
                rs.dir = Array.from(h.classList).find(c => /^(t|r|b|l|tl|tr|bl|br)$/.test(c)) || 'br';
                rs.sx = e.clientX; rs.sy = e.clientY;
                rs.sl = el.offsetLeft; rs.st = el.offsetTop;
                rs.sw = el.offsetWidth; rs.sh = el.offsetHeight;
                webview.style.pointerEvents = 'none';
                e.stopPropagation(); e.preventDefault();
            });
        });

        window.addEventListener('mousemove', (e) => {
            if (!rs.active) return;

            const ws = document.getElementById('workspace');
            const wsW = ws.clientWidth, wsH = ws.clientHeight;
            const minW = 200, minH = 150;
            const sideW = document.getElementById('sidebar')?.offsetWidth || 56;
            const leftMin = sideW;

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
                const topMin = 0;
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
        });

        window.addEventListener('mouseup', () => {
            if (rs.active) {
                rs.active = false;
                webview.style.pointerEvents = 'auto';
            }
        });
    }

    (function initContextMenu() {
        const menu = document.createElement('div');
        menu.className = 'ctx-menu';
        menu.id = 'paneCtxMenu';
        document.body.appendChild(menu);

        let currentPaneId = null;

        window.addEventListener('pointerdown', (e) => {
            if (!e.target.closest('.ctx-menu')) {
                menu.classList.remove('visible');
            }
        }, true);
        window.addEventListener('resize', () => menu.classList.remove('visible'));
        window.addEventListener('blur', () => menu.classList.remove('visible'));

        document.addEventListener('contextmenu', (e) => {
            const paneEl = e.target.closest('.pane');
            if (!paneEl) {
                if (e.target.closest('#panes') || e.target.closest('#workspace') || e.target === document.body) {
                    e.preventDefault();
                    menu.innerHTML = '';

                    const addItem = (text, onClick) => {
                        const item = document.createElement('div');
                        item.className = 'ctx-item';
                        item.textContent = text;
                        item.onpointerdown = (evt) => {
                            evt.stopPropagation();
                            menu.classList.remove('visible');
                            onClick();
                        };
                        menu.appendChild(item);
                    };

                    addItem('➕ 新建串口/TCP面板', () => {
                        const btn = document.getElementById('btnNew');
                        if (btn) btn.click();
                    });

                    addItem('🌐 新建浏览器页面', async () => {
                        const url = await uiPrompt('请输入网址 (例如 baidu.com)', { title: '新建浏览器', defaultValue: 'https://satone1008.cn/index.php/2025/09/16/%e6%94%af%e6%8c%81%e5%a4%9a%e7%aa%97%e5%8f%a3%e7%9b%91%e8%a7%86%e7%9a%84%e4%b8%b2%e5%8f%a3%e5%8a%a9%e6%89%8bsaecom/' });
                        if (url) createBrowserPane(url);
                    });

                    let x = e.clientX;
                    let y = e.clientY;
                    if (x + 180 > window.innerWidth) x = window.innerWidth - 185;
                    if (y + 100 > window.innerHeight) y = window.innerHeight - 100;

                    menu.style.left = x + 'px';
                    menu.style.top = y + 'px';
                    menu.classList.add('visible');
                    return;
                }
                menu.classList.remove('visible');
                return;
            }

            e.preventDefault();
            const body = paneEl.querySelector('.body');
            currentPaneId = body ? body.dataset.id : null;
            if (!currentPaneId) return;

            setActive(currentPaneId);

            const pane = state.panes.get(currentPaneId);
            if (!pane) return;

            const selection = window.getSelection().toString();
            const hasSelection = selection && selection.length > 0;
            const isOpen = pane.open;
            const toggleText = isOpen ? (pane.type === 'tcp' ? '关闭连接' : '关闭串口') : (pane.type === 'tcp' ? '打开连接' : '打开串口');

            menu.innerHTML = '';

            const addItem = (text, onClick) => {
                const item = document.createElement('div');
                item.className = 'ctx-item';
                item.textContent = text;
                item.onpointerdown = (evt) => {
                    evt.stopPropagation();
                    menu.classList.remove('visible');
                    onClick();
                };
                menu.appendChild(item);
            };

            const addSeparator = () => {
                const sep = document.createElement('div');
                sep.className = 'ctx-separator';
                menu.appendChild(sep);
            };

            if (hasSelection) {
                addItem('复制选中内容', () => {
                    navigator.clipboard.writeText(selection);
                });
            } else {
                addItem('保存面板数据', () => {
                    btnSaveLog.click();
                });
            }

            addSeparator();

            addItem('隐藏面板', () => {
                const btn = pane.el.querySelector('.btnHide');
                if (btn) btn.click();
            });

            addItem(toggleText, () => {
                const btn = pane.el.querySelector('.btnToggle');
                if (btn) btn.click();
            });

            addItem('弹出面板', () => {
                const btn = pane.el.querySelector('.btnPop');
                if (btn) btn.click();
            });

            addItem('清空面板', async () => {
                const ok = await uiConfirm(`确定要清空面板 “${pane.info.name}” 的数据吗？`, { danger: true, okText: '清空' });
                if (!ok) return;
                const b = pane.el.querySelector('.body');
                if (b) b.innerHTML = '';
                pane.logs = [];
                pane.chunks = [];
                pane.textBuffer = '';
                pane.hexBuffer = '';
                pane.bodyTextNode = null;
                pane.tailTextNode = null;
            });

            addItem('删除面板', async () => {
                const ok = await uiConfirm(`确定删除面板 “${pane.info.name}” 吗？`, { danger: true, okText: '删除' });
                if (!ok) return;
                pane.el.remove();
                state.panes.delete(currentPaneId);
                window.api.config.save(exportPanelsConfig());
                if (state.activeId === currentPaneId) setActive(null);
                refreshPanelList();
            });

            addSeparator();

            addItem('更改面板名称', () => {
                btnAddNote.click();
            });

            addItem('打开示波器', () => {
                openWaveWindow();
            });

            const winW = window.innerWidth;
            const winH = window.innerHeight;
            let x = e.clientX;
            let y = e.clientY;

            if (x + 180 > winW) x = winW - 185;
            if (y + 300 > winH) y = winH - 300;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
            menu.classList.add('visible');
        });
    })();

    updateDeleteSelectedBtn();
})();

function parseChangelogMarkdown(md) {
    if (!md) return '';

    let html = md
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>');

    html = html.replace(/^\*\*(FIX|UPDATE|NEW|OPTIMIZE|REMOVED).*?\*\*/gim, (match, p1) => {
        return `<div class="tag-line">${p1}</div>`;
    });

    html = html
        .replace(/\*\*(.*?)\*\*/gim, '<b>$1</b>')
        .replace(/`(.*?)`/gim, '<code>$1</code>')
        .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

    html = html.replace(/^\s*-\s+(.*)$/gim, '<li>$1</li>');
    html = html.replace(/((<li>.*<\/li>\s*)+)/gim, '<ul>$1</ul>');

    const versionBlockRegex = /(<h3>[\s\S]*?)(?=(<h3>|$))/g;
    html = html.replace(versionBlockRegex, '<div class="version-card">$1</div>');

    return html;
}

const dlgChangelog = document.getElementById('dlgChangelog');
const changelogClose = document.getElementById('changelogClose');
const changelogContent = document.getElementById('changelogContent');

if (changelogClose) {
    changelogClose.addEventListener('click', () => dlgChangelog.close());
}
if (dlgChangelog) {
    dlgChangelog.addEventListener('click', (e) => {
        if (e.target === dlgChangelog) dlgChangelog.close();
    });

    dlgChangelog.addEventListener('close', () => {
        forceUnlockUI({ closeDialogs: false });
    });
}

if (window.api && window.api.changelog && window.api.changelog.onLoad) {
    window.api.changelog.onLoad((text) => {
        if (changelogContent) {
            changelogContent.innerHTML = parseChangelogMarkdown(text);
            forceUnlockUI({ closeDialogs: false });
            try { dlgChangelog.showModal(); } catch (e) { console.error(e); }
        }
    });
}

const CRC_TABLE = [
    0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
    0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
    0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6,
    0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de,
    0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485,
    0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
    0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4,
    0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc,
    0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823,
    0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b,
    0x5af5, 0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12,
    0xdbfd, 0xcbdc, 0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a,
    0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41,
    0xedae, 0xfd8f, 0xcdec, 0xddcd, 0xad2a, 0xbd0b, 0x8d68, 0x9d49,
    0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70,
    0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a, 0x9f59, 0x8f78,
    0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f,
    0x1080, 0x00a1, 0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
    0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e,
    0x02b1, 0x1290, 0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256,
    0xb5ea, 0xa5cb, 0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d,
    0x34e2, 0x24c3, 0x14a0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
    0xa7db, 0xb7fa, 0x8799, 0x97b8, 0xe75f, 0xf77e, 0xc71d, 0xd73c,
    0x26d3, 0x36f2, 0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634,
    0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9, 0xb98a, 0xa9ab,
    0x5844, 0x4865, 0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882, 0x28a3,
    0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a,
    0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92,
    0xfd2e, 0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9,
    0x7c26, 0x6c07, 0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1,
    0xef1f, 0xff3e, 0xcf5d, 0xdf7c, 0xaf9b, 0xbfba, 0x8fd9, 0x9ff8,
    0x6e17, 0x7e36, 0x4e55, 0x5e74, 0x2e93, 0x3eb2, 0x0ed1, 0x1ef0
];

function calcCRC16(buffer) {
    let crc = 0x0000;
    for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i];
        const index = ((crc >>> 8) ^ byte) & 0xFF;
        crc = ((crc << 8) ^ CRC_TABLE[index]) & 0xFFFF;
    }
    return crc;
}

const YM_SOH = 0x01;
const YM_STX = 0x02;
const YM_EOT = 0x04;
const YM_ACK = 0x06;
const YM_NAK = 0x15;
const YM_CAN = 0x18;
const YM_CNC = 0x43;

class YModemSender {
    constructor(id, protocol = 'ymodem', logger = () => { }) {
        this.id = id;
        this.protocol = protocol.toLowerCase();
        this.logger = logger;
        this.resolveWait = null;
        this.rejectWait = null;
        this.rxBuffer = [];
        this.targetBytes = [];
    }

    onData(bytes) {
        for (let i = 0; i < bytes.length; i++) {
            this.rxBuffer.push(bytes[i]);
        }
        if (this.resolveWait) this.checkWait();
    }

    checkWait() {
        while (this.rxBuffer.length > 0) {
            if (!this.resolveWait) return;
            const byte = this.rxBuffer.shift();
            if (this.targetBytes.includes(byte)) {
                const resolver = this.resolveWait;
                this.cleanupWait();
                if (resolver) resolver(byte);
                return;
            } else {
            }
        }
    }

    waitFor(byteCodes, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            this.resolveWait = resolve;
            this.rejectWait = reject;
            this.targetBytes = Array.isArray(byteCodes) ? byteCodes : [byteCodes];

            this.checkWait();

            this.timer = setTimeout(() => {
                const targets = this.targetBytes.map(b => '0x' + b.toString(16)).join(',');
                this.cleanupWait();
                reject(new Error(`等待超时 (期望: ${targets})`));
            }, timeoutMs);
        });
    }

    cleanupWait() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.resolveWait = null;
        this.rejectWait = null;
        this.targetBytes = [];
    }

    async write(data) {
        const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('写入超时')), 5000)
        );

        try {
            const isTcp = this.id.startsWith('tcp://');
            const writePromise = isTcp
                ? window.api.tcp.write(this.id, hex, 'hex')
                : window.api.serial.write(this.id, hex, 'hex');
            const res = await Promise.race([writePromise, timeoutPromise]);
            if (!res.ok) throw new Error(res.error || 'Write Failed');
        } catch (e) {
            this.logger(`[Error] 写入失败: ${e.message}`);
            throw e;
        }
    }

    async start(fileBytes, fileName) {
        try {
            this.logger(`准备传输: ${fileName} (${fileBytes.length} 字节)`);

            await this.waitFor(YM_CNC, 60000);

            if (this.protocol === 'ymodem') {
                await this.sendBlock0(fileName, fileBytes.length);

                await this.waitFor(YM_ACK);
                await this.waitFor(YM_CNC);
            }

            let seq = 1;
            let offset = 0;
            const total = fileBytes.length;

            this.logger('开始发送数据...');

            while (offset < total) {
                let size = 1024;
                let chunk = fileBytes.slice(offset, offset + size);

                if (chunk.length < size) {
                    const pad = new Uint8Array(size);
                    pad.set(chunk);
                    pad.fill(0x1A, chunk.length);
                    chunk = pad;
                }

                await this.sendPacket(seq, chunk);

                try {
                    await this.waitFor(YM_ACK);
                    offset += size;

                    const progress = Math.min(100, Math.round((offset / total) * 100));
                    if (seq % 5 === 0 || offset >= total) {
                        this.logger(`进度: ${progress}%`);
                    }
                    seq++;
                } catch (e) {
                    this.logger(`包 ${seq} 超时，正在重试...`);
                }
            }

            this.logger('发送结束信号...');
            await this.write(new Uint8Array([YM_EOT]));

            try {
                const resp = await this.waitFor([YM_ACK, YM_NAK]);
                if (resp === YM_NAK) {
                    await this.write(new Uint8Array([YM_EOT]));
                    await this.waitFor(YM_ACK);
                }
            } catch (e) {
            }

            if (this.protocol === 'ymodem') {
                await this.waitFor(YM_CNC);
                await this.sendBlock0('', 0);
                await this.waitFor(YM_ACK);
            }

            this.logger('传输完成！✅');

        } catch (err) {
            this.logger(`[Stop] 传输中止: ${err.message}`);
            try { await this.write(new Uint8Array([YM_CAN, YM_CAN, YM_CAN, YM_CAN, YM_CAN])); } catch { }
        } finally {
            activeTransfer = null;
        }
    }

    async sendBlock0(name, size) {
        const payload = new Uint8Array(128);
        if (name) {
            const encoder = new TextEncoder();
            const nameBytes = encoder.encode(name);
            const maxLen = 100;
            if (nameBytes.length > maxLen) {
                payload.set(nameBytes.slice(0, maxLen), 0);
            } else {
                payload.set(nameBytes, 0);
            }
            let p = nameBytes.length + 1;
            if (p < 120) {
                const sizeStr = size.toString() + ' ';
                const sizeBytes = encoder.encode(sizeStr);
                payload.set(sizeBytes, p);
            }
        }
        await this.sendPacket(0, payload, 128);
    }

    async sendPacket(seq, data, forceSize = null) {
        const size = forceSize || data.length;
        const head = (size === 1024) ? YM_STX : YM_SOH;
        const seqByte = seq & 0xFF;
        const seqComp = (~seq) & 0xFF;

        const header = new Uint8Array([head, seqByte, seqComp]);
        const crc = calcCRC16(data);
        const crcBytes = new Uint8Array([(crc >> 8) & 0xFF, crc & 0xFF]);

        const packet = new Uint8Array(header.length + data.length + crcBytes.length);
        packet.set(header, 0);
        packet.set(data, header.length);
        packet.set(crcBytes, header.length + data.length);

        await this.write(packet);
    }
}

const BLOCK_DEFS = {
    'send': {
        title: '发送数据', icon: '📤', color: '#409EFF',
        render: (data) => `
            <div class="vs-row"><input class="vs-input data-content" placeholder="发送的内容" value="${escHtml(data.content || '')}"></div>
            <div class="vs-row">
                <select class="vs-select data-mode"><option value="text" ${data.mode === 'text' ? 'selected' : ''}>Text</option><option value="hex" ${data.mode === 'hex' ? 'selected' : ''}>Hex</option></select>
                <select class="vs-select data-append">
                    <option value="CRLF" ${data.append === 'CRLF' ? 'selected' : ''}>+ \\r\\n</option>
                    <option value="CR" ${data.append === 'CR' ? 'selected' : ''}>+ \\r</option>
                    <option value="LF" ${data.append === 'LF' ? 'selected' : ''}>+ \\n</option>
                    <option value="none" ${data.append === 'none' ? 'selected' : ''}>无结尾</option>
                </select>
            </div>`
    },
    'delay': {
        title: '延时等待', icon: '⏱', color: '#909399',
        render: (data) => `<div class="vs-row"><input type="number" class="vs-input data-ms" value="${data.ms || 1000}"><label>ms</label></div>`
    },
    'loop': {
        title: '循环执行', icon: '🔁', color: '#67C23A', isContainer: true,
        render: (data) => `<div class="vs-row"><label>循环次数</label><input type="number" class="vs-input data-count" value="${data.count || ''}" placeholder="填0则无限循环"></div><div class="vs-sub-container" data-slot="body"></div>`
    },
    'comment': {
        title: '备注', icon: '📝', color: '#606266',
        render: (data) => `<div class="vs-row"><textarea class="vs-input data-text" placeholder="在此输入备注信息" rows="2">${escHtml(data.text || '')}</textarea></div>`
    },
    'if_contains': {
        title: '条件判断', icon: '❓', color: '#F56C6C', isContainer: true, hasElse: true,
        render: (data) => `
            <div class="vs-row"><label>如果有</label><input class="vs-input data-match" placeholder="想要读取的字符" value="${escHtml(data.match || '')}"></div>
            <div class="vs-sub-container" data-slot="then"></div><div class="vs-slot-separator">否则</div><div class="vs-sub-container" data-slot="else"></div>`
    }
};

function createBlockElement(type, data = {}) {
    const def = BLOCK_DEFS[type];
    if (!def) return null;
    const el = document.createElement('div');
    el.className = `vs-block ${def.isContainer ? 'container-block' : ''}`;
    el.dataset.type = type;
    el.style.borderLeft = `4px solid ${def.color}`;
    el.innerHTML = `
        <div class="vs-block-header" draggable="true">
            <span class="icon">${def.icon}</span>
            <span class="vs-block-title">${def.title}</span>
            <span class="vs-block-del">×</span>
        </div>
        <div class="vs-block-body">${def.render(data)}</div>`;
    el.querySelector('.vs-block-del').onclick = (e) => { e.stopPropagation(); el.remove(); checkPlaceholder(); };
    if (def.isContainer) {
        if (def.hasElse) {
            const t = el.querySelector('[data-slot="then"]'), e = el.querySelector('[data-slot="else"]');
            if (data.childrenThen) data.childrenThen.forEach(c => t.appendChild(createBlockElement(c.type, c) || ''));
            if (data.childrenElse) data.childrenElse.forEach(c => e.appendChild(createBlockElement(c.type, c) || ''));
            initDragZone(t); initDragZone(e);
        } else {
            const b = el.querySelector('.vs-sub-container');
            if (data.children) data.children.forEach(c => b.appendChild(createBlockElement(c.type, c) || ''));
            initDragZone(b);
        }
    }
    initBlockDrag(el);
    return el;
}

function serializeBlocks(c) { const b = [];[...c.children].forEach(el => { if (!el.classList.contains('vs-block')) return; const t = el.dataset.type, def = BLOCK_DEFS[t], d = { type: t }; el.querySelectorAll(':scope>.vs-block-body .vs-input,:scope>.vs-block-body .vs-select').forEach(i => d[[...i.classList].find(c => c.startsWith('data-'))?.substring(5)] = i.value); if (def.isContainer) { if (def.hasElse) { d.childrenThen = serializeBlocks(el.querySelector('[data-slot="then"]')); d.childrenElse = serializeBlocks(el.querySelector('[data-slot="else"]')); } else { d.children = serializeBlocks(el.querySelector('.vs-sub-container')); } } b.push(d); }); return b; }
function loadBlocks(c, d) { c.innerHTML = '<div class="vs-placeholder">从左侧拖拽模块到此处...</div>'; if (!d) return; d.forEach(i => { const e = createBlockElement(i.type, i); if (e) c.appendChild(e) }); checkPlaceholder(); }
function escJs(s) { return (s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n'); }
function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function checkPlaceholder() { const vsCanvas = document.getElementById('vsCanvas'); if (vsCanvas) vsCanvas.querySelector('.vs-placeholder').style.display = vsCanvas.querySelector('.vs-block') ? 'none' : 'block'; }
function getDragAfterElement(c, y) { return [...c.querySelectorAll(':scope>.vs-block:not(.vs-dragging)')].reduce((r, e) => { const box = e.getBoundingClientRect(), off = y - box.top - box.height / 2; return (off < 0 && off > r.offset) ? { offset: off, element: e } : r }, { offset: Number.NEGATIVE_INFINITY }).element; }

function compileBlocksToJS(blocks) {
    let code = `try {\n`;
    let loopIdx = 0;

    function traverse(list, indent = '  ') {
        let script = '';
        list.forEach(block => {
            script += `${indent}if (await checkStop()) return;\n`;

            if (block.type === 'send') {
                script += `${indent}await send("${escJs(block.content)}", "${block.mode}", "${block.append}");\n`;
            } else if (block.type === 'delay') {
                script += `${indent}await sleep(${block.ms});\n`;
            } else if (block.type === 'comment') {
                const lines = (block.text || '').split(/\r?\n/);
                lines.forEach(line => {
                    script += `${indent}// ${line}\n`;
                });
            } else if (block.type === 'loop') {
                const ivar = `i_${loopIdx++}`;
                const count = parseInt(block.count || 0);
                if (count > 0) script += `${indent}for (let ${ivar}=0; ${ivar}<${count}; ${ivar}++) {\n`;
                else script += `${indent}while (true) {\n`;
                script += `${indent}  await sleep(10);\n`;
                if (block.children) script += traverse(block.children, indent + '  ');
                script += `${indent}}\n`;
            } else if (block.type === 'if_contains') {
                script += `${indent}var _recv = await waitOnePacket();\n`;
                script += `${indent}if ((_recv||'').includes("${escJs(block.match)}")) {\n`;
                if (block.childrenThen) script += traverse(block.childrenThen, indent + '  ');
                script += `${indent}} else {\n`;
                if (block.childrenElse) script += traverse(block.childrenElse, indent + '  ');
                script += `${indent}}\n`;
            }
        });
        return script;
    }

    code += traverse(blocks);
    code += `  } catch (e) { \n    if(e.message!=='ABORTED') console.log("Error: "+e.message); \n  }`;
    return code;
}

let vsDragSrc = null;
function initDragZone(z) { if (z._d) return; z._d = 1; z.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); z.classList.add('drag-over'); const a = getDragAfterElement(z, e.clientY), d = document.querySelector('.vs-dragging'); if (d) a ? z.insertBefore(d, a) : z.appendChild(d) }); z.addEventListener('dragleave', () => z.classList.remove('drag-over')); z.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); z.classList.remove('drag-over'); if (vsDragSrc && vsDragSrc.classList.contains('vs-block-template')) { const t = vsDragSrc.dataset.type, n = createBlockElement(t), a = getDragAfterElement(z, e.clientY); if (n) { a ? z.insertBefore(n, a) : z.appendChild(n); checkPlaceholder(); } } }); }
function initBlockDrag(e) { const h = e.querySelector('.vs-block-header'); h.addEventListener('dragstart', ev => { vsDragSrc = e; e.classList.add('vs-dragging'); ev.dataTransfer.effectAllowed = 'move'; ev.stopPropagation(); }); h.addEventListener('dragend', () => { e.classList.remove('vs-dragging'); vsDragSrc = null; }); }

let isRefeshing = false;
async function refreshScriptList() {
    const el = document.getElementById('scriptList');
    if (!el) return;
    try {
        const files = await window.api.scripts.list();
        el.innerHTML = '';
        [...new Set(files)].forEach(name => {
            const li = document.createElement('li');
            li.textContent = name;
            if (currentScript === name) {
                li.classList.add('active');
            }
            li.onclick = async () => {
                try {
                    const content = await window.api.scripts.read(name);
                    const evt = new CustomEvent('script-selected', { detail: { name, content } });
                    document.dispatchEvent(evt);

                    Array.from(el.children).forEach(c => c.classList.remove('active'));
                    li.classList.add('active');
                } catch (err) {
                    console.error("Read script failed:", err);
                }
            };
            el.appendChild(li);
        });
    } catch (err) {
        console.error("Refresh list failed:", err);
    }
}

(function initVisualScriptSystem() {
    console.log('[VS_DEBUG] Visual Script System Initializing...');

    const runningScripts = {};
    let currentScript = null;
    let scriptSnapshot = null;
    function getCurrentBlockState() {
        return JSON.stringify(serializeBlocks(document.getElementById('vsCanvas')));
    }
    async function checkUnsavedAndProceed() {
        if (!currentScript) return true;

        const currentState = getCurrentBlockState();
        if (scriptSnapshot !== null && currentState !== scriptSnapshot) {

            const wantSave = await uiConfirm(`脚本 "${currentScript}" 有未保存的修改。\n是否保存修改？`, {
                okText: '保存',
                cancelText: '不保存'
            });

            if (wantSave) {
                const btn = document.getElementById('btnScriptSave');
                if (btn) btn.click();
                await new Promise(r => setTimeout(r, 200));

                if (getCurrentBlockState() === scriptSnapshot) {
                    return true;
                } else {
                    return false;
                }
            } else {
                return true;
            }
        }
        return true;
    }

    const vsCanvas = document.getElementById('vsCanvas');
    const btnScriptNew = document.getElementById('btnScriptNew');
    const btnScriptSave = document.getElementById('btnScriptSave');
    const btnScriptRun = document.getElementById('btnScriptRun');
    const btnScriptStop = document.getElementById('btnScriptStop');
    const btnScriptClose = document.getElementById('btnScriptClose');
    const btnScriptDelete = document.getElementById('btnScriptDelete');
    const currentScriptName = document.getElementById('currentScriptName');
    const dlgScript = document.getElementById('dlgScript');
    const currentPanelLabel = document.getElementById('currentPanelLabel');

    async function refreshScriptList() {
        const el = document.getElementById('scriptList');
        if (!el) return;

        try {
            const files = await window.api.scripts.list();
            el.innerHTML = '';
            [...new Set(files)].forEach(name => {
                const li = document.createElement('li');
                li.textContent = name;
                if (currentScript === name) {
                    li.classList.add('active');
                }

                li.onclick = async () => {
                    if (currentScript !== name) {
                        if (!await checkUnsavedAndProceed()) return;
                    }
                    try {
                        const content = await window.api.scripts.read(name);
                        const evt = new CustomEvent('script-selected', { detail: { name, content } });
                        document.dispatchEvent(evt);
                        Array.from(el.children).forEach(c => c.classList.remove('active'));
                        li.classList.add('active');
                    } catch (err) {
                        console.error("Read script failed:", err);
                    }
                };
                el.appendChild(li);
            });
        } catch (err) {
            console.error("Refresh list failed:", err);
        }
    }

    document.addEventListener('script-selected', (e) => {
        const { name, content } = e.detail;
        currentScript = name;
        if (currentScriptName) {
            currentScriptName.textContent = name;
            currentScriptName.style.color = "";
            currentScriptName.style.fontWeight = "";
        }

        const m = content.match(/\/\* VS_BLOCKS_START\n([\s\S]*?)\nVS_BLOCKS_END \*\//);
        vsCanvas.innerHTML = '';
        if (m && m[1]) {
            try {
                loadBlocks(vsCanvas, JSON.parse(m[1]));
            } catch {
                vsCanvas.innerHTML = '<div class="vs-placeholder">数据解析失败</div>';
            }
        } else {
            vsCanvas.innerHTML = '<div class="vs-placeholder">纯代码模式无法可视化编辑</div>';
        }
        setTimeout(() => {
            scriptSnapshot = getCurrentBlockState();
        }, 10);
        updateEditorState('ScriptSelected');
    });

    let tooltipEl = document.getElementById('vs-tooltip-overlay');
    if (tooltipEl && tooltipEl.parentElement === document.body) {
        tooltipEl.remove();
        tooltipEl = null;
    }
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'vs-tooltip-overlay';
        if (dlgScript) dlgScript.appendChild(tooltipEl);
    }
    function updateTooltipPos(e) {
        if (!dlgScript) return;
        const dlgRect = dlgScript.getBoundingClientRect();
        const offset = 15;
        let relX = e.clientX - dlgRect.left + offset;
        let relY = e.clientY - dlgRect.top + offset;
        if (relX + 320 > dlgRect.width) relX = e.clientX - dlgRect.left - 330;
        if (relY + 150 > dlgRect.height) relY = e.clientY - dlgRect.top - 120;
        tooltipEl.style.left = relX + 'px';
        tooltipEl.style.top = relY + 'px';
    }
    document.querySelectorAll('.vs-block-template').forEach(tpl => {
        const helpIcon = tpl.querySelector('.vs-tpl-help');
        const desc = helpIcon ? helpIcon.getAttribute('data-real-desc') : null;
        if (helpIcon && desc) {
            helpIcon.addEventListener('mouseenter', (e) => {
                tooltipEl.textContent = desc;
                tooltipEl.style.display = 'block';
                tooltipEl.style.zIndex = '999999';
                updateTooltipPos(e);
            });
            helpIcon.addEventListener('mousemove', (e) => updateTooltipPos(e));
            helpIcon.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; });
        }
        tpl.addEventListener('dragstart', (e) => {
            vsDragSrc = tpl;
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('type', tpl.dataset.type);
            tooltipEl.style.display = 'none';
        });
        tpl.addEventListener('dragend', () => vsDragSrc = null);
    });
    initDragZone(vsCanvas);

    function updateEditorState(reason = 'Unknown') {
        const panelId = state ? state.activeId : null;
        const hasScript = !!currentScript;

        let displayName = "未选择面板";
        let isPanelSelected = false;
        if (panelId && state.panes.has(panelId)) {
            const pane = state.panes.get(panelId);
            displayName = (pane.note && pane.note.trim()) ? pane.note : (pane.info.name || panelId);
            isPanelSelected = true;
        }
        if (currentPanelLabel) {
            currentPanelLabel.textContent = displayName;
            currentPanelLabel.style.color = isPanelSelected ? "#E6A23C" : "#909399";
        }

        if (!hasScript) {
            vsCanvas.classList.add('vs-disabled');
        } else {
            vsCanvas.classList.remove('vs-disabled');
        }

        if (btnScriptSave) btnScriptSave.disabled = !hasScript;
        if (btnScriptDelete) btnScriptDelete.disabled = !hasScript;

        const activeRunId = runningScripts[panelId];

        if (!isPanelSelected) {
            if (btnScriptRun) btnScriptRun.disabled = true;
            if (btnScriptStop) btnScriptStop.disabled = true;
        } else if (activeRunId) {
            if (btnScriptRun) btnScriptRun.disabled = true;
            if (btnScriptStop) {
                btnScriptStop.disabled = false;
                btnScriptStop.removeAttribute('disabled');
                btnScriptStop.innerText = "⏹ 停止脚本";
                btnScriptStop.style.opacity = "1";
            }
        } else {
            if (btnScriptRun) {
                btnScriptRun.disabled = !hasScript;
                if (hasScript) btnScriptRun.removeAttribute('disabled');
            }
            if (btnScriptStop) {
                btnScriptStop.disabled = true;
                btnScriptStop.innerText = "⏹ 停止";
                btnScriptStop.style.opacity = "0.5";
            }
        }
    }

    const openBtn = document.getElementById('openScript');
    if (openBtn) {
        openBtn.onclick = () => {
            dlgScript.showModal();
            refreshScriptList();
            if (!currentScript) {
                currentScriptName.textContent = '（未选中）';
                vsCanvas.innerHTML = '<div class="vs-placeholder">请从右侧选择脚本，或点击“新建”</div>';
            } else {
                checkPlaceholder();
            }
            updateEditorState('DialogOpen');
        };
    }
    if (btnScriptClose) btnScriptClose.onclick = async () => {
        if (await checkUnsavedAndProceed()) {
            dlgScript.close();
            currentScript = null;
            scriptSnapshot = null;
        }
    };

    if (btnScriptNew) btnScriptNew.onclick = async () => {
        if (!await checkUnsavedAndProceed()) return;
        try {
            let files = [];
            try { files = await window.api.scripts.list(); } catch (e) { console.error(e); }
            if (!Array.isArray(files)) files = [];

            let i = 1;
            while (files.includes(`Script_${i}.js`)) i++;
            const name = await uiPrompt('新建脚本名称', { defaultValue: `Script_${i}.js` });
            if (!name) return;

            const filename = name.endsWith('.js') ? name : name + '.js';
            const defaultBlocks = [
                {
                    type: 'comment',
                    text: '这是一个示例脚本。作用是一直监听串口收到的数据。每次收到的数据时，如果包含“123”则回复收到，否则则回复未收到。（循环次数0意为无限循环。）'
                },
                {
                    type: 'loop',
                    count: '0',
                    children: [
                        {
                            type: 'if_contains',
                            match: '123',
                            childrenThen: [
                                {
                                    type: 'send',
                                    content: '收到',
                                    mode: 'text',
                                    append: 'CRLF'
                                }
                            ],
                            childrenElse: [
                                {
                                    type: 'send',
                                    content: '未收到',
                                    mode: 'text',
                                    append: 'CRLF'
                                }
                            ]
                        }
                    ]
                }
            ];
            const js = compileBlocksToJS(defaultBlocks);
            const content = `/* VS_BLOCKS_START\n${JSON.stringify(defaultBlocks)}\nVS_BLOCKS_END */\n\n${js}`;
            const res = await window.api.scripts.write(filename, content);
            if (res.ok) {
                await refreshScriptList();

                const el = document.getElementById('scriptList');
                if (el) {
                    const newLi = Array.from(el.children).find(li => li.textContent === filename);
                    if (newLi) {
                        newLi.click();
                    }
                }

                updateEditorState('NewScriptCreated');
            } else {
                uiAlert('创建失败: ' + res.error);
            }
        } catch (err) {
            console.error(err);
            uiAlert('发生未知错误: ' + err.message);
        }
    };

    if (btnScriptSave) btnScriptSave.onclick = async () => {
        if (!currentScript) return;
        const data = serializeBlocks(vsCanvas);
        const js = compileBlocksToJS(data);
        const content = `/* VS_BLOCKS_START\n${JSON.stringify(data)}\nVS_BLOCKS_END */\n\n${js}`;

        btnScriptSave.classList.add('btn-loading');
        try {
            const res = await window.api.scripts.write(currentScript, content);
            if (res.ok) {
                scriptSnapshot = getCurrentBlockState();
                updateEditorState('Saved');
                const originalText = currentScript;

                currentScriptName.textContent = "保存成功！";
                currentScriptName.style.color = "#67C23A";
                currentScriptName.style.fontWeight = "bold";

                setTimeout(() => {
                    if (currentScriptName.textContent === "保存成功！") {
                        currentScriptName.textContent = originalText;
                        currentScriptName.style.color = "";
                        currentScriptName.style.fontWeight = "";
                    }
                }, 2000);
            } else {
                uiAlert('保存失败: ' + (res.error || '未知错误'));
            }
        } finally {
            btnScriptSave.classList.remove('btn-loading');
        }
    };

    if (btnScriptDelete) btnScriptDelete.onclick = async () => {
        if (!currentScript) return;
        if (await uiConfirm(`确定删除脚本 “${currentScript}” 吗？`, { danger: true })) {
            await window.api.scripts.delete(currentScript);
            currentScript = null;
            currentScriptName.textContent = '（未选中）';
            currentScriptName.style.color = "";
            currentScriptName.style.fontWeight = "";
            vsCanvas.innerHTML = '<div class="vs-placeholder">请从右侧选择脚本，或点击“新建”</div>';

            await refreshScriptList();
            updateEditorState('ScriptDeleted');
        }
    };

    if (btnScriptRun) btnScriptRun.onclick = async () => {
        const panelId = state ? state.activeId : null;
        if (!panelId) return uiAlert('请先在主界面选择一个面板！');

        const blocksData = serializeBlocks(vsCanvas);
        const jsCode = compileBlocksToJS(blocksData);

        if (currentScript) {
            const fileContent = `/* VS_BLOCKS_START\n${JSON.stringify(blocksData)}\nVS_BLOCKS_END */\n\n${jsCode}`;
            window.api.scripts.write(currentScript, fileContent);
        }
        btnScriptRun.disabled = true;
        const res = await window.api.scripts.run(jsCode, { id: panelId });
        if (res.ok) {
            runningScripts[panelId] = res.runId;
            updateEditorState('RunStarted');
            refreshScriptList();
        } else {
            uiAlert('启动失败: ' + res.error);
            updateEditorState('RunFailed');
        }
    };

    if (btnScriptStop) btnScriptStop.onclick = async () => {
        const panelId = state ? state.activeId : null;
        if (!panelId) return;
        const runId = runningScripts[panelId];
        if (runId) {
            btnScriptStop.disabled = true;
            await window.api.scripts.stop(runId);
        }
    };

    if (window.api.scripts && window.api.scripts.onEnded) {
        window.api.scripts.onEnded((res) => {
            let targetPanelId = null;
            for (const [pId, rId] of Object.entries(runningScripts)) {
                if (rId === res.runId) { targetPanelId = pId; break; }
            }
            if (targetPanelId) {
                delete runningScripts[targetPanelId];
                if (state && state.activeId === targetPanelId) {
                    updateEditorState('ScriptEnded');
                }
            }
        });
    }

    const listOb = new MutationObserver(() => { if (dlgScript.open) updateEditorState('PanelSwitched'); });
    if (document.getElementById('panelList')) {
        listOb.observe(document.getElementById('panelList'), { subtree: true, attributes: true, attributeFilter: ['class'] });
    }
})();

const settingsNavItems = document.querySelectorAll('.settings-nav-item');
const settingsSections = document.querySelectorAll('.settings-section');

settingsNavItems.forEach(item => {
    item.addEventListener('click', () => {
        settingsNavItems.forEach(n => n.classList.remove('active'));
        settingsSections.forEach(s => s.classList.remove('active'));
        item.classList.add('active');
        const targetId = `tab-${item.dataset.tab}`;
        const targetSection = document.getElementById(targetId);
        if (targetSection) {
            targetSection.classList.add('active');
        }
    });
});

window.addEventListener('mousedown', (e) => {
    const p = e.target.closest('.pane');
    if (p) {
        const current = parseInt(p.style.zIndex || 0);
        if (current !== globalZIndex) {
            p.style.zIndex = ++globalZIndex;
        }
    }
}, true);

(function initTelemetry() {
    const STORAGE_KEY = 'app_device_id';
    
    let deviceId = localStorage.getItem(STORAGE_KEY);
    if (!deviceId) {
        deviceId = 'u_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
        localStorage.setItem(STORAGE_KEY, deviceId);
    }
    const reportLaunch = async () => {
        const API_URL = 'https://filebox.satone1008.cn/report.php'; 
        
        let realVersion = '1.0.0';
        try {
            if (window.api && window.api.app && window.api.app.getVersion) {
                realVersion = await window.api.app.getVersion();
            } else {
                realVersion = document.getElementById('appVersion')?.textContent || '1.0.0';
            }
        } catch (e) {
        }

        let geoData = {};
        try {
            const geoRes = await fetch('http://ip-api.com/json/?lang=zh-CN');
            if (geoRes.ok) {
                geoData = await geoRes.json();
            }
        } catch (e) {
        }

        try {
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    uid: deviceId,
                    version: realVersion,
                    os: navigator.platform,
                    timestamp: Date.now(),
                    ip: geoData.query || '',
                    country: geoData.country || '',
                    region: geoData.regionName || '',
                    city: geoData.city || '',
                    isp: geoData.isp || ''
                })
            });
        } catch (e) {
        }
    };
    setTimeout(reportLaunch, 5000);
})();