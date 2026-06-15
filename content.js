console.log('🖱️ 自动点击器 Pro 已加载 - 支持轮询和监听');

let isPickerActive = false;
let highlightedElement = null;
let isRunning = false;
let allConfigs = [];
let pollingTimers = [];
let observers = [];
let onLoadWatchers = [];
const executingConfigIds = new Set();
const triggerEdgeStates = new Map();
const lastTriggeredAt = new Map();
const TRIGGER_COOLDOWN_MS = 2000;

// 获取元素的 XPath
function getXPath(element) {
  if (element.id) {
    return '//*[@id="' + element.id + '"]';
  }
  
  const parts = [];
  while (element && element.nodeType === Node.ELEMENT_NODE) {
    let index = 0;
    let sibling = element.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === element.tagName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }
    
    const tagName = element.tagName.toLowerCase();
    const pathIndex = index > 0 ? '[' + (index + 1) + ']' : '';
    parts.unshift(tagName + pathIndex);
    
    element = element.parentNode;
  }
  
  return '/' + parts.join('/');
}

// 通过 XPath 查找元素
function findElementByXPath(xpath) {
  try {
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue;
  } catch (e) {
    return null;
  }
}

// 获取元素数据
function getElementData(element) {
  return {
    tagName: element.tagName,
    textContent: element.textContent?.trim(),
    xpath: getXPath(element)
  };
}

// 点击元素（优先点击可交互父元素，避免点到内部 span 产生重复响应）
function clickElement(element) {
  const target = element?.closest?.('button, a, [role="button"], input[type="button"], input[type="submit"]') || element;
  console.log('✅ 点击元素:', target);
  target.click();
}

// 匹配元素
function findMatchingElement(elementData) {
  if (!elementData) return null;
  
  if (elementData.xpath) {
    const element = findElementByXPath(elementData.xpath);
    if (element) {
      return element;
    }
  }

  const targetText = (elementData.textContent || '').trim();
  // XPath 失效且无文字标识时，不回退到页面上第一个同标签元素
  if (!targetText) return null;

  const elements = document.getElementsByTagName(elementData.tagName || '*');

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (el.tagName === elementData.tagName) {
      const elText = (el.textContent || '').trim();
      if (elText.includes(targetText)) {
        return el;
      }
    }
  }
  
  return null;
}

// XPath 失效时，在包含触发文字的弹窗容器内查找关闭按钮
function findCloseButtonNearComboText(config) {
  const triggerText = config?.comboTrigger?.textContent;
  if (!triggerText || !checkTextMatch(triggerText)) return null;

  let bestContainer = null;
  let bestSize = Infinity;

  const containers = document.querySelectorAll('div, section, dialog, [role="dialog"]');
  for (const container of containers) {
    if (!container.innerText?.includes(triggerText)) continue;
    const textLen = container.innerText.length;
    if (textLen > 2000 || textLen >= bestSize) continue;
    bestSize = textLen;
    bestContainer = container;
  }

  if (!bestContainer) return null;
  const buttons = bestContainer.querySelectorAll('button');
  if (buttons.length === 0) return null;
  const emptyBtn = [...buttons].find(b => !(b.textContent || '').trim());
  return emptyBtn || buttons[0];
}

// 执行步骤
async function executeSteps(steps, configId) {
  const config = allConfigs.find(c => String(c.id) === String(configId));
  console.log('🚀 开始执行步骤，共', steps.length, '步，配置ID:', configId);
  
  for (const step of steps) {
    try {
      if (step.delay) {
        await new Promise(r => setTimeout(r, step.delay));
      }
      
      let element = findMatchingElement(step.elementData);
      if (!element && config) {
        element = findCloseButtonNearComboText(config);
        if (element) console.log('📍 通过弹窗上下文匹配到按钮:', element);
      }
      
      if (element) {
        const count = step.count || 1;
        for (let i = 0; i < count; i++) {
          clickElement(element);
          if (i < count - 1) {
            await new Promise(r => setTimeout(r, step.interval || 200));
          }
        }
      } else {
        console.warn('⚠️ 未找到目标元素，配置ID:', configId);
      }
    } catch (e) {
      console.error('❌ 执行步骤出错:', e);
    }
  }
  
  console.log('🏁 执行完毕');
}

// 带锁触发，防止同一配置重复执行
async function triggerConfig(config, options = {}) {
  const configId = config.id || 'default';
  const cooldown = options.cooldown ?? TRIGGER_COOLDOWN_MS;

  if (executingConfigIds.has(configId)) {
    console.log('⏳ 任务执行中，跳过触发:', config.name);
    return;
  }

  const elapsed = Date.now() - (lastTriggeredAt.get(configId) || 0);
  if (elapsed < cooldown) {
    console.log('⏳ 冷却中，跳过触发:', config.name, `(${cooldown - elapsed}ms)`);
    return;
  }

  executingConfigIds.add(configId);
  try {
    await executeSteps(config.steps, configId);
    lastTriggeredAt.set(configId, Date.now());
  } finally {
    executingConfigIds.delete(configId);
  }
}

// 上升沿检测：仅在条件从「不满足」变为「满足」时触发（避免弹窗仍存在时重复点击）
function shouldTriggerOnRisingEdge(config) {
  const configId = config.id || 'default';
  const current = shouldTriggerConfig(config);
  const previous = triggerEdgeStates.get(configId) ?? false;
  triggerEdgeStates.set(configId, current);
  return current && !previous;
}

// 检查网站匹配（包含匹配）
function checkWebsiteMatch(websiteUrl) {
  if (!websiteUrl) return true;
  return window.location.href.includes(websiteUrl);
}

// 检查文字匹配
function checkTextMatch(text) {
  if (!text) return false;
  return document.body.innerText.includes(text);
}

// 检查元素是否出现
function checkElementMatch(elementData) {
  return !!findMatchingElement(elementData);
}

// 检查组合条件
function checkComboTrigger(comboTrigger) {
  if (!comboTrigger) return false;
  
  console.log('🔍 检查组合条件:', comboTrigger);
  
  if (comboTrigger.requireWebsite) {
    if (!checkWebsiteMatch(comboTrigger.websiteUrl)) {
      console.log('❌ 网站条件不满足');
      return false;
    }
    console.log('✅ 网站条件满足');
  }
  
  if (comboTrigger.requireElement) {
    const elementMatch = checkElementMatch(comboTrigger.elementData);
    if (!elementMatch) {
      console.log('❌ 元素条件不满足');
      return false;
    }
    console.log('✅ 元素条件满足');
  }
  
  if (comboTrigger.requireText) {
    if (!checkTextMatch(comboTrigger.textContent)) {
      console.log('❌ 文字条件不满足');
      return false;
    }
    console.log('✅ 文字条件满足');
  }
  
  console.log('✅ 所有组合条件都满足！');
  return true;
}

// 检查配置是否应该触发
function shouldTriggerConfig(config) {
  if (!config) return false;
  
  if (config.triggerType === 'website') {
    return checkWebsiteMatch(config.websiteUrl);
  } else if (config.triggerType === 'element') {
    return checkElementMatch(config.triggerElement);
  } else if (config.triggerType === 'text') {
    return checkTextMatch(config.triggerText);
  } else if (config.triggerType === 'combo') {
    return checkComboTrigger(config.comboTrigger);
  }
  
  return false;
}

// 清除所有定时器和监听器
function cleanupOnLoadWatchers() {
  onLoadWatchers.forEach(id => clearTimeout(id));
  onLoadWatchers = [];
}

function cleanupPolling() {
  pollingTimers.forEach(timer => clearInterval(timer));
  pollingTimers = [];
  
  observers.forEach(observer => observer.disconnect());
  observers = [];

  cleanupOnLoadWatchers();
}

// 页面加载模式：等待条件出现后触发（解决弹窗异步渲染、SPA 跳转）
function startOnLoadWatcher(config) {
  const delay = config.loadDelay || 1000;
  const maxWait = 15000;
  const pollInterval = 300;
  const startTime = Date.now();

  const tryTrigger = () => {
    if (Date.now() - startTime > maxWait) {
      console.log('⏱️ 页面加载等待超时:', config.name);
      return;
    }

    if (shouldTriggerOnRisingEdge(config)) {
      console.log('🟢 页面加载触发:', config.name);
      triggerConfig(config);
      return;
    }

    const timerId = setTimeout(tryTrigger, pollInterval);
    onLoadWatchers.push(timerId);
  };

  const initialId = setTimeout(tryTrigger, delay);
  onLoadWatchers.push(initialId);
}

function restartOnLoadWatchers() {
  cleanupOnLoadWatchers();
  for (const config of allConfigs) {
    if (config.paused) continue;
    if ((config.triggerMode || 'auto') === 'manual') continue;
    if ((config.autoMode || 'onLoad') === 'onLoad') {
      startOnLoadWatcher(config);
    }
  }
}

let spaNavigationHooked = false;

function setupSpaNavigationHandler() {
  if (spaNavigationHooked) return;
  spaNavigationHooked = true;

  let lastUrl = location.href;

  const onNavigate = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    console.log('🔀 SPA 导航:', lastUrl);
    triggerEdgeStates.clear();
    lastTriggeredAt.clear();
    restartOnLoadWatchers();
  };

  window.addEventListener('popstate', onNavigate);
  const wrap = (fn) => function(...args) {
    const result = fn.apply(this, args);
    onNavigate();
    return result;
  };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
}

// 启动轮询
function startPolling(config) {
  console.log('🔄 启动轮询，配置:', config.name, '间隔:', config.pollingInterval);
  
  const timer = setInterval(() => {
    if (shouldTriggerConfig(config)) {
      console.log('⏰ 轮询触发:', config.name);
      triggerConfig(config);
    }
  }, config.pollingInterval);
  
  pollingTimers.push(timer);
}

// 启动监听器
function startObserver(config) {
  console.log('👀 启动持续监听，配置:', config.name);
  
  const observer = new MutationObserver(() => {
    if (shouldTriggerOnRisingEdge(config)) {
      console.log('⚡ 监听触发:', config.name);
      triggerConfig(config);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  
  observers.push(observer);
}

// 主运行函数
async function run() {
  if (isRunning) return;
  isRunning = true;
  
  await loadConfigs();
  
  if (!allConfigs || allConfigs.length === 0) {
    isRunning = false;
    return;
  }
  
  cleanupPolling();
  triggerEdgeStates.clear();
  lastTriggeredAt.clear();
  
  for (const config of allConfigs) {
    if (config.paused) {
      console.log('⏸️ 配置已暂停:', config.name);
      continue;
    }
    
    const triggerMode = config.triggerMode || 'auto';
    
    if (triggerMode === 'manual') {
      console.log('👆 仅手动触发:', config.name);
      continue;
    }
    
    const autoMode = config.autoMode || 'onLoad';
    
    if (autoMode === 'onLoad') {
      startOnLoadWatcher(config);
    } else if (autoMode === 'polling') {
      startPolling(config);
    } else if (autoMode === 'observer') {
      startObserver(config);
    }
  }
  
  setupSpaNavigationHandler();
  isRunning = false;
}

// 开始拾取
function startPicker(stepId) {
  isPickerActive = true;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mouseover', handleOver);
  document.addEventListener('mouseout', handleOut);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeydown);
}

// 停止拾取
function stopPicker() {
  isPickerActive = false;
  document.body.style.cursor = '';
  document.removeEventListener('mouseover', handleOver);
  document.removeEventListener('mouseout', handleOut);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeydown);
  
  if (highlightedElement) {
    highlightedElement.style.outline = '';
    highlightedElement = null;
  }
}

function handleOver(e) {
  if (!isPickerActive) return;
  if (highlightedElement) highlightedElement.style.outline = '';
  highlightedElement = e.target;
  highlightedElement.style.outline = '3px solid red';
}

function handleOut(e) {
  if (!isPickerActive) return;
  if (highlightedElement) {
    highlightedElement.style.outline = '';
    highlightedElement = null;
  }
}

function handleKeydown(e) {
  if (e.key === 'Escape') stopPicker();
}

function handleClick(e) {
  if (!isPickerActive) return;
  e.preventDefault();
  e.stopPropagation();
  
  const elementData = getElementData(e.target);
  chrome.storage.local.set({ pendingElementData: elementData });
  stopPicker();
}

// 加载配置
function loadConfigs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['configs'], (result) => {
      allConfigs = result.configs || [];
      resolve(allConfigs);
    });
  });
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startPicker') {
    startPicker(request.stepId);
  }
  if (request.action === 'test') {
    if (request.config && request.config.steps) {
      triggerConfig({ ...request.config, id: 'test' });
    }
  }
  if (request.action === 'triggerRun') {
    console.log('📨 收到 background triggerRun 消息');
    tryRun();
  }
  sendResponse({ status: 'ok' });
  return true;
});

// 页面加载完成后运行（兼容 Chrome / Edge 不同注入时机）
let hasRun = false;

function tryRun() {
  if (hasRun) return;
  hasRun = true;
  console.log('🟢 tryRun 触发, readyState:', document.readyState);
  run();
}

if (document.readyState === 'complete') {
  setTimeout(tryRun, 100);
} else if (document.readyState === 'interactive') {
  setTimeout(tryRun, 300);
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(tryRun, 300));
}
window.addEventListener('load', () => setTimeout(tryRun, 100));

// 监听配置变化
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.configs) return;
  loadConfigs().then(() => {
    if (!isRunning) {
      hasRun = false;
      run();
    }
  });
});

console.log('✅ content.js 初始化完成 - 支持轮询和监听');
