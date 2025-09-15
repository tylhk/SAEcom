// panel.js
const titleEl = document.getElementById('title');
const displayEl = document.getElementById('display');
const btnDock = document.getElementById('btnDock');

const params = new URLSearchParams(location.search);
let portId = params.get('id');
let winTitle = params.get('title') || `串口窗口 - ${portId || ''}`;

titleEl.textContent = winTitle;

// 接收主窗口传来的内容
window.api.panel.onLoadContent(({ id, html }) => {
  if (!portId) {
    portId = id;
    titleEl.textContent = `串口窗口 - ${portId}`;
  }
  if (id !== portId) return;
  displayEl.innerHTML = html;
});

window.api.serial.onData(({ id, bytes }) => {
    if (id !== portId) return;
    const ts = new Date();
    const pad = (n, len=2) => n.toString().padStart(len, '0');
    const timestamp = `${ts.getFullYear()}-${pad(ts.getMonth()+1)}-${pad(ts.getDate())} `
                    + `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}.`
                    + `${pad(ts.getMilliseconds(),3)}`;
    try {
      const txt = new TextDecoder().decode(bytes);
      displayEl.innerHTML += `[${timestamp}]\n${escHtml(txt)}\n`;
    } catch {
      displayEl.innerHTML += `[${timestamp}]\n${escHtml(Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' '))}\n`;
    }
    displayEl.scrollTop = displayEl.scrollHeight;
});

window.api.serial.onEvent((evt) => {
  if (evt.id !== portId) return;
  if (evt.type === 'close') displayEl.textContent += '\n[已关闭]\n';
  if (evt.type === 'error') displayEl.textContent += `\n[错误] ${evt.message}\n`;
});

// 收回
btnDock.addEventListener('click', () => {
  const html = displayEl.innerHTML;
  window.api.panel.requestDock(portId, html);
  // 通知主窗口显示该面板
  window.close();
});
