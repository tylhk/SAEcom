/**
 * 节点类型定义模块
 * 每种节点包含: name, icon, color, inputs, outputs, configFields
 */

/**
 * HTML 转义函数，防止 XSS 攻击
 * @param {string|any} str - 要转义的值
 * @returns {string} 转义后的安全字符串
 */
function escapeHTML(str) {
  if (typeof str !== 'string') return String(str || '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const NODE_DEFINITIONS = {
  // ========== 输入类 (5个) ==========
  'input-serial': {
    category: 'input',
    name: '接收串口',
    icon: '📥',
    color: '#409EFF',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'port', type: 'text', label: '串口', default: 'COM1' },
      { key: 'timeout', type: 'number', label: '超时(ms)', default: 5000 }
    ],
    generateCode: (config) => `var _recv_serial = await waitOnePacket(${config.timeout});`
  },

  'input-tcp': {
    category: 'input',
    name: '接收TCP',
    icon: '📥',
    color: '#409EFF',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'host', type: 'text', label: '主机', default: '127.0.0.1' },
      { key: 'port', type: 'number', label: '端口', default: 8080 },
      { key: 'timeout', type: 'number', label: '超时(ms)', default: 5000 }
    ],
    generateCode: (config) => `var _recv_tcp = await waitOnePacket(${config.timeout});`
  },

  'input-tcp-server': {
    category: 'input',
    name: 'TCP服务器接收',
    icon: '🖥️',
    color: '#409EFF',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'port', type: 'number', label: '监听端口', default: 9000 },
      { key: 'timeout', type: 'number', label: '超时(ms)', default: 5000 }
    ],
    generateCode: (config) => `var _recv_tcp_server = await waitTcpServer(${config.port}, ${config.timeout});`
  },

  'input-manual': {
    category: 'input',
    name: '手动输入',
    icon: '⌨️',
    color: '#409EFF',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'content', type: 'text', label: '输入内容', default: '' },
      { key: 'mode', type: 'select', label: '格式', options: ['text', 'hex'], default: 'text' }
    ],
    generateCode: (config) => {
      if (config.mode === 'hex') {
        // Validate hex format: only allow valid hex characters
        const safeHex = (config.content || '').replace(/[^0-9A-Fa-f\s]/g, '');
        return `var _input_manual = "${safeHex}";`;
      }
      const safeContent = escapeHTML(config.content);
      return `var _input_manual = "${safeContent}";`;
    }
  },

  'input-file': {
    category: 'input',
    name: '读取文件',
    icon: '📄',
    color: '#409EFF',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'path', type: 'text', label: '文件路径', default: '' },
      { key: 'encoding', type: 'select', label: '编码', options: ['utf8', 'gbk', 'binary'], default: 'utf8' }
    ],
    generateCode: (config) => {
      const safePath = escapeHTML(config.path);
      const safeEncoding = escapeHTML(config.encoding);
      return `var _file_content = await readFile("${safePath}", "${safeEncoding}");`;
    }
  },

  'input-timer': {
    category: 'input',
    name: '定时触发',
    icon: '⏰',
    color: '#409EFF',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'interval', type: 'number', label: '间隔(ms)', default: 1000 },
      { key: 'repeat', type: 'select', label: '重复', options: ['单次', '循环'], default: '单次' }
    ],
    generateCode: (config) => `await sleep(${config.interval});`
  },

  // ========== 转换类 (5个) ==========
  'transform-hex': {
    category: 'transform',
    name: 'HEX转换',
    icon: '🔄',
    color: '#67C23A',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'direction', type: 'select', label: '方向', options: ['HEX→文本', '文本→HEX'], default: 'HEX→文本' },
      { key: 'separator', type: 'select', label: '分隔符', options: ['空格', '无', '自定义'], default: '空格' },
      { key: 'encoding', type: 'select', label: '编码', options: ['utf8', 'gbk', 'ascii'], default: 'utf8' }
    ],
    generateCode: (config) => {
      if (config.direction === 'HEX→文本') {
        return `var _hex_result = hexToText(_input, "${escapeHTML(config.encoding)}");`;
      }
      return `var _hex_result = textToHex(_input, "${escapeHTML(config.separator)}");`;
    }
  },

  'transform-base64': {
    category: 'transform',
    name: 'Base64编解码',
    icon: '🔐',
    color: '#67C23A',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'operation', type: 'select', label: '操作', options: ['编码', '解码'], default: '编码' }
    ],
    generateCode: (config) => {
      if (config.operation === '编码') {
        return `var _b64_result = btoa(_input);`;
      }
      return `var _b64_result = atob(_input);`;
    }
  },

  'transform-encoding': {
    category: 'transform',
    name: '编码转换',
    icon: 'Charset',
    color: '#67C23A',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'from', type: 'select', label: '源编码', options: ['utf8', 'gbk', 'ascii', 'iso8859-1'], default: 'utf8' },
      { key: 'to', type: 'select', label: '目标编码', options: ['utf8', 'gbk', 'ascii', 'iso8859-1'], default: 'gbk' }
    ],
    generateCode: (config) => `var _enc_result = convertEncoding(_input, "${escapeHTML(config.from)}", "${escapeHTML(config.to)}");`
  },

  'transform-byteorder': {
    category: 'transform',
    name: '字节序转换',
    icon: '🔀',
    color: '#67C23A',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'type', type: 'select', label: '类型', options: ['大端→小端', '小端→大端'], default: '大端→小端' },
      { key: 'size', type: 'select', label: '数据长度', options: ['2字节', '4字节'], default: '2字节' }
    ],
    generateCode: (config) => {
      const size = config.size === '4字节' ? 4 : 2;
      return `var _swap_result = swapBytes(_input, ${size});`;
    }
  },

  'transform-case': {
    category: 'transform',
    name: '大小写转换',
    icon: '🔠',
    color: '#67C23A',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'case', type: 'select', label: '转换', options: ['转大写', '转小写'], default: '转大写' }
    ],
    generateCode: (config) => {
      if (config.case === '转大写') {
        return `var _case_result = _input.toUpperCase();`;
      }
      return `var _case_result = _input.toLowerCase();`;
    }
  },

  // ========== 分割类 (5个) ==========
  'split-delimiter': {
    category: 'split',
    name: '分隔符拆分',
    icon: '✂️',
    color: '#E6A23C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'delimiter', type: 'select', label: '分隔符', options: ['逗号', '空格', '换行', '制表符', '自定义'], default: '逗号' },
      { key: 'custom', type: 'text', label: '自定义分隔', default: '' },
      { key: 'index', type: 'text', label: '提取索引', default: '全部' }
    ],
    generateCode: (config) => {
      let delim = ',';
      if (config.delimiter === '空格') delim = ' ';
      else if (config.delimiter === '换行') delim = '\\n';
      else if (config.delimiter === '制表符') delim = '\\t';
      else if (config.delimiter === '自定义') delim = escapeHTML(config.custom || ',');
      return `var _split_result = _input.split("${delim}");`;
    }
  },

  'split-length': {
    category: 'split',
    name: '按长度拆分',
    icon: '📏',
    color: '#E6A23C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'length', type: 'number', label: '每段长度', default: 2 }
    ],
    generateCode: (config) => `var _len_split = chunkString(_input, ${config.length});`
  },

  'split-regex': {
    category: 'split',
    name: '正则提取',
    icon: '🔍',
    color: '#E6A23C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'pattern', type: 'text', label: '正则表达式', default: '' },
      { key: 'flags', type: 'text', label: '标志', default: 'g' }
    ],
    generateCode: (config) => `var _regex_result = _input.match(new RegExp("${escapeHTML(config.pattern)}", "${escapeHTML(config.flags)}")) || [];`
  },

  'split-substring': {
    category: 'split',
    name: '截取子串',
    icon: '✂️',
    color: '#E6A23C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'start', type: 'number', label: '起始位置', default: 0 },
      { key: 'end', type: 'text', label: '结束位置', default: '末尾' }
    ],
    generateCode: (config) => {
      const start = config.start;
      const end = config.end === '末尾' ? '' : config.end;
      return `var _substr = _input.substring(${start}, ${end || '_input.length'});`;
    }
  },

  'split-trimbytes': {
    category: 'split',
    name: '去头尾字节',
    icon: '🗑️',
    color: '#E6A23C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'head', type: 'number', label: '去掉头部', default: 0 },
      { key: 'tail', type: 'number', label: '去掉尾部', default: 0 }
    ],
    generateCode: (config) => `var _trimmed = _input.slice(${config.head}, _input.length - ${config.tail});`
  },

  // ========== 数值类 (5个) ==========
  'numeric-base': {
    category: 'numeric',
    name: '进制转换',
    icon: '🔢',
    color: '#F56C6C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'from', type: 'select', label: '源进制', options: ['十进制', '十六进制', '二进制', '八进制'], default: '十进制' },
      { key: 'to', type: 'select', label: '目标进制', options: ['十进制', '十六进制', '二进制', '八进制'], default: '十六进制' }
    ],
    generateCode: (config) => `var _base_result = convertBase(_input, "${config.from}", "${config.to}");`
  },

  'numeric-join': {
    category: 'numeric',
    name: '字节拼接数值',
    icon: '🧩',
    color: '#F56C6C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'type', type: 'select', label: '数值类型', options: ['uint16', 'int16', 'uint32', 'int32', 'float'], default: 'uint16' },
      { key: 'order', type: 'select', label: '字节序', options: ['大端', '小端'], default: '大端' }
    ],
    generateCode: (config) => `var _num = bytesToNumber(_input, "${config.type}", "${config.order}");`
  },

  'numeric-calc': {
    category: 'numeric',
    name: '计算',
    icon: '🧮',
    color: '#F56C6C',
    inputs: 2,
    outputs: 1,
    configFields: [
      { key: 'operator', type: 'select', label: '运算', options: ['加', '减', '乘', '除', '取余', '异或', '与', '或'], default: '加' },
      { key: 'operand2', type: 'text', label: '第二操作数', default: '' }
    ],
    generateCode: (config) => {
      const ops = { '加': '+', '减': '-', '乘': '*', '除': '/', '取余': '%', '异或': '^', '与': '&', '或': '|' };
      return `var _calc_result = _input1 ${ops[config.operator]} _input2;`;
    }
  },

  'numeric-crc': {
    category: 'numeric',
    name: 'CRC校验',
    icon: '✓',
    color: '#F56C6C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'algorithm', type: 'select', label: '算法', options: ['CRC8', 'CRC16', 'CRC16-CCITT', 'CRC32', '校验和'], default: 'CRC16' },
      { key: 'outputFormat', type: 'select', label: '输出格式', options: ['HEX', '十进制', '二进制'], default: 'HEX' },
      { key: 'append', type: 'select', label: '追加到数据', options: ['是', '否'], default: '否' }
    ],
    generateCode: (config) => {
      const algMap = { 'CRC8': 'crc8', 'CRC16': 'crc16', 'CRC16-CCITT': 'crc16ccitt', 'CRC32': 'crc32', '校验和': 'checksum' };
      return `var _crc = ${algMap[config.algorithm]}(_input);`;
    }
  },

  'numeric-length': {
    category: 'numeric',
    name: '计算长度',
    icon: '📏',
    color: '#F56C6C',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'type', type: 'select', label: '类型', options: ['字符串长度', '数组元素数', '字节数'], default: '字符串长度' }
    ],
    generateCode: (config) => {
      if (config.type === '字符串长度') return `var _len = _input.length;`;
      if (config.type === '数组元素数') return `var _len = _input.length;`;
      return `var _len = Buffer.byteLength(_input);`;
    }
  },

  // ========== 字符类 (5个) ==========
  'string-concat': {
    category: 'string',
    name: '字符串拼接',
    icon: '🔗',
    color: '#909399',
    inputs: 2,
    outputs: 1,
    configFields: [
      { key: 'separator', type: 'text', label: '分隔符', default: '' }
    ],
    generateCode: (config) => `var _concat = _input1 + "${escapeHTML(config.separator)}" + _input2;`
  },

  'string-replace': {
    category: 'string',
    name: '字符串替换',
    icon: '🔄',
    color: '#909399',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'search', type: 'text', label: '查找', default: '' },
      { key: 'replace', type: 'text', label: '替换为', default: '' },
      { key: 'all', type: 'select', label: '替换全部', options: ['是', '否'], default: '是' }
    ],
    generateCode: (config) => {
      if (config.all === '是') {
        return `var _replaced = _input.replaceAll("${escapeHTML(config.search)}", "${escapeHTML(config.replace)}");`;
      }
      return `var _replaced = _input.replace("${escapeHTML(config.search)}", "${escapeHTML(config.replace)}");`;
    }
  },

  'string-trim': {
    category: 'string',
    name: '去除空白',
    icon: '🧹',
    color: '#909399',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'position', type: 'select', label: '位置', options: ['两端', '左侧', '右侧', '全部'], default: '两端' }
    ],
    generateCode: (config) => {
      if (config.position === '两端') return `var _trimmed = _input.trim();`;
      if (config.position === '左侧') return `var _trimmed = _input.trimStart();`;
      if (config.position === '右侧') return `var _trimmed = _input.trimEnd();`;
      return `var _trimmed = _input.replace(/\\s/g, '');`;
    }
  },

  'string-find': {
    category: 'string',
    name: '查找匹配',
    icon: '🔍',
    color: '#909399',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'search', type: 'text', label: '查找内容', default: '' },
      { key: 'return', type: 'select', label: '返回', options: ['是否找到', '位置索引', '匹配次数'], default: '是否找到' }
    ],
    generateCode: (config) => {
      if (config.return === '是否找到') return `var _found = _input.includes("${escapeHTML(config.search)}");`;
      if (config.return === '位置索引') return `var _found = _input.indexOf("${escapeHTML(config.search)}");`;
      return `var _found = (_input.match(new RegExp("${escapeHTML(config.search)}", "g")) || []).length;`;
    }
  },

  'string-template': {
    category: 'string',
    name: '格式化模板',
    icon: '📝',
    color: '#909399',
    inputs: 3,
    outputs: 1,
    configFields: [
      { key: 'template', type: 'text', label: '模板', default: '设备{1}: 值{2}, 状态{3}' }
    ],
    generateCode: (config) => {
      let tpl = escapeHTML(config.template).replace(/\{(\d+)\}/g, (_, n) => `_input${n}`);
      return `var _formatted = "${tpl}";`;
    }
  },

  // ========== 控制类 (5个) ==========
  'control-if': {
    category: 'control',
    name: '条件判断',
    icon: '❓',
    color: '#9B59B6',
    inputs: 1,
    outputs: 2, // 2个输出: true分支 和 false分支
    configFields: [
      { key: 'condition', type: 'select', label: '条件类型', options: ['包含', '等于', '大于', '小于', '正则匹配'], default: '包含' },
      { key: 'value', type: 'text', label: '比较值', default: '' }
    ],
    generateCode: (config, childrenTrue, childrenFalse) => {
      let cond;
      if (config.condition === '包含') cond = `_input.includes("${escapeHTML(config.value)}")`;
      else if (config.condition === '等于') cond = `_input === "${escapeHTML(config.value)}"`;
      else if (config.condition === '大于') cond = `_input > ${config.value}`;
      else if (config.condition === '小于') cond = `_input < ${config.value}`;
      else cond = `new RegExp("${escapeHTML(config.value)}").test(_input)`;

      return `if (${cond}) {\n${childrenTrue || ''}\n} else {\n${childrenFalse || ''}\n}`;
    }
  },

  'control-loop': {
    category: 'control',
    name: '循环执行',
    icon: '🔁',
    color: '#9B59B6',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'count', type: 'number', label: '循环次数', default: 0 },
      { key: 'type', type: 'select', label: '循环类型', options: ['次数循环', '无限循环', '条件循环'], default: '次数循环' }
    ],
    generateCode: (config, children) => {
      if (config.type === '无限循环') {
        return `while (true) {\n  await sleep(10);\n${children || ''}\n}`;
      }
      return `for (let i = 0; i < ${config.count || 1}; i++) {\n${children || ''}\n}`;
    }
  },

  'control-delay': {
    category: 'control',
    name: '延时等待',
    icon: '⏱',
    color: '#9B59B6',
    inputs: 1,
    outputs: 1,
    configFields: [
      { key: 'ms', type: 'number', label: '延时(ms)', default: 1000 }
    ],
    generateCode: (config) => `await sleep(${config.ms});`
  },

  'control-wait': {
    category: 'control',
    name: '等待接收',
    icon: '⏳',
    color: '#9B59B6',
    inputs: 0,
    outputs: 1,
    configFields: [
      { key: 'timeout', type: 'number', label: '超时(ms)', default: 5000 },
      { key: 'match', type: 'text', label: '匹配内容', default: '' }
    ],
    generateCode: (config) => `var _wait_recv = await waitOnePacket(${config.timeout});`
  },

  'control-timeout': {
    category: 'control',
    name: '超时控制',
    icon: '⏰',
    color: '#9B59B6',
    inputs: 1,
    outputs: 2, // 正常输出 和 超时输出
    configFields: [
      { key: 'timeout', type: 'number', label: '超时(ms)', default: 3000 }
    ],
    generateCode: (config, childrenNormal, childrenTimeout) => {
      return `try {\n  var _result = await Promise.race([\n    _input,\n    new Promise((_, reject) => setTimeout(() => reject('timeout'), ${config.timeout}))\n  ]); \n${childrenNormal || ''}\n} catch (e) {\n${childrenTimeout || ''}\n}`;
    }
  },

  // ========== 输出类 (5个) ==========
  'output-serial': {
    category: 'output',
    name: '发送串口',
    icon: '📤',
    color: '#7ee787',
    inputs: 1,
    outputs: 0,
    configFields: [
      { key: 'port', type: 'text', label: '串口', default: '当前' },
      { key: 'mode', type: 'select', label: '格式', options: ['text', 'hex'], default: 'text' },
      { key: 'append', type: 'select', label: '结尾', options: ['无', 'CRLF', 'CR', 'LF'], default: '无' }
    ],
    generateCode: (config) => {
      const append = config.append === '无' ? 'none' : config.append.toLowerCase();
      return `await send(_input, "${config.mode}", "${append}");`;
    }
  },

  'output-tcp': {
    category: 'output',
    name: '发送TCP',
    icon: '📤',
    color: '#7ee787',
    inputs: 1,
    outputs: 0,
    configFields: [
      { key: 'host', type: 'text', label: '主机', default: '127.0.0.1' },
      { key: 'port', type: 'number', label: '端口', default: 8080 },
      { key: 'mode', type: 'select', label: '格式', options: ['text', 'hex'], default: 'text' }
    ],
    generateCode: (config) => `await sendTCP("${escapeHTML(config.host)}", ${config.port}, _input, "${config.mode}");`
  },

  'output-tcp-server': {
    category: 'output',
    name: 'TCP服务器发送',
    icon: '📡',
    color: '#7ee787',
    inputs: 1,
    outputs: 0,
    configFields: [
      { key: 'port', type: 'number', label: '服务器端口', default: 9000 },
      { key: 'mode', type: 'select', label: '格式', options: ['text', 'hex'], default: 'text' }
    ],
    generateCode: (config) => `await broadcastTcpServer(${config.port}, _input, "${config.mode}");`
  },

  'output-file': {
    category: 'output',
    name: '写入文件',
    icon: '💾',
    color: '#7ee787',
    inputs: 1,
    outputs: 0,
    configFields: [
      { key: 'path', type: 'text', label: '文件路径', default: '' },
      { key: 'mode', type: 'select', label: '写入模式', options: ['追加', '覆盖'], default: '追加' }
    ],
    generateCode: (config) => `await writeFile("${escapeHTML(config.path)}", _input, "${config.mode === '追加' ? 'append' : 'overwrite'}");`
  },

  'output-log': {
    category: 'output',
    name: '日志输出',
    icon: '📋',
    color: '#7ee787',
    inputs: 1,
    outputs: 0,
    configFields: [
      { key: 'level', type: 'select', label: '级别', options: ['info', 'warn', 'error', 'debug'], default: 'info' },
      { key: 'prefix', type: 'text', label: '前缀', default: '' }
    ],
    generateCode: (config) => `console.log("[${escapeHTML(config.prefix)}] " + _input);`
  },

  'output-variable': {
    category: 'output',
    name: '变量存储',
    icon: '📦',
    color: '#7ee787',
    inputs: 1,
    outputs: 0,
    configFields: [
      { key: 'name', type: 'text', label: '变量名', default: 'result' }
    ],
    generateCode: (config) => `globalVars.${escapeHTML(config.name)} = _input;`
  }
};

// 节点分类（用于组件库分组）
const NODE_CATEGORIES = {
  input: { name: '输入类', icon: '📥', color: '#409EFF' },
  transform: { name: '转换类', icon: '🔄', color: '#67C23A' },
  split: { name: '分割类', icon: '✂️', color: '#E6A23C' },
  numeric: { name: '数值类', icon: '🔢', color: '#F56C6C' },
  string: { name: '字符类', icon: '📝', color: '#909399' },
  control: { name: '控制类', icon: '🔀', color: '#9B59B6' },
  output: { name: '输出类', icon: '📤', color: '#7ee787' }
};

/**
 * 生成节点的 HTML 内容（Drawflow 节点内部显示）
 * @param {string} type - 节点类型
 * @param {object} config - 当前配置值
 * @returns {string} HTML string
 */
function generateNodeHTML(type, config = {}) {
  const def = NODE_DEFINITIONS[type];
  if (!def) return '';

  let html = `<div class="df-node-header" style="border-left: 3px solid ${def.color};">
    <span class="df-node-icon">${def.icon}</span>
    <span class="df-node-title">${def.name}</span>
  </div>`;

  // 简化配置显示（仅显示第一个字段的值）
  if (def.configFields.length > 0) {
    const firstField = def.configFields[0];
    const value = config[firstField.key] || firstField.default;
    html += `<div class="df-node-body">${escapeHTML(value)}</div>`;
  }

  return html;
}

/**
 * 生成节点的配置面板 HTML（双击节点时显示）
 * @param {string} type - 节点类型
 * @param {object} config - 当前配置值
 * @returns {string} HTML string
 */
function generateConfigPanelHTML(type, config = {}) {
  const def = NODE_DEFINITIONS[type];
  if (!def) return '';

  let html = `<div class="df-config-panel">
    <div class="df-config-header">${def.icon} ${def.name}</div>
    <div class="df-config-body">`;

  def.configFields.forEach(field => {
    const value = config[field.key] || field.default;

    if (field.type === 'text') {
      html += `<div class="df-config-row">
        <label>${field.label}</label>
        <input type="text" data-key="${field.key}" value="${escapeHTML(value)}">
      </div>`;
    } else if (field.type === 'select') {
      html += `<div class="df-config-row">
        <label>${field.label}</label>
        <select data-key="${field.key}">
          ${field.options.map(opt => `<option ${opt === value ? 'selected' : ''}>${escapeHTML(opt)}</option>`).join('')}
        </select>
      </div>`;
    } else if (field.type === 'number') {
      html += `<div class="df-config-row">
        <label>${field.label}</label>
        <input type="number" data-key="${field.key}" value="${escapeHTML(value)}">
      </div>`;
    }
  });

  html += `</div>
    <div class="df-config-footer">
      <button class="df-config-ok">确定</button>
      <button class="df-config-cancel">取消</button>
    </div>
  </div>`;

  return html;
}

// 导出（供 flow-editor.js 使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NODE_DEFINITIONS, NODE_CATEGORIES, generateNodeHTML, generateConfigPanelHTML, escapeHTML };
}
// 浏览器/Electron renderer 全局暴露
if (typeof window !== 'undefined') {
  window.NODE_DEFINITIONS = NODE_DEFINITIONS;
  window.NODE_CATEGORIES = NODE_CATEGORIES;
  window.generateNodeHTML = generateNodeHTML;
  window.generateConfigPanelHTML = generateConfigPanelHTML;
  window.escapeHTML = escapeHTML;
}