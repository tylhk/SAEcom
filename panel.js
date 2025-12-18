try {
    const s = JSON.parse(localStorage.getItem('appSettings') || '{}');
    if (s.dark) document.documentElement.classList.add('theme-dark');
} catch { }

if (window.api && window.api.theme) {
    window.api.theme.onApply(({ dark }) => {
        document.documentElement.classList.toggle('theme-dark', !!dark);
    });
}

function nowTs() {
    const d = new Date();
    const pad = (n, len = 2) => n.toString().padStart(len, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.`
        + `${pad(d.getMilliseconds(), 3)}`;
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const params = new URLSearchParams(location.search);
let portId = params.get('id');
let winTitle = params.get('title') || `串口窗口 - ${portId || ''}`;
let isOpen = params.get('isOpen') === '1';
let viewMode = params.get('viewMode') || 'text';
let portOptions = {};
try { portOptions = JSON.parse(params.get('opts') || '{}'); } catch {}

const titleEl = document.getElementById('title');
const displayEl = document.getElementById('display');
const btnToggle = document.getElementById('btnToggle');
const btnHex = document.getElementById('btnHex');
const btnHide = document.getElementById('btnHide');
const btnDock = document.getElementById('btnDock');
const inputEl = document.getElementById('popInputData');
const btnSend = document.getElementById('popBtnSend');
const appendSel = document.getElementById('popAppend');
const hexModeEl = document.getElementById('popHexMode');
const echoSendEl = document.getElementById('popEchoSend');

const isTcp = (portId || '').startsWith('tcp://');

function updateToggleBtn() {
    const kind = isTcp ? '连接' : '串口';
    btnToggle.textContent = isOpen ? `关闭${kind}` : `打开${kind}`;
    btnToggle.style.color = ''; 
}

function updateHexBtn() {
    btnHex.textContent = (viewMode === 'hex') ? '文本显示' : 'HEX显示';
    btnHex.style.color = '';
}

titleEl.textContent = winTitle;
updateToggleBtn();
updateHexBtn();

btnToggle.addEventListener('click', async () => {
    if (isOpen) {
        if (isTcp) await window.api.tcp.close(portId);
        else await window.api.serial.close(portId);
    } else {
        if (isTcp) {
            const s = portId.slice(6); const i = s.lastIndexOf(':');
            const host = s.slice(0, i); const port = parseInt(s.slice(i + 1), 10);
            await window.api.tcp.open(host, port, null);
        } else {
            await window.api.serial.open(portId, portOptions); 
        }
    }
});
let chunks = [];
btnHex.addEventListener('click', () => {
    viewMode = (viewMode === 'text' ? 'hex' : 'text');
    updateHexBtn();
    redraw();
});

btnHide.addEventListener('click', () => {
    window.api.panel.requestHide(portId);
});

btnDock.addEventListener('click', () => {
    const text = displayEl.innerText || displayEl.textContent || '';
    window.api.panel.requestDock(portId, text);
    window.close();
});

window.api.panel.onLoadContent(({ id, historyStr }) => {
    if (id === portId) {
        try { chunks = JSON.parse(historyStr || '[]'); } catch { chunks = []; }
        redraw();
    }
});

function redraw() {
    displayEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const c of chunks) {
        const span = document.createElement('span');
        if (c.isEcho) {
            span.className = 'echo-line';
            span.textContent = c.text;
        } else {
            let content = (viewMode === 'hex') ? c.hex : c.text;
            if (viewMode === 'hex') {
                 content = content.replace(/\n /g, '\n'); 
                 if (content.endsWith('\n ')) content = content.slice(0, -1);
            }
            span.textContent = content;
        }
        frag.appendChild(span);
    }
    displayEl.appendChild(frag);
    displayEl.scrollTop = displayEl.scrollHeight;
}

function appendSysText(text) {
    let lastContent = '';
    if (chunks.length > 0) {
        const last = chunks[chunks.length - 1];
        lastContent = (viewMode === 'hex') ? last.hex : last.text;
    }
    const needBreak = (lastContent && !lastContent.endsWith('\n'));

    const finalStr = (needBreak ? '\n' : '') + text + '\n';
    
    const span = document.createElement('span');
    span.textContent = finalStr;
    displayEl.appendChild(span);
    displayEl.scrollTop = displayEl.scrollHeight;
    
    chunks.push({ text: finalStr, hex: finalStr, isEcho: false });
}

function formatAndAppend(bytes) {
    const ts = nowTs();
    
    let textBody = '';
    try { textBody = new TextDecoder('utf-8').decode(bytes); } 
    catch { textBody = String.fromCharCode(...bytes); }
    const textStr = `[${ts}] ${textBody}`;
    
    let hexBody = Array.from(bytes).map(b => {
        const h = b.toString(16).padStart(2, '0').toUpperCase();
        return (b === 10) ? (h + '\n') : h;
    }).join(' ').replace(/\n /g, '\n');
    if (!hexBody.endsWith('\n')) hexBody += ' ';
    const hexStr = `[${ts}] ${hexBody}`;

    const chunk = { text: textStr, hex: hexStr, isEcho: false };
    chunks.push(chunk);

    const span = document.createElement('span');
    span.textContent = (viewMode === 'hex') ? chunk.hex : chunk.text;
    displayEl.appendChild(span);

    const currentContent = (viewMode === 'hex') ? chunk.hex : chunk.text;
    if (!currentContent.endsWith('\n')) {
        displayEl.appendChild(document.createTextNode('\n'));
    }

    displayEl.scrollTop = displayEl.scrollHeight;
}

window.api.serial.onEvent((evt) => {
    if (evt.id !== portId) return;
    if (evt.type === 'open') {
        isOpen = true;
        updateToggleBtn();
        appendSysText('[已打开]');
    }
    if (evt.type === 'close') {
        isOpen = false;
        updateToggleBtn();
        appendSysText('[已关闭]');
    }
    if (evt.type === 'error') {
        appendSysText(`[错误] ${evt.message}`);
    }
});

window.api.serial.onData(({ id, bytes }) => {
    if (id === portId) formatAndAppend(bytes);
});

window.api.tcp?.onEvent?.((evt) => {
    if (evt.id !== portId) return;
    if (evt.type === 'open') {
        isOpen = true;
        updateToggleBtn();
        appendSysText('[已打开]');
    }
    if (evt.type === 'close') {
        isOpen = false;
        updateToggleBtn();
        appendSysText('[已关闭]');
    }
    if (evt.type === 'error') {
        appendSysText(`[错误] ${evt.message}`);
    }
});

window.api.tcp?.onData?.(({ id, bytes }) => {
    if (id === portId) formatAndAppend(bytes);
});

inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        btnSend.click();
    }
});

btnSend.addEventListener('click', async () => {
    const raw = inputEl.value || '';
    if (!raw) return;

    const sendHex = (hexModeEl && hexModeEl.checked); 
    const mode = sendHex ? 'hex' : 'text';
    const append = appendSel ? appendSel.value : 'CRLF';

    if (mode === 'hex') {
        const clean = raw.replace(/[\s,]/g, '');
        if (clean.length % 2 !== 0) {
            appendSysText('\n[系统] HEX长度必须为偶数\n');
            return;
        }
    }

    try {
        const res = isTcp
            ? await window.api.tcp.write(portId, raw, mode, append)
            : await window.api.serial.write(portId, raw, mode, append);

        if (!res.ok) {
            appendSysText(`\n[系统] 发送失败：${res.error}\n`);
        } else if (echoSendEl && echoSendEl.checked) {
            const ts = nowTs();
            const echoText = `[${ts}]\n${raw}\n`;
            
            const chunk = { text: echoText, hex: echoText, isEcho: true };
            chunks.push(chunk);
            
            const span = document.createElement('span');
            span.className = 'echo-line';
            span.textContent = echoText;
            displayEl.appendChild(span);
            displayEl.scrollTop = displayEl.scrollHeight;
        }
    } catch (err) {
        appendSysText(`\n[系统] 异常：${err.message}\n`);
    }
});