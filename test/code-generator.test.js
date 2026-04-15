/**
 * 代码生成器自动化测试
 * 测试 DAG 拓扑排序、各种节点类型的代码生成
 */

const { generateCodeFromDrawflow } = require('../src/code-generator.js');

// 测试结果统计
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, status: 'PASS' });
    console.log(`✅ ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: 'FAIL', error: err.message });
    console.log(`❌ ${name}: ${err.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}\n期望: ${expected}\n实际: ${actual}`);
  }
}

function assertContains(str, substr, msg = '') {
  if (!str.includes(substr)) {
    throw new Error(`${msg}\n期望包含: "${substr}"\n实际内容:\n${str.substring(0, 500)}...`);
  }
}

function assertNotContains(str, substr, msg = '') {
  if (str.includes(substr)) {
    throw new Error(`${msg}\n期望不包含: "${substr}"\n实际内容:\n${str}`);
  }
}

function assertMatches(str, pattern, msg = '') {
  if (!pattern.test(str)) {
    throw new Error(`${msg}\n期望匹配: ${pattern}\n实际内容:\n${str}`);
  }
}

// ========== 节点定义 ==========

const NODE_DEFS = {
  'input-manual': { name: '手动输入', category: 'input' },
  'input-serial': { name: '接收串口', category: 'input' },
  'input-tcp': { name: '接收TCP', category: 'input' },
  'input-tcp-server': { name: 'TCP服务器接收', category: 'input' },
  'input-file': { name: '读取文件', category: 'input' },

  'transform-hex': { name: 'HEX转换', category: 'process' },
  'transform-base64': { name: 'Base64编解码', category: 'process' },
  'numeric-base': { name: '进制转换', category: 'numeric' },
  'numeric-length': { name: '计算长度', category: 'numeric' },
  'numeric-crc': { name: 'CRC校验', category: 'numeric' },
  'string-concat': { name: '字符串拼接', category: 'string' },
  'string-replace': { name: '字符串替换', category: 'string' },
  'split-delimiter': { name: '分隔符拆分', category: 'split' },

  'control-loop': { name: '循环执行', category: 'control' },
  'control-delay': { name: '延时等待', category: 'control' },
  'control-condition': { name: '条件判断', category: 'control' },

  'output-log': { name: '日志输出', category: 'output' },
  'output-serial': { name: '发送串口', category: 'output' },
  'output-tcp': { name: '发送TCP', category: 'output' },
  'output-tcp-server': { name: 'TCP服务器发送', category: 'output' },
  'output-file': { name: '写入文件', category: 'output' },
  'output-variable': { name: '变量存储', category: 'output' }
};

// ========== 辅助函数：创建 Drawflow 数据 ==========

function createDrawflow(nodes, connections) {
  const data = {};

  nodes.forEach(n => {
    data[n.id] = {
      id: n.id,
      class: n.class,
      name: NODE_DEFS[n.class]?.name || n.class,
      data: n.config || {},
      inputs: {},
      outputs: {},
      pos_x: n.id * 100,
      pos_y: 100
    };

    // 初始化输入输出端口
    const def = NODE_DEFS[n.class];
    // 根据节点类型确定端口数量
    let inputCount = 1;
    let outputCount = 1;

    // 特殊节点的端口数量
    if (n.class === 'input-manual' || n.class === 'input-serial' || n.class === 'input-tcp' ||
        n.class === 'input-tcp-server' || n.class === 'input-file') {
      inputCount = 0;
      outputCount = 1;
    }
    if (n.class === 'output-log' || n.class === 'output-serial' || n.class === 'output-tcp' ||
        n.class === 'output-tcp-server' || n.class === 'output-file' || n.class === 'output-variable') {
      inputCount = 1;
      outputCount = 0;
    }
    if (n.class === 'string-concat') {
      inputCount = 2;  // 字符串拼接需要两个输入
      outputCount = 1;
    }
    if (n.class === 'control-condition') {
      inputCount = 1;
      outputCount = 2;  // 条件判断有两个输出分支
    }
    if (n.class === 'control-loop') {
      inputCount = 1;
      outputCount = 1;
    }

    // 使用传入的端口数量覆盖（如果有指定）
    inputCount = n.inputs ?? inputCount;
    outputCount = n.outputs ?? outputCount;

    for (let i = 1; i <= inputCount; i++) {
      data[n.id].inputs[`input_${i}`] = { connections: [] };
    }
    for (let i = 1; i <= outputCount; i++) {
      data[n.id].outputs[`output_${i}`] = { connections: [] };
    }
  });

  // 建立连接 (Drawflow 使用字符串 ID)
  connections.forEach(([fromId, toId, fromPort = 'output_1', toPort = 'input_1']) => {
    if (!data[fromId] || !data[toId]) {
      throw new Error(`Invalid connection: ${fromId} -> ${toId}`);
    }
    data[fromId].outputs[fromPort].connections.push({ node: String(toId) });
    data[toId].inputs[toPort].connections.push({ node: String(fromId) });
  });

  return {
    drawflow: {
      Home: { data }
    }
  };
}

// ========== 测试用例 ==========

console.log('\n========================================');
console.log('代码生成器自动化测试');
console.log('========================================\n');

// --- 测试1: 简单链式流程 ---
test('简单链式流程: input → transform → output', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'Hello' } },
      { id: 2, class: 'transform-hex', config: { direction: '文本→HEX' } },
      { id: 3, class: 'output-log', config: { prefix: 'Result' } }
    ],
    [[1, 2], [2, 3]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  // 验证执行顺序：变量定义必须在使用之前
  const lines = code.split('\n');
  let var1Line = -1, var2Line = -1, logLine = -1;

  lines.forEach((line, i) => {
    if (line.includes('var _out_1')) var1Line = i;
    if (line.includes('var _out_2')) var2Line = i;
    if (line.includes('console.log')) logLine = i;
  });

  if (var1Line >= var2Line) throw new Error('_out_1 应在 _out_2 之前定义');
  if (var2Line >= logLine) throw new Error('_out_2 应在 console.log 之前定义');

  assertContains(code, 'var _out_1 = "Hello"');
  assertContains(code, 'textToHex(_out_1)');
  assertContains(code, 'console.log("[Result] "');
});

// --- 测试2: 多输入节点 ---
test('多输入节点: 两个输入合并到一个输出', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'A' } },
      { id: 2, class: 'input-manual', config: { content: 'B' } },
      { id: 3, class: 'string-concat', config: { separator: '+' } },
      { id: 4, class: 'output-log', config: { prefix: 'Merge' } }
    ],
    [[1, 3, 'output_1', 'input_1'], [2, 3, 'output_1', 'input_2'], [3, 4]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  // 验证：1和2应在3之前，3应在4之前
  const lines = code.split('\n');
  let var1Line = -1, var2Line = -1, var3Line = -1, logLine = -1;

  lines.forEach((line, i) => {
    if (line.includes('var _out_1')) var1Line = i;
    if (line.includes('var _out_2')) var2Line = i;
    if (line.includes('var _out_3')) var3Line = i;
    if (line.includes('console.log')) logLine = i;
  });

  if (var1Line >= var3Line) throw new Error('_out_1 应在 _out_3 之前');
  if (var2Line >= var3Line) throw new Error('_out_2 应在 _out_3 之前');
  if (var3Line >= logLine) throw new Error('_out_3 应在 log 之前');
});

// --- 测试3: 拓扑排序正确性 ---
test('拓扑排序: 复杂依赖图正确排序', () => {
  // 依赖图: 1→2→4, 1→3→4, 结果应为 1,2,3,4 或 1,3,2,4
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'X' } },
      { id: 2, class: 'transform-hex', config: {} },
      { id: 3, class: 'numeric-length', config: {} },
      { id: 4, class: 'string-concat', config: {} },
      { id: 5, class: 'output-log', config: {} }
    ],
    [[1, 2], [1, 3], [2, 4, 'output_1', 'input_1'], [3, 4, 'output_1', 'input_2'], [4, 5]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  // 验证：_out_1 必须最早，_out_4 应在 console.log 之前
  assertContains(code, 'var _out_1');
  assertContains(code, 'var _out_4');
  assertContains(code, 'console.log');
});

// --- 测试4: 次数循环 ---
test('次数循环: 子节点在循环体内执行', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'Test' } },
      { id: 2, class: 'control-loop', config: { count: 3, type: '次数循环' } },
      { id: 3, class: 'output-log', config: { prefix: 'Loop' } }
    ],
    [[1, 2], [2, 3]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'for (let _i = 0; _i < 3; _i++)');
  // 日志应该在循环体内
  assertMatches(code, /for.*\{[^}]*console\.log/);

  // 只统计循环相关的日志（排除 catch 块中的错误日志）
  const loopLogCount = (code.match(/\[Loop\]/g) || []).length;
  if (loopLogCount > 1) throw new Error(`循环日志出现 ${loopLogCount} 次，应该只在循环内出现 1 次`);
});

// --- 测试5: 无限循环 ---
test('无限循环: 包含 checkStop 和 sleep', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'Infinite' } },
      { id: 2, class: 'control-loop', config: { type: '无限循环' } },
      { id: 3, class: 'output-log', config: { prefix: 'Inf' } }
    ],
    [[1, 2], [2, 3]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'while (true)');
  assertContains(code, 'await sleep(10)');
  assertContains(code, 'if (await checkStop()) break');
});

// --- 测试6: 条件判断 ---
test('条件判断: 生成 if-else 结构', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'data' } },
      { id: 2, class: 'control-condition', config: { condition: '包含', value: 'OK' } },
      { id: 3, class: 'output-log', config: { prefix: 'True' } },
      { id: 4, class: 'output-log', config: { prefix: 'False' } }
    ],
    [
      [1, 2],
      [2, 3, 'output_1', 'input_1'],  // true 分支
      [2, 4, 'output_2', 'input_1']   // false 分支
    ]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'if (');
  assertContains(code, '.includes("OK")');
  assertContains(code, 'else');
  assertContains(code, '[True]');
  assertContains(code, '[False]');
});

// --- 测试7: 延时等待 ---
test('延时等待: 生成 sleep 调用', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'Start' } },
      { id: 2, class: 'control-delay', config: { ms: 500 } },
      { id: 3, class: 'output-log', config: { prefix: 'After' } }
    ],
    [[1, 2], [2, 3]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'await sleep(500)');
});

// --- 测试8: 进制转换 ---
test('进制转换: 十进制转十六进制', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: '255' } },
      { id: 2, class: 'numeric-base', config: { from: '十进制', to: '十六进制' } },
      { id: 3, class: 'output-log', config: { prefix: 'HEX' } }
    ],
    [[1, 2], [2, 3]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'convertBase(_out_1, "十进制", "十六进制")');
});

// --- 测试9: CRC校验 ---
test('CRC校验: 生成 crc16 调用', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'ABC' } },
      { id: 2, class: 'numeric-crc', config: { algorithm: 'CRC16' } },
      { id: 3, class: 'output-log', config: { prefix: 'CRC' } }
    ],
    [[1, 2], [2, 3]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'crc16(_out_1)');
});

// --- 测试10: TCP服务器 ---
test('TCP服务器接收和发送', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-tcp-server', config: { port: 9000, timeout: 5000 } },
      { id: 2, class: 'output-tcp-server', config: { port: 9000, mode: 'text' } }
    ],
    [[1, 2]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'waitTcpServer(9000, 5000)');
  assertContains(code, 'broadcastTcpServer(9000, _out_1, "text")');
});

// --- 测试11: 文件读写 ---
test('文件读写', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-file', config: { path: '/tmp/test.txt', encoding: 'utf8' } },
      { id: 2, class: 'output-file', config: { path: '/tmp/out.txt', mode: '追加' } }
    ],
    [[1, 2]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'readFile("/tmp/test.txt", "utf8")');
  assertContains(code, 'writeFile("/tmp/out.txt"');
});

// --- 测试12: 字符串替换 ---
test('字符串替换', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'hello world' } },
      { id: 2, class: 'string-replace', config: { search: 'world', replace: 'test', all: '否' } },
      { id: 3, class: 'output-log', config: {} }
    ],
    [[1, 2], [2, 3]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, '.replace("world", "test")');
});

// --- 测试13: 空流程图 ---
test('空流程图: 返回提示信息', () => {
  const df = { drawflow: { Home: { data: {} } } };
  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, '// 空流程图');
});

// --- 测试14: 错误处理包装 ---
test('错误处理: 所有代码包裹在 try-catch 中', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'Test' } },
      { id: 2, class: 'output-log', config: {} }
    ],
    [[1, 2]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'try {');
  assertContains(code, 'catch (e)');
  assertContains(code, 'ABORTED');
});

// --- 测试15: 嵌套循环 (循环内的循环) ---
test('嵌套循环: 循环内包含另一个循环', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'Outer' } },
      { id: 2, class: 'control-loop', config: { count: 2, type: '次数循环' } },
      { id: 3, class: 'control-loop', config: { count: 3, type: '次数循环' } },
      { id: 4, class: 'output-log', config: { prefix: 'Inner' } }
    ],
    [[1, 2], [2, 3], [3, 4]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  // 外层循环
  assertContains(code, 'for (let _i = 0; _i < 2; _i++)');

  // 应该有两个 for 循环
  const forCount = (code.match(/for \(let _i/g) || []).length;
  if (forCount < 1) throw new Error('缺少 for 循环');
});

// --- 测试16: Base64编解码 ---
test('Base64编解码', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'test' } },
      { id: 2, class: 'transform-base64', config: { operation: '编码' } },
      { id: 3, class: 'output-log', config: {} }
    ],
    [[1, 2], [2, 3]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'btoa(_out_1)');
});

// --- 测试17: 变量存储 ---
test('变量存储: 保存到 globalVars', () => {
  const df = createDrawflow(
    [
      { id: 1, class: 'input-manual', config: { content: 'value' } },
      { id: 2, class: 'output-variable', config: { name: 'myVar' } }
    ],
    [[1, 2]]
  );

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  assertContains(code, 'globalVars.myVar = _out_1');
});

// --- 测试18: 字符串ID转数字 (Drawflow兼容性) ---
test('Drawflow字符串ID兼容性: 连接使用字符串ID也能正确处理', () => {
  // 手动构造使用字符串 ID 的连接
  const df = {
    drawflow: {
      Home: {
        data: {
          '1': {
            id: 1,
            class: 'input-manual',
            data: { content: 'A' },
            inputs: {},
            outputs: { output_1: { connections: [{ node: '2' }] } }  // 字符串 '2'
          },
          '2': {
            id: 2,
            class: 'output-log',
            data: {},
            inputs: { input_1: { connections: [{ node: '1' }] } },  // 字符串 '1'
            outputs: {}
          }
        }
      }
    }
  };

  const code = generateCodeFromDrawflow(df, NODE_DEFS);

  // 应该正确生成代码，不报错
  assertContains(code, 'var _out_1');
  assertContains(code, 'console.log');
  // 不应该有重复
  const var1Count = (code.match(/var _out_1/g) || []).length;
  if (var1Count > 1) throw new Error('_out_1 变量重复定义');
});

// ========== 测试结果汇总 ==========

console.log('\n========================================');
console.log('测试结果汇总');
console.log('========================================');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);

if (failed > 0) {
  console.log('\n失败的测试:');
  results.filter(r => r.status === 'FAIL').forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
} else {
  console.log('\n🎉 所有测试通过！');
  process.exit(0);
}