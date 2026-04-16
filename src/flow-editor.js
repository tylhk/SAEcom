/**
 * FlowEditor - Drawflow 包装类
 * 提供统一的流程图编辑接口
 */

class FlowEditor {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = document.getElementById(containerId);
    this.editor = null;
    this.currentNodeId = null;
    this.selectedConnectionStyle = 'curve';
    this.selectedConnectionWidth = 2;
    this._boundListeners = [];  // Store listener references for cleanup
    this.options = {
      reroute: true,
      reroute_fix: true,
      zoom_value: 0.1,  // 缩放步进值
      zoom_max: 2,
      zoom_min: 0.5,
      ...options
    };
    this.onNodeSelect = null;
    this.onNodeUpdate = null;
    this.onConnectionChange = null;
    this.onZoomChange = null;
  }

  /**
   * 初始化编辑器
   * @returns {boolean} true on success, false on error
   */
  init() {
    if (!this.container) {
      console.error(`Flow container #${this.containerId} not found`);
      return false;
    }

    // 创建 Drawflow 实例 - 使用默认配置
    this.editor = new Drawflow(this.container);

    // 启动编辑器（会自动设置所有默认值）
    this.editor.start();

    // 注册节点类型
    this.registerNodes();

    // 设置事件监听
    this.setupEventListeners();

    console.log('Drawflow started with zoom:', this.editor.zoom, 'zoom_value:', this.editor.zoom_value);

    return true;
  }

  /**
   * 将画布居中显示
   */
  centerCanvas() {
    if (!this.editor || !this.container) return;
    if (!this.editor.precanvas) {
      console.warn('precanvas not ready');
      return;
    }

    // 获取容器尺寸
    const containerRect = this.container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    if (containerWidth === 0 || containerHeight === 0) {
      console.warn('Container has zero size');
      return;
    }

    // 画布中心位置（Drawflow 默认画布 10000x10000，中心是 5000）
    // 要让画布中心显示在容器中心，需要把 precanvas 向左/上移动
    // Drawflow 的 canvas_x/canvas_y 是 translate 的值
    const canvas_x = -(5000 - containerWidth / 2);
    const canvas_y = -(5000 - containerHeight / 2);

    // 设置 precanvas 的 transform（Drawflow 格式：translate(x, y) scale(z)）
    this.editor.precanvas.style.transform = `translate(${canvas_x}px, ${canvas_y}px) scale(${this.editor.zoom})`;
    this.editor.canvas_x = canvas_x;
    this.editor.canvas_y = canvas_y;
    this.editor.pos_x = 0;
    this.editor.pos_y = 0;

    console.log('Canvas centered:', { canvas_x, canvas_y, containerWidth, containerHeight, zoom: this.editor.zoom });
  }

  /**
   * 注册所有节点类型到 Drawflow
   */
  registerNodes() {
    if (!this.editor) return;

    Object.keys(NODE_DEFINITIONS).forEach(type => {
      const def = NODE_DEFINITIONS[type];
      this.editor.registerNode(type, {
        name: def.name,
        inputs: def.inputs,
        outputs: def.outputs,
        color: def.color
      });
    });
  }

  /**
   * 设置事件监听器
   */
  setupEventListeners() {
    if (!this.editor) return;

    // 节点创建事件
    this.editor.on('nodeCreated', (nodeId) => {
      console.log('Node created:', nodeId);
    });

    // 节点删除事件
    this.editor.on('nodeRemoved', (nodeId) => {
      console.log('Node removed:', nodeId);
      if (this.currentNodeId === nodeId) {
        this.currentNodeId = null;
      }
    });

    // 节点选择事件
    this.editor.on('nodeSelected', (nodeId) => {
      this.currentNodeId = nodeId;
      if (this.onNodeSelect) {
        this.onNodeSelect(nodeId);
      }
    });

    // 节点取消选择事件
    this.editor.on('nodeUnselected', (nodeId) => {
      if (this.currentNodeId === nodeId) {
        this.currentNodeId = null;
      }
    });

    // 连接创建事件
    this.editor.on('connectionCreated', (connection) => {
      console.log('Connection created:', connection);
      if (this.onConnectionChange) {
        this.onConnectionChange('created', connection);
      }
    });

    // 连接删除事件
    this.editor.on('connectionRemoved', (connection) => {
      console.log('Connection removed:', connection);
      if (this.onConnectionChange) {
        this.onConnectionChange('removed', connection);
      }
    });

    // 自定义滚轮缩放（不需要 Ctrl 键）
    const wheelHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY > 0) {
        this.editor.zoom_out();
      } else {
        this.editor.zoom_in();
      }
      // 更新缩放显示
      if (this.onZoomChange) {
        this.onZoomChange(this.editor.zoom);
      }
    };
    this.container.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
    this._boundListeners.push({ element: this.container, type: 'wheel', handler: wheelHandler, options: { passive: false, capture: true } });

    // 监听节点点击（用于选中）
    const clickHandler = (e) => {
      const nodeEl = e.target.closest('.drawflow-node');
      if (nodeEl) {
        this.selectNode(parseInt(nodeEl.id.replace('node-', '')));
      }
    };
    this.container.addEventListener('click', clickHandler);
    this._boundListeners.push({ element: this.container, type: 'click', handler: clickHandler });

    // 节点双击事件（通过 DOM 事件）
    const dblclickHandler = (e) => {
      const nodeEl = e.target.closest('.drawflow-node');
      if (nodeEl) {
        const nodeId = parseInt(nodeEl.id.split('-')[1], 10);
        this.showConfigPanel(nodeId);
      }
    };
    this.container.addEventListener('dblclick', dblclickHandler);
    this._boundListeners.push({ element: this.container, type: 'dblclick', handler: dblclickHandler });
  }

  /**
   * 从模板添加节点
   * @param {string} nodeType - 节点类型
   * @param {number} x - X 坐标（屏幕坐标）
   * @param {number} y - Y 坐标（屏幕坐标）
   * @returns {number|null} 节点ID
   */
  addNodeFromTemplate(nodeType, x, y) {
    if (!this.editor) {
      console.error('Editor not initialized');
      return null;
    }

    const def = NODE_DEFINITIONS[nodeType];
    if (!def) {
      console.warn(`Unknown node type: ${nodeType}`);
      return null;
    }

    // 获取容器位置
    const containerRect = this.container.getBoundingClientRect();
    const zoom = this.editor.zoom || 1;
    const canvas_x = this.editor.canvas_x || 0;
    const canvas_y = this.editor.canvas_y || 0;

    // 计算相对于容器的坐标
    const relX = x - containerRect.left;
    const relY = y - containerRect.top;

    // 转换到画布内部坐标
    // canvas_x 是负值（表示向左偏移），-canvas_x 是画布显示区域的左上角在画布坐标系中的位置
    const nodeX = Math.max(0, -canvas_x + relX / zoom);
    const nodeY = Math.max(0, -canvas_y + relY / zoom);

    console.log('Drop at screen:', x, y);
    console.log('Container at:', containerRect.left, containerRect.top);
    console.log('Relative:', relX, relY);
    console.log('Canvas offset:', canvas_x, canvas_y);
    console.log('Node position:', nodeX, nodeY);

    // 生成节点 HTML
    const html = generateNodeHTML(nodeType, {});

    // 初始化节点数据（包含分类和配置字段默认值）
    const initialData = { category: def.category };
    if (def.configFields) {
      def.configFields.forEach(field => {
        initialData[field.key] = field.default || '';
      });
    }

    // 创建节点 - Drawflow API: addNode(name, inputs, outputs, pos_x, pos_y, class, data, html, typenode)
    const nodeId = this.editor.addNode(
      def.name,       // 节点名称
      def.inputs,     // 输入端口数量
      def.outputs,    // 输出端口数量
      nodeX,          // X 坐标
      nodeY,          // Y 坐标
      nodeType,       // CSS 类名（节点类型）
      initialData,    // 数据（包含分类和配置默认值）
      html,           // HTML 内容
      false           // typenode: false = 直接 HTML
    );

    // 添加 category 属性到 DOM 元素（用于 CSS 样式）
    const nodeEl = this.container.querySelector(`#node-${nodeId}`);
    if (nodeEl) {
      nodeEl.dataset.category = def.category;
    }

    console.log(`Node added: ${nodeId} (${nodeType}) at (${nodeX}, ${nodeY})`);
    return nodeId;
  }

  /**
   * 获取节点类型
   * @param {number} nodeId - 节点ID
   * @returns {string} 节点类型（如 'input-manual'）
   */
  getNodeType(nodeId) {
    if (!this.editor) return null;
    const node = this.editor.getNodeFromId(nodeId);
    // node.class 是节点类型（如 'input-manual'），node.name 是显示名称
    return node ? node.class : null;
  }

  /**
   * 获取节点数据
   * @param {number} nodeId - 节点ID
   * @returns {object|null} 节点数据
   */
  getNodeData(nodeId) {
    if (!this.editor) return null;
    const node = this.editor.getNodeFromId(nodeId);
    return node ? node.data : null;
  }

  /**
   * 更新节点数据
   * @param {number} nodeId - 节点ID
   * @param {object} newData - 新数据
   */
  updateNodeData(nodeId, newData) {
    if (!this.editor) return;

    const node = this.editor.getNodeFromId(nodeId);
    if (!node) return;

    // 合并数据
    const updatedData = { ...node.data, ...newData };
    // Drawflow API: updateNodeDataFromId
    this.editor.updateNodeDataFromId(nodeId, updatedData);

    // 更新节点 HTML（使用 node.class 而不是 node.name）
    const html = generateNodeHTML(node.class, updatedData);
    const nodeEl = this.container.querySelector(`#node-${nodeId}`);
    if (nodeEl) {
      const contentEl = nodeEl.querySelector('.drawflow_content_node');
      if (contentEl) {
        contentEl.innerHTML = html;
      }
    }

    // 触发更新回调
    if (this.onNodeUpdate) {
      this.onNodeUpdate(nodeId, updatedData);
    }
  }

  /**
   * 选中节点
   * @param {number} nodeId - 节点ID
   */
  selectNode(nodeId) {
    if (!this.editor) return;
    // Drawflow 会自动处理选中状态
    this.currentNodeId = nodeId;
  }

  /**
   * 删除选中的节点
   */
  deleteSelectedNode() {
    if (!this.editor || !this.currentNodeId) return;
    this.editor.removeNode(this.currentNodeId);
    this.currentNodeId = null;
  }

  /**
   * 显示节点配置面板
   * @param {number} nodeId - 节点ID
   */
  showConfigPanel(nodeId) {
    const nodeType = this.getNodeType(nodeId);
    const currentData = this.getNodeData(nodeId);

    if (!nodeType || !currentData) return;

    // 创建配置面板
    const panelHTML = generateConfigPanelHTML(nodeType, currentData);
    if (!panelHTML) return;

    const panelEl = document.createElement('div');
    panelEl.className = 'df-config-overlay';
    panelEl.innerHTML = panelHTML;

    // 将面板添加到 dialog 内部，而不是 body（避免 top-layer 遮挡）
    const dialog = this.container.closest('dialog') || document.body;
    dialog.appendChild(panelEl);

    // 获取按钮元素
    const okBtn = panelEl.querySelector('.df-config-ok');
    const cancelBtn = panelEl.querySelector('.df-config-cancel');

    // Escape key to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        panelEl.remove();
      }
    };
    document.addEventListener('keydown', escHandler);

    // Click outside to close
    panelEl.addEventListener('click', (e) => {
      if (e.target === panelEl) {
        document.removeEventListener('keydown', escHandler);
        panelEl.remove();
      }
    });

    // 绑定确定按钮
    if (okBtn) {
      okBtn.onclick = () => {
        const newData = {};
        panelEl.querySelectorAll('[data-key]').forEach(input => {
          newData[input.dataset.key] = input.value;
        });
        this.updateNodeData(nodeId, newData);
        document.removeEventListener('keydown', escHandler);
        panelEl.remove();
      };
    }

    // 绑定取消按钮
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        document.removeEventListener('keydown', escHandler);
        panelEl.remove();
      };
    }
  }

  /**
   * 导出流程图为 JSON
   * @returns {object} JSON 数据
   */
  exportJSON() {
    if (!this.editor) return null;
    return this.editor.export();
  }

  /**
   * 从 JSON 导入流程图
   * @param {object} data - JSON 数据
   */
  importJSON(data) {
    if (!this.editor) return;
    this.editor.import(data);
  }

  /**
   * 导出流程图为可执行代码
   * @returns {string} JavaScript 代码
   */
  exportCode() {
    if (typeof generateCodeFromDrawflow !== 'function') {
      console.warn('generateCodeFromDrawflow not loaded');
      return '// 代码生成器未加载';
    }
    const drawflowData = this.editor.export();
    return generateCodeFromDrawflow(drawflowData, NODE_DEFINITIONS);
  }

  /**
   * 导出流程图 JSON 和代码
   * @returns {object} { json, code }
   */
  export() {
    const json = this.exportJSON();
    const code = this.exportCode();
    return { json, code };
  }

  /**
   * 生成完整的脚本文件内容（包含 Drawflow JSON + 代码）
   * @returns {string} 完整脚本文件内容
   */
  generateScriptFile() {
    const { json, code } = this.export();

    // 格式化 JSON
    const jsonStr = JSON.stringify(json, null, 2);

    // 生成带标记的脚本文件
    return `/* VS_FLOW_START
${jsonStr}
VS_FLOW_END */

// Generated code:
(async function() {
${code}
})();
`;
  }

  /**
   * 从脚本文件解析 Drawflow JSON
   * @param {string} scriptContent - 脚本文件内容
   * @returns {object|null} Drawflow JSON 或 null
   */
  parseScriptFile(scriptContent) {
    const startMarker = 'VS_FLOW_START';
    const endMarker = 'VS_FLOW_END';

    const startIdx = scriptContent.indexOf(startMarker);
    const endIdx = scriptContent.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1) {
      return null;
    }

    const jsonStr = scriptContent.substring(startIdx + startMarker.length, endIdx).trim();
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      console.error('Failed to parse Drawflow JSON:', e);
      return null;
    }
  }

  /**
   * 清空流程图
   */
  clear() {
    if (!this.editor) return;
    this.editor.clear();
    this.currentNodeId = null;
  }

  /**
   * 设置连接线样式
   * @param {string} color - 颜色
   */
  setConnectionStyle(color) {
    if (!this.container) return;
    this.container.style.setProperty('--df-connection-color', color);
  }

  /**
   * 设置连接线宽度
   * @param {number} width - 宽度（像素）
   */
  setConnectionWidth(width) {
    if (!this.container) return;
    this.container.style.setProperty('--df-connection-width', `${width}px`);
  }

  /**
   * 获取所有节点
   * @returns {object} 节点映射
   */
  getAllNodes() {
    if (!this.editor) return {};
    return this.editor.getNodes();
  }

  /**
   * 销毁编辑器
   */
  destroy() {
    // Remove all stored listeners (including those with capture option)
    this._boundListeners.forEach(({ element, type, handler, options }) => {
      element.removeEventListener(type, handler, options);
    });
    this._boundListeners = [];

    if (this.editor) {
      this.editor.clear();
      this.editor = null;
    }
    this.container = null;
    this.currentNodeId = null;
  }
}

// 全局实例
let _flowEditorInstance = null;

/**
 * 初始化全局 FlowEditor 实例
 * @param {string} containerId - 容器元素ID
 * @param {object} options - 可选配置
 * @returns {FlowEditor} 实例
 */
function initFlowEditor(containerId, options = {}) {
  _flowEditorInstance = new FlowEditor(containerId, options);
  _flowEditorInstance.init();
  return _flowEditorInstance;
}

/**
 * 获取全局 FlowEditor 实例
 * @returns {FlowEditor|null} 实例
 */
function getFlowEditor() {
  return _flowEditorInstance;
}

// 导出（支持浏览器和 Node.js）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FlowEditor, initFlowEditor, getFlowEditor };
}
// 浏览器/Electron renderer 全局暴露
if (typeof window !== 'undefined') {
  window.FlowEditor = FlowEditor;
  window.initFlowEditor = initFlowEditor;
  window.getFlowEditor = getFlowEditor;
}