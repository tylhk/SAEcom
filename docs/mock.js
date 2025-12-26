console.log('Mock API loaded.');

const noop = () => {};
const asyncNoop = async () => ({ ok: true });

const MOCK_PANELS = [
    {
        id: 'COM3', path: 'COM3', name: '电机控制', type: 'serial',
        left: '300px', top: '50px', width: '420px', height: '240px',
        options: { baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none' }, 
        hidden: false, note: '主电机控制器'
    },
    {
        id: 'tcp://127.0.0.1:8080', path: 'tcp://127.0.0.1:8080', name: '数据服务器', type: 'tcp',
        left: '350px', top: '320px', width: '420px', height: '240px',
        options: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' },
        hidden: false, note: '远程采集'
    }
];

window.api = {
    tcp: {
        open: asyncNoop, write: asyncNoop, close: asyncNoop,
        onData: noop, onEvent: noop,
    },
    tcpShare: {
        start: asyncNoop, stop: asyncNoop,
        status: async () => ({ active: false })
    },
    window: {
        setFullscreen: noop, toggleFullscreen: noop, focus: noop
    },
    serial: {
        list: async () => [
            { path: 'COM1', friendlyName: '标准串行端口' },
            { path: 'COM3', friendlyName: 'USB-SERIAL CH340' }
        ],
        open: asyncNoop, close: asyncNoop, write: asyncNoop,
        onData: noop, onEvent: noop
    },
    panel: {
        popout: asyncNoop, onFocusFromPopout: noop, onDockRequest: noop,
        onHideRequest: noop, requestHide: noop, onLoadContent: noop,
        requestDock: noop, getPanelPortIdFromArgs: () => null,
        saveLog: asyncNoop
    },
    config: {
        load: async () => MOCK_PANELS,
        save: noop
    },
    commands: {
        load: async () => [], save: noop
    },
    file: { readHex: async () => ({ hex: '', length: 0 }) },
    shell: { openExternal: (url) => window.open(url, '_blank') },
    scripts: {
        dir: async () => '/scripts', list: async () => [],
        read: async () => '', write: asyncNoop, delete: asyncNoop,
        run: async () => ({ ok: true }), stop: asyncNoop, onEnded: noop
    },
    app: {
        getVersion: async () => '1.0.0-Web',
        checkUpdate: noop
    },
    changelog: { open: noop, request: noop, onLoad: noop },
    theme: {
        set: (dark) => document.documentElement.classList.toggle('theme-dark', dark),
        onApply: noop
    }
};