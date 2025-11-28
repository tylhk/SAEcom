function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

try {
  const s = JSON.parse(localStorage.getItem('appSettings') || '{}');
  if (s && s.dark) document.documentElement.classList.add('theme-dark');
} catch { }

window.api?.theme?.onApply?.(({ dark }) => {
  document.documentElement.classList.toggle('theme-dark', !!dark);
  try {
    const s = JSON.parse(localStorage.getItem('appSettings') || '{}') || {};
    s.dark = !!dark;
    localStorage.setItem('appSettings', JSON.stringify(s));
  } catch { }
});

try {
  const s = JSON.parse(localStorage.getItem('appSettings') || '{}');
  if (s && s.dark) document.documentElement.classList.add('theme-dark');
} catch { }

const titleEl = document.getElementById('title');
const displayEl = document.getElementById('display');
const btnDock = document.getElementById('btnDock');
const inputEl = document.getElementById('popInputData');
const btnSend = document.getElementById('popBtnSend');
const appendSel = document.getElementById('popAppend');
const hexModeEl = document.getElementById('popHexMode');
const echoSendEl = document.getElementById('popEchoSend');

const params = new URLSearchParams(location.search);
let portId = params.get('id');
let winTitle = params.get('title') || `串口窗口 - ${portId || ''}`;

titleEl.textContent = winTitle;

window.api.panel.onLoadContent(({ id, html }) => {
  if (!portId) {
    portId = id;
  }
  if (id !== portId) return;
  displayEl.innerHTML = html;
});

window.api.serial.onData(({ id, bytes }) => {
  if (id !== portId) return;

  const ts = new Date();
  const pad = (n, len = 2) => n.toString().padStart(len, '0');
  const timestamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} `
    + `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}.`
    + `${pad(ts.getMilliseconds(), 3)}`;

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    text = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  text = text.replace(/[\r\n]+$/g, '');

  const line = `[${timestamp}] ${text}\n`;
  displayEl.innerHTML += escHtml(line);
  displayEl.scrollTop = displayEl.scrollHeight;
});

window.api.tcp?.onData?.(({ id, bytes }) => {
  if (id !== portId) return;

  const ts = new Date();
  const pad = (n, len = 2) => n.toString().padStart(len, '0');
  const timestamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())} `
    + `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}.`
    + `${pad(ts.getMilliseconds(), 3)}`;

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    text = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }

  text = text.replace(/[\r\n]+$/g, '');

  const line = `[${timestamp}] ${text}\n`;
  displayEl.innerHTML += escHtml(line);
  displayEl.scrollTop = displayEl.scrollHeight;
});

window.api.serial.onEvent((evt) => {
  if (evt.id !== portId) return;
  if (evt.type === 'close') displayEl.textContent += '\n[已关闭]\n';
  if (evt.type === 'error') displayEl.textContent += `\n[错误] ${evt.message}\n`;
});

window.api.tcp?.onEvent?.((evt) => {
  if (evt.id !== portId) return;
  if (evt.type === 'close') displayEl.textContent += '\n[已关闭]\n';
  if (evt.type === 'error') displayEl.textContent += `\n[错误] ${evt.message}\n`;
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    btnSend.click();
  }
});

btnSend.addEventListener('click', async () => {
  if (!portId) return;  // 理论上不会发生

  const raw = inputEl.value || '';
  if (!raw) return;

  const mode = (hexModeEl && hexModeEl.checked) ? 'hex' : 'text';
  const append = appendSel ? appendSel.value : 'CRLF';

  if (mode === 'hex') {
    const clean = raw.replace(/[\s,]/g, '');
    if (clean.length % 2 !== 0) {
      displayEl.textContent += '\n[系统] HEX长度必须为偶数\n';
      displayEl.scrollTop = displayEl.scrollHeight;
      return;
    }
  }

  const isTcp = (portId || '').startsWith('tcp://');

  try {
    const res = isTcp
      ? await window.api.tcp.write(portId, raw, mode, append)
      : await window.api.serial.write(portId, raw, mode, append);

    if (!res.ok) {
      displayEl.textContent += `\n[系统] 发送失败：${res.error || '未知错误'}\n`;
    } else if (echoSendEl && echoSendEl.checked) {
      const ts = new Date();
      const timestamp = ts.toLocaleTimeString();
      displayEl.innerHTML += `[${timestamp}] (发送)\n${escHtml(raw)}\n`;
    }
  } catch (err) {
    displayEl.textContent += `\n[系统] 发送异常：${err.message || String(err)}\n`;
  } finally {
    displayEl.scrollTop = displayEl.scrollHeight;
  }
});

btnDock.addEventListener('click', () => {
  const text = displayEl.innerText || displayEl.textContent || '';
  window.api.panel.requestDock(portId, text);
  window.close();
});
