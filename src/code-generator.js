/**
 * DAG → 可执行代码转换器
 * 将 Drawflow 流程图转换为可在 vm sandbox 执行的 JavaScript 代码
 */

/**
 * 从 Drawflow 导出数据生成代码
 * @param {object} drawflowData - Drawflow.export() 返回的 JSON
 * @param {object} nodeDefinitions - NODE_DEFINITIONS 引用
 * @returns {string} 可执行的 JavaScript 代码
 */
function generateCodeFromDrawflow(drawflowData, nodeDefinitions) {
  // 参数验证
  if (!drawflowData || !drawflowData.drawflow) {
    return '// 无效数据';
  }

  const homeData = drawflowData.drawflow.Home;
  if (!homeData || !homeData.data) {
    return '// 空流程图';
  }

  // Drawflow 数据结构:
  // { drawflow: { Home: { data: { nodeId: { id, name, class, data, inputs, outputs, pos } } } } }

  const nodes = Object.values(homeData.data);

  if (nodes.length === 0) {
    return '// 空流程图';
  }

  // 1. 构建依赖图
  const dependencyGraph = buildDependencyGraph(nodes);

  // 2. 拓扑排序获取执行顺序
  const executionOrder = topologicalSort(dependencyGraph, nodes);

  // 调试：输出执行顺序
  console.log('Execution order:', executionOrder.join(' -> '));
  console.log('Node map:', nodes.map(n => `${n.id}:${n.class}`).join(', '));

  // 3. 生成代码
  let code = `try {\n`;

  // 变量命名空间
  const varMap = new Map(); // nodeId -> 变量名
  // 已被控制节点处理的子节点（避免重复生成）
  const processedNodes = new Set();

  executionOrder.forEach(nodeId => {
    // 跳过已被控制节点处理的子节点
    if (processedNodes.has(nodeId)) return;

    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const nodeType = node.class;
    const def = nodeDefinitions[nodeType];
    if (!def) return;

    // 生成该节点的代码
    const nodeCode = generateNodeCode(node, def, varMap, nodeDefinitions, nodes, processedNodes);
    code += nodeCode;
  });

  code += `} catch (e) {\n  if (e.message !== 'ABORTED') console.log('Error: ' + e.message);\n}\n`;

  return code;
}

/**
 * 构建节点依赖图
 * @param {Array} nodes - 所有节点
 * @returns {Map} nodeId -> 依赖的节点 ID 列表
 */
function buildDependencyGraph(nodes) {
  const deps = new Map();

  nodes.forEach(node => {
    deps.set(node.id, []);

    // 查找所有输入连接
    if (node.inputs) {
      Object.keys(node.inputs).forEach(inputKey => {
        const connections = node.inputs[inputKey].connections || [];
        connections.forEach(conn => {
          // conn.node 是上游节点 ID
          deps.get(node.id).push(conn.node);
          console.log(`Dep: node ${node.id} depends on ${conn.node} (via ${inputKey})`);
        });
      });
    }
  });

  // 输出完整依赖图
  console.log('Dependency graph:', Array.from(deps.entries()).map(([k, v]) => `${k}:[${v.join(',')}]`).join(' | '));

  return deps;
}

/**
 * 拓扑排序
 * @param {Map} deps - 依赖图
 * @param {Array} nodes - 所有节点
 * @returns {Array} 执行顺序（节点 ID 列表）
 */
function topologicalSort(deps, nodes) {
  const visited = new Set();
  const result = [];
  const inProgress = new Set(); // 检测循环依赖

  function visit(nodeId) {
    // 统一转换为数字类型（Drawflow 连接使用字符串 ID）
    nodeId = Number(nodeId);
    console.log(`visit(${nodeId}): visited=${visited.has(nodeId)}, inProgress=${inProgress.has(nodeId)}`);
    if (visited.has(nodeId)) return;
    if (inProgress.has(nodeId)) {
      // 存在循环依赖（可能是循环控制节点）
      return;
    }

    inProgress.add(nodeId);

    // 先访问所有依赖
    const dependencies = deps.get(nodeId) || [];
    console.log(`  dependencies of ${nodeId}:`, dependencies);
    dependencies.forEach(depId => visit(depId));

    inProgress.delete(nodeId);
    visited.add(nodeId);
    console.log(`  adding ${nodeId} to result, result now:`, result);
    result.push(nodeId);
  }

  console.log('Starting topological sort...');
  console.log('Nodes to process:', nodes.map(n => n.id));

  // 从无依赖的节点开始（输入类节点）
  nodes.forEach(node => {
    const nodeDeps = deps.get(node.id) || [];
    console.log(`Checking node ${node.id}, deps:`, nodeDeps);
    if (nodeDeps.length === 0) {
      console.log(`  Node ${node.id} has no deps, calling visit`);
      visit(node.id);
    }
  });

  // 处理剩余节点
  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      console.log(`Node ${node.id} not yet visited, calling visit`);
      visit(node.id);
    }
  });

  console.log('Final result:', result);

  return result;
}

/**
 * 生成单个节点的代码
 * @param {object} node - 节点数据
 * @param {object} def - 节点定义
 * @param {Map} varMap - 变量映射
 * @param {object} nodeDefinitions - 所有节点定义
 * @param {Array} allNodes - 所有节点
 * @param {Set} processedNodes - 已处理的子节点集合
 * @returns {string} 该节点生成的代码
 */
function generateNodeCode(node, def, varMap, nodeDefinitions, allNodes, processedNodes = new Set()) {
  const indent = '  ';
  const nodeId = node.id;
  const config = node.data || {};

  // 检查停止标志
  let code = `${indent}if (await checkStop()) return;\n`;

  // 获取输入变量名
  const inputVars = getInputVariables(node, varMap, allNodes);

  // 根据节点类型生成代码
  if (def.category === 'input') {
    // 输入类节点：产生数据，不依赖上游
    code += generateInputNodeCode(node, def, config, varMap, indent);
  } else if (def.category === 'control') {
    // 控制类节点：特殊处理（循环、条件）
    code += generateControlNodeCode(node, def, config, varMap, nodeDefinitions, allNodes, indent, processedNodes);
  } else {
    // 处理类节点：依赖上游输入
    code += generateProcessingNodeCode(node, def, config, inputVars, varMap, indent);
  }

  return code;
}

/**
 * 获取节点的输入变量名列表
 * @param {object} node - 当前节点
 * @param {Map} varMap - 变量映射
 * @param {Array} allNodes - 所有节点
 * @returns {Array} 输入变量名数组
 */
function getInputVariables(node, varMap, allNodes) {
  const inputs = [];

  Object.keys(node.inputs).forEach(inputKey => {
    const connections = node.inputs[inputKey].connections || [];
    connections.forEach(conn => {
      // 统一转换为数字类型
      const upstreamId = Number(conn.node);
      const upstreamVar = varMap.get(upstreamId) || `_out_${upstreamId}`;
      inputs.push(upstreamVar);
    });
  });

  // 如果没有输入连接，使用默认输入
  if (inputs.length === 0) {
    inputs.push('_last_recv'); // 默认使用最近接收的数据
  }

  return inputs;
}

/**
 * 生成输入类节点代码
 */
function generateInputNodeCode(node, def, config, varMap, indent) {
  const varName = `_out_${node.id}`;
  varMap.set(node.id, varName);

  let code = '';

  if (def.name === '接收串口' || def.name === '接收TCP') {
    code += `${indent}var ${varName} = await waitOnePacket(${config.timeout || 5000});\n`;
  } else if (def.name === 'TCP服务器接收') {
    code += `${indent}var ${varName} = await waitTcpServer(${config.port || 9000}, ${config.timeout || 5000});\n`;
  } else if (def.name === '手动输入') {
    const content = config.content || '';
    if (config.mode === 'hex') {
      code += `${indent}var ${varName} = "${content}"; // HEX\n`;
    } else {
      code += `${indent}var ${varName} = "${escapeString(content)}";\n`;
    }
  } else if (def.name === '读取文件') {
    const safePath = escapeString(config.path || '');
    const encoding = config.encoding || 'utf8';
    code += `${indent}var ${varName} = await readFile("${safePath}", "${encoding}");\n`;
  } else if (def.name === '定时触发') {
    code += `${indent}await sleep(${config.interval || 1000});\n`;
    code += `${indent}var ${varName} = null; // 触发信号\n`;
  } else if (def.name === '等待接收') {
    code += `${indent}var ${varName} = await waitOnePacket(${config.timeout || 5000});\n`;
  } else {
    code += `${indent}var ${varName} = null; // ${def.name}\n`;
  }

  return code;
}

/**
 * 生成处理类节点代码（转换、分割、数值、字符、输出）
 */
function generateProcessingNodeCode(node, def, config, inputVars, varMap, indent) {
  const varName = `_out_${node.id}`;
  varMap.set(node.id, varName);

  let code = '';

  // 根据具体节点类型生成代码
  if (def.category === 'output') {
    // 输出类节点不产生变量，执行操作
    code += generateOutputNodeCode(node, def, config, inputVars, indent);
  } else if (def.category === 'control') {
    // 控制类节点已在 generateNodeCode 中处理
    return code;
  } else {
    // 其他处理节点产生输出变量
    code += `${indent}var ${varName} = ${generateNodeExpression(node, def, config, inputVars)};\n`;
  }

  return code;
}

/**
 * 生成控制类节点代码（循环、条件判断等）
 */
function generateControlNodeCode(node, def, config, varMap, nodeDefinitions, allNodes, indent, processedNodes = new Set()) {
  const nodeId = node.id;

  if (def.name === '延时等待') {
    return `${indent}await sleep(${config.ms || 1000});\n`;
  }

  if (def.name === '循环执行') {
    // 获取循环的输入变量，传递给循环内的子节点
    const inputVar = getInputVariables(node, varMap, allNodes)[0] || '_last_recv';
    // 循环节点输出 = 输入（循环不修改数据，只是控制流程）
    varMap.set(nodeId, inputVar);

    // 查找循环内部连接的节点（输出连接的下游）
    const loopChildren = findLoopChildren(node, allNodes);
    let childCode = '';

    if (loopChildren.length > 0) {
      // 递归生成子节点代码，并标记为已处理
      loopChildren.forEach(childId => {
        processedNodes.add(childId); // 标记子节点为已处理
        const childNode = allNodes.find(n => n.id === childId);
        if (childNode) {
          const childDef = nodeDefinitions[childNode.class];
          if (childDef) {
            childCode += generateNodeCode(childNode, childDef, varMap, nodeDefinitions, allNodes, processedNodes);
          }
        }
      });
    }

    if (config.type === '无限循环' || config.count === 0) {
      return `${indent}while (true) {\n${indent}  await sleep(10);\n${childCode}${indent}  if (await checkStop()) break;\n${indent}}\n`;
    }

    return `${indent}for (let _i = 0; _i < ${config.count || 1}; _i++) {\n${childCode}${indent}}\n`;
  }

  if (def.name === '条件判断') {
    // 查找条件分支的下游节点
    const outputs = node.outputs || {};
    const trueChildren = outputs['output_1']?.connections || [];
    const falseChildren = outputs['output_2']?.connections || [];

    // 构建条件表达式
    const inputVar = varMap.get(nodeId) || `_input_${nodeId}`;
    let condition = buildCondition(config, inputVar);

    let trueCode = '';
    let falseCode = '';

    // 生成分支代码，并标记子节点为已处理
    trueChildren.forEach(conn => {
      const childId = Number(conn.node);
      processedNodes.add(childId);
      const childNode = allNodes.find(n => n.id === childId);
      if (childNode) {
        const childDef = nodeDefinitions[childNode.class];
        if (childDef) {
          trueCode += generateNodeCode(childNode, childDef, varMap, nodeDefinitions, allNodes, processedNodes);
        }
      }
    });

    falseChildren.forEach(conn => {
      const childId = Number(conn.node);
      processedNodes.add(childId);
      const childNode = allNodes.find(n => n.id === childId);
      if (childNode) {
        const childDef = nodeDefinitions[childNode.class];
        if (childDef) {
          falseCode += generateNodeCode(childNode, childDef, varMap, nodeDefinitions, allNodes, processedNodes);
        }
      }
    });

    return `${indent}if (${condition}) {\n${trueCode}${indent}} else {\n${falseCode}${indent}}\n`;
  }

  return `${indent}// 控制: ${def.name}\n`;
}

/**
 * 查找循环节点的子节点（通过输出连接）
 */
function findLoopChildren(loopNode, allNodes) {
  const children = [];
  const outputs = loopNode.outputs || {};

  Object.keys(outputs).forEach(outputKey => {
    const connections = outputs[outputKey]?.connections || [];
    connections.forEach(conn => {
      // 统一转换为数字类型
      children.push(Number(conn.node));
    });
  });

  return children;
}

/**
 * 构建条件表达式
 */
function buildCondition(config, inputVar) {
  const value = config.value || '';

  if (config.condition === '包含') {
    return `${inputVar}.includes("${value}")`;
  }
  if (config.condition === '等于') {
    return `${inputVar} === "${value}"`;
  }
  if (config.condition === '大于') {
    return `${inputVar} > ${value}`;
  }
  if (config.condition === '小于') {
    return `${inputVar} < ${value}`;
  }
  if (config.condition === '正则匹配') {
    return `new RegExp("${value}").test(${inputVar})`;
  }

  return `${inputVar} /* condition */`;
}

/**
 * 生成节点处理表达式
 */
function generateNodeExpression(node, def, config, inputVars) {
  const input = inputVars[0] || '_input';

  // 转换类
  if (def.name === 'HEX转换') {
    if (config.direction === 'HEX→文本') {
      return `hexToText(${input})`;
    }
    return `textToHex(${input})`;
  }
  if (def.name === 'Base64编解码') {
    if (config.operation === '编码') return `btoa(${input})`;
    return `atob(${input})`;
  }
  if (def.name === '编码转换') {
    return `convertEncoding(${input}, "${config.from || 'utf8'}", "${config.to || 'utf8'}")`;
  }
  if (def.name === '字节序转换') {
    const size = config.size === '4字节' ? 4 : 2;
    return `swapBytes(${input}, ${size})`;
  }
  if (def.name === '大小写转换') {
    if (config.case === '转大写') return `${input}.toUpperCase()`;
    return `${input}.toLowerCase()`;
  }

  // 分割类
  if (def.name === '分隔符拆分') {
    const delim = getDelimiter(config);
    return `${input}.split("${delim}")`;
  }
  if (def.name === '按长度拆分') {
    return `chunkString(${input}, ${config.length || 2})`;
  }
  if (def.name === '截取子串') {
    const start = config.start || 0;
    const end = config.end === '末尾' ? '' : config.end;
    return `${input}.substring(${start}, ${end || `${input}.length`})`;
  }
  if (def.name === '去头尾字节') {
    return `${input}.slice(${config.head || 0}, ${input}.length - ${config.tail || 0})`;
  }
  if (def.name === '正则提取') {
    return `${input}.match(new RegExp("${escapeString(config.pattern || '')}", "${config.flags || 'g'}")) || []`;
  }

  // 数值类
  if (def.name === '计算长度') {
    if (config.type === '字符串长度' || !config.type) return `${input}.length`;
    if (config.type === '数组元素数') return `${input}.length`;
    return `Buffer.byteLength(${input})`;
  }
  if (def.name === '进制转换') {
    return `convertBase(${input}, "${config.from || '十进制'}", "${config.to || '十六进制'}")`;
  }
  if (def.name === '字节拼接数值') {
    return `bytesToNumber(${input}, "${config.type || 'uint16'}", "${config.order || '大端'}")`;
  }
  if (def.name === 'CRC校验') {
    const algMap = { 'CRC8': 'crc8', 'CRC16': 'crc16', 'CRC16-CCITT': 'crc16ccitt', 'CRC32': 'crc32', '校验和': 'checksum' };
    return `${algMap[config.algorithm] || 'crc16'}(${input})`;
  }
  if (def.name === '计算') {
    const ops = { '加': '+', '减': '-', '乘': '*', '除': '/', '取余': '%', '异或': '^', '与': '&', '或': '|' };
    const op = ops[config.operator] || '+';
    const operand2 = config.operand2 || '0';
    return `${input} ${op} ${operand2}`;
  }

  // 字符类
  if (def.name === '字符串拼接') {
    const separator = escapeString(config.separator || '');
    return `${inputVars[0] || ''} + "${separator}" + ${inputVars[1] || ''}`;
  }
  if (def.name === '字符串替换') {
    const search = escapeString(config.search || '');
    const replace = escapeString(config.replace || '');
    if (config.all === '是') {
      return `${input}.replaceAll("${search}", "${replace}")`;
    }
    return `${input}.replace("${search}", "${replace}")`;
  }
  if (def.name === '去除空白') {
    if (config.position === '两端') return `${input}.trim()`;
    if (config.position === '左侧') return `${input}.trimStart()`;
    if (config.position === '右侧') return `${input}.trimEnd()`;
    return `${input}.replace(/\\s/g, '')`;
  }
  if (def.name === '查找匹配') {
    const search = escapeString(config.search || '');
    if (config.return === '是否找到') return `${input}.includes("${search}")`;
    if (config.return === '位置索引') return `${input}.indexOf("${search}")`;
    return `(${input}.match(new RegExp("${search}", "g")) || []).length`;
  }
  if (def.name === '格式化模板') {
    // 需要特殊处理多输入
    let template = escapeString(config.template || '');
    template = template.replace(/\{(\d+)\}/g, (_, n) => `\${${inputVars[parseInt(n) - 1] || ''}}`);
    return `\`${template}\``;
  }

  // 默认
  return `${input} /* ${def.name} */`;
}

/**
 * 生成输出类节点代码
 */
function generateOutputNodeCode(node, def, config, inputVars, indent) {
  const input = inputVars[0] || '_output_data';

  if (def.name === '发送串口') {
    const append = config.append === '无' ? 'none' : (config.append || 'none').toLowerCase();
    return `${indent}await send(${input}, "${config.mode || 'text'}", "${append}");\n`;
  }
  if (def.name === '发送TCP') {
    return `${indent}await sendTCP("${escapeString(config.host || '127.0.0.1')}", ${config.port || 8080}, ${input}, "${config.mode || 'text'}");\n`;
  }
  if (def.name === 'TCP服务器发送') {
    return `${indent}await broadcastTcpServer(${config.port || 9000}, ${input}, "${config.mode || 'text'}");\n`;
  }
  if (def.name === '写入文件') {
    const mode = config.mode === '追加' ? 'append' : 'overwrite';
    return `${indent}await writeFile("${escapeString(config.path || '')}", ${input}, "${mode}");\n`;
  }
  if (def.name === '日志输出') {
    return `${indent}console.log("[${escapeString(config.prefix || '')}] " + ${input});\n`;
  }
  if (def.name === '变量存储') {
    return `${indent}globalVars.${escapeString(config.name || 'result')} = ${input};\n`;
  }

  return `${indent}// 输出: ${def.name}\n`;
}

/**
 * 获取分隔符
 */
function getDelimiter(config) {
  if (config.delimiter === '逗号') return ',';
  if (config.delimiter === '空格') return ' ';
  if (config.delimiter === '换行') return '\\n';
  if (config.delimiter === '制表符') return '\\t';
  return config.custom || ',';
}

/**
 * 转义字符串
 */
function escapeString(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateCodeFromDrawflow };
}
// 浏览器/Electron renderer 全局暴露
if (typeof window !== 'undefined') {
  window.generateCodeFromDrawflow = generateCodeFromDrawflow;
}
