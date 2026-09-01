// 自动点击器 Pro - content script
// 防止 content_scripts 与 chrome.scripting 重复注入时初始化两次
if (window.__autoClickerProLoaded) {
  console.log('🖱️ 自动点击器 Pro 已存在，跳过重复注入');
} else {
  window.__autoClickerProLoaded = true;
  autoClickerProMain();
}

function autoClickerProMain() {

const IS_TOP = window.top === window;
const FRAME_TAG = IS_TOP ? '' : '[iframe]';

// 极小 / 隐藏的辅助 iframe（埋点、广告像素等）不参与，省性能
if (!IS_TOP && (window.innerWidth < 30 || window.innerHeight < 30)) {
  return;
}

function log(...args) {
  console.log('🖱️' + FRAME_TAG, ...args);
}
function warn(...args) {
  console.warn('🖱️' + FRAME_TAG, ...args);
}

log('自动点击器 Pro 已加载');

let isPickerActive = false;
let highlightedElement = null;
let isRunning = false;
let rerunQueued = false;
let allConfigs = [];
let pollingTimers = [];
let observers = [];
let observerDebounceTimers = [];
let onLoadWatchers = [];

const executingConfigIds = new Set();
const triggerEdgeStates = new Map();
const lastAttemptAt = new Map();
const failureCounts = new Map();

const TRIGGER_COOLDOWN_MS = 2000;
const MAX_FAILURE_BACKOFF = 8; // 冷却最多放大 8 倍
const MIN_MATCH_SCORE = 50;    // 低于该分数视为「没找到」，不乱点
const HIGH_MATCH_SCORE = 85;   // 高置信度，直接采用
const MAX_STRUCTURAL_CANDIDATES = 300;

/* ==========================================================================
 * 元素特征采集：不再只靠绝对 XPath，而是采集多种互补信号
 * ========================================================================== */

// 会随每次渲染变化的 id / 属性值（框架自动生成、hash、随机数）
const GENERATED_VALUE_RE = /(:r[0-9a-z]+:)|([0-9a-f]{12,})|(\d{6,})|(uuid)|(--[0-9a-z]{6,})/i;
const GENERATED_ID_RE = /^(rc[-_])|^(ant[-_])|^(el[-_])|^(mui[-_])|^(radix[-_])|^(headlessui[-_])|^(react[-_])|^(vue[-_])|^(:)/i;
// CSS Modules / emotion / styled-components 等生成的 class
// Modal_wrapper__a1b2c、Button_root__3xY9a：`__` 后带数字的后缀基本都是 hash，
// 而 BEM 的 modal__close 这类纯字母后缀是语义信息，要保留
const GENERATED_CLASS_RE = /^(css-|jsx-|sc-|emotion-|styled__)|^[a-zA-Z]+_[a-zA-Z0-9]{5,}$|__[a-zA-Z0-9]*\d[a-zA-Z0-9]*$|[0-9a-f]{6,}$/;
// 表示「状态」的 class，会随交互变化，不能当稳定特征
const STATE_CLASS_RE = /^(is-|has-|js-|active|inactive|open|opened|close|closed|show|shown|visible|hidden|invisible|selected|checked|disabled|enabled|focus|focused|hover|hovered|current|expanded|collapsed|loading|pending|error|success|warning|dragging|animating|entered|exiting)/i;

const STABLE_ATTRS = [
  'data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy',
  'data-id', 'data-action', 'data-role', 'data-name', 'data-key', 'data-type',
  'name', 'aria-label', 'title', 'alt', 'placeholder', 'role', 'type', 'for'
];

function cssEscape(value) {
  if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function escapeAttrValue(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksGenerated(value) {
  return GENERATED_VALUE_RE.test(value);
}

function isStableIdValue(id) {
  if (!id || typeof id !== 'string') return false;
  const value = id.trim();
  if (!value || value.length > 60) return false;
  if (GENERATED_ID_RE.test(value)) return false;
  if (looksGenerated(value)) return false;
  return true;
}

function isUniqueSelector(selector) {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch (e) {
    return false;
  }
}

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// 优先用 innerText（浏览器里会排除隐藏文字），环境不支持时退回 textContent
function elementText(el) {
  if (!el) return '';
  const inner = el.innerText;
  return normalizeText(inner ?? el.textContent);
}

function stableClasses(el) {
  if (!el.classList) return [];
  return [...el.classList].filter(cls =>
    cls &&
    cls.length <= 40 &&
    !GENERATED_CLASS_RE.test(cls) &&
    !STATE_CLASS_RE.test(cls) &&
    !looksGenerated(cls)
  );
}

function collectStableAttrs(el) {
  const out = {};
  if (!el.getAttribute) return out;

  for (const name of STABLE_ATTRS) {
    const raw = el.getAttribute(name);
    if (!raw) continue;
    const value = raw.trim();
    if (!value || value.length > 80) continue;
    if (looksGenerated(value)) continue;
    out[name] = value;
  }

  if (el.tagName === 'A') {
    const href = el.getAttribute('href');
    if (href && href.length <= 160 && !looksGenerated(href) && !/^javascript:/i.test(href)) {
      out.href = href;
    }
  }

  return out;
}

function firstStableAttrSelector(el) {
  const attrs = collectStableAttrs(el);
  for (const name of ['data-testid', 'data-test-id', 'data-test', 'data-qa', 'data-cy', 'data-id', 'name', 'aria-label']) {
    if (attrs[name]) return `[${name}="${escapeAttrValue(attrs[name])}"]`;
  }
  return null;
}

function nthOfTypeIndex(el) {
  const parent = el.parentElement;
  if (!parent) return 0;
  const sameTag = [...parent.children].filter(c => c.tagName === el.tagName);
  if (sameTag.length <= 1) return 0; // 唯一同类子元素，不写死序号更抗结构变化
  return sameTag.indexOf(el) + 1;
}

// 从元素向上构造 CSS 路径，遇到稳定 id / testid 就停下作为锚点
function buildCssPath(el, { withIndex = true } = {}) {
  const parts = [];
  let node = el;
  let depth = 0;

  while (node && node.nodeType === Node.ELEMENT_NODE && depth < 8) {
    if (node === document.documentElement || node === document.body) {
      parts.unshift(node.tagName.toLowerCase());
      break;
    }

    const id = node.getAttribute('id');
    if (id && isStableIdValue(id) && isUniqueSelector('#' + cssEscape(id))) {
      parts.unshift('#' + cssEscape(id));
      break;
    }

    let part = node.tagName.toLowerCase();
    const attrSelector = firstStableAttrSelector(node);
    if (attrSelector) {
      parts.unshift(part + attrSelector);
      break;
    }

    const classes = stableClasses(node).slice(0, 2).map(c => '.' + cssEscape(c)).join('');
    part += classes;

    if (withIndex) {
      const index = nthOfTypeIndex(node);
      if (index > 0) part += `:nth-of-type(${index})`;
    }

    parts.unshift(part);
    node = node.parentElement;
    depth++;
  }

  return parts.join(' > ');
}

// 附近的上下文文字（弹窗标题等），用于图标按钮这类没有自身文字的元素
function buildContextText(el) {
  let node = el.parentElement;
  let depth = 0;
  while (node && depth < 4) {
    const text = elementText(node);
    if (text && text.length >= 4) return text.slice(0, 120);
    node = node.parentElement;
    depth++;
  }
  return '';
}

function getXPath(element) {
  if (element.id && isStableIdValue(element.id)) {
    return '//*[@id="' + element.id + '"]';
  }

  const parts = [];
  let node = element;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    let index = 0;
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === node.tagName) {
        index++;
      }
      sibling = sibling.previousSibling;
    }

    const tagName = node.tagName.toLowerCase();
    const pathIndex = index > 0 ? '[' + (index + 1) + ']' : '';
    parts.unshift(tagName + pathIndex);

    node = node.parentNode;
  }

  return '/' + parts.join('/');
}

function findElementByXPath(xpath) {
  try {
    const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return result.singleNodeValue;
  } catch (e) {
    return null;
  }
}

// 采集元素数据（tagName / textContent / xpath 保持与旧配置同名，向后兼容）
function getElementData(element) {
  const id = element.getAttribute?.('id');
  return {
    v: 2,
    tagName: element.tagName,
    textContent: normalizeText(element.textContent).slice(0, 200),
    xpath: getXPath(element),
    stableId: id && isStableIdValue(id) ? id : null,
    attrs: collectStableAttrs(element),
    classes: stableClasses(element).slice(0, 6),
    cssPath: buildCssPath(element, { withIndex: true }),
    cssPathLoose: buildCssPath(element, { withIndex: false }),
    contextText: buildContextText(element),
    siblingIndex: nthOfTypeIndex(element),
    childCount: element.children?.length ?? 0,
    isClickable: !!element.closest?.('button, a, [role="button"], input, [onclick], [tabindex]')
  };
}

/* ==========================================================================
 * 元素匹配：多策略召回 + 打分，只有足够可信才返回
 * ========================================================================== */

function queryAll(selector, out) {
  if (!selector) return;
  try {
    const found = document.querySelectorAll(selector);
    for (const el of found) out.add(el);
  } catch (e) { /* 选择器非法，忽略 */ }
}

function isVisible(el) {
  if (!el || !el.isConnected) return false;
  try {
    // 先看内联/计算样式，再看几何。反过来的话在无布局引擎的环境里
    // getClientRects() 恒为空，会把所有元素都判成不可见
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.display === 'none') return false;
    if (parseFloat(style.opacity) === 0) return false;

    // 祖先链上被隐藏（display:none 的子树 getComputedStyle 不一定继承）
    let node = el;
    let depth = 0;
    while (node && depth < 30) {
      if (node.hidden) return false;
      if (node.getAttribute?.('aria-hidden') === 'true') return false;
      const nodeStyle = node === el ? style : getComputedStyle(node);
      if (nodeStyle.display === 'none' || nodeStyle.visibility === 'hidden') return false;
      node = node.parentElement;
      depth++;
    }

    // 有布局信息时再用几何做一次确认
    const rects = el.getClientRects();
    if (rects.length > 0) {
      const rect = rects[0];
      if (rect.width === 0 && rect.height === 0) return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

function textSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter)) return shorter.length / longer.length;
  return 0;
}

function scoreCandidate(el, data) {
  if (!el || !el.isConnected) return -Infinity;

  let score = 0;

  if (data.tagName) {
    if (el.tagName === data.tagName) score += 20;
    else score -= 25;
  }

  if (data.stableId && el.getAttribute?.('id') === data.stableId) score += 45;

  const attrs = data.attrs || {};
  for (const [name, value] of Object.entries(attrs)) {
    const actual = el.getAttribute?.(name);
    if (actual == null) continue;
    if (actual.trim() !== value) continue;
    if (name.startsWith('data-') || name === 'aria-label' || name === 'name') score += 30;
    else if (name === 'role' || name === 'type') score += 8;
    else score += 18;
  }

  const targetText = normalizeText(data.textContent);
  if (targetText) {
    const elText = normalizeText(el.textContent);
    if (elText === targetText) score += 32;
    else {
      const sim = textSimilarity(targetText, elText);
      if (sim >= 0.8) score += 22;
      else if (sim >= 0.4) score += 12;
      else if (elText && elText.includes(targetText)) score += 8;
    }
  }

  const targetClasses = data.classes || [];
  if (targetClasses.length) {
    const elClasses = new Set(el.classList || []);
    const hit = targetClasses.filter(c => elClasses.has(c)).length;
    if (hit) score += Math.round((hit / targetClasses.length) * 20);
  }

  if (data.cssPath) {
    try { if (el.matches(data.cssPath)) score += 26; } catch (e) { /* ignore */ }
  }
  if (data.cssPathLoose) {
    try { if (el.matches(data.cssPathLoose)) score += 10; } catch (e) { /* ignore */ }
  }

  if (data.contextText) {
    const scope = el.parentElement || el.closest?.('div, section, dialog');
    const context = elementText(scope);
    if (context && (context.includes(data.contextText) || data.contextText.includes(context.slice(0, 60)))) {
      score += 14;
    }
  }

  if (typeof data.siblingIndex === 'number' && data.siblingIndex > 0 && nthOfTypeIndex(el) === data.siblingIndex) {
    score += 6;
  }

  if (data.isClickable && el.closest?.('button, a, [role="button"], input, [onclick], [tabindex]')) {
    score += 5;
  }

  return score;
}

function findMatchingElement(data) {
  if (!data) return null;

  const candidates = new Set();

  // 策略 1：稳定 id
  if (data.stableId) queryAll('#' + cssEscape(data.stableId), candidates);

  // 策略 2：稳定属性（testid / aria-label / name 等）
  const attrs = data.attrs || {};
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'role' || name === 'type') continue; // 太泛，只用于打分
    const selector = `[${name}="${escapeAttrValue(value)}"]`;
    queryAll(selector, candidates);
  }

  // 策略 3：CSS 路径（精确 + 宽松）
  queryAll(data.cssPath, candidates);
  queryAll(data.cssPathLoose, candidates);

  // 策略 4：绝对 XPath（兼容 v1 旧配置）
  if (data.xpath) {
    const byXPath = findElementByXPath(data.xpath);
    if (byXPath) candidates.add(byXPath);
  }

  // 策略 5：标签 + 文字
  const targetText = normalizeText(data.textContent);
  if (targetText) {
    const tag = data.tagName || '*';
    let scanned = 0;
    try {
      for (const el of document.getElementsByTagName(tag)) {
        if (++scanned > 1500) break;
        const elText = normalizeText(el.textContent);
        if (elText && (elText === targetText || elText.includes(targetText))) {
          candidates.add(el);
        }
      }
    } catch (e) { /* ignore */ }
  }

  // 策略 6：以上都没召回到时，按标签做结构化兜底
  if (candidates.size === 0 && data.tagName) {
    try {
      const list = document.getElementsByTagName(data.tagName);
      const limit = Math.min(list.length, MAX_STRUCTURAL_CANDIDATES);
      for (let i = 0; i < limit; i++) candidates.add(list[i]);
    } catch (e) { /* ignore */ }
  }

  if (candidates.size === 0) return null;

  // 第一轮：不算可见性（getComputedStyle 很贵），先粗排
  const scored = [];
  for (const el of candidates) {
    const score = scoreCandidate(el, data);
    if (score > 0) scored.push({ el, score });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);

  // 第二轮：只对头部候选算可见性加成
  const top = scored.slice(0, 8);
  for (const item of top) {
    item.visible = isVisible(item.el);
    if (item.visible) item.score += 15;
  }
  top.sort((a, b) => b.score - a.score);

  const best = top[0];
  if (!best || best.score < MIN_MATCH_SCORE) return null;

  // 同分且更靠前的可见元素优先
  const visibleBest = top.find(item => item.visible && item.score >= MIN_MATCH_SCORE);
  return (visibleBest || best).el;
}

// 弹窗上下文兜底：在包含触发文字的最小容器里找关闭按钮
function findCloseButtonNearText(triggerText) {
  if (!triggerText || !checkTextMatch(triggerText)) return null;

  const target = normalizeText(triggerText);
  let bestContainer = null;
  let bestSize = Infinity;

  const containers = document.querySelectorAll('div, section, dialog, [role="dialog"], [role="alertdialog"]');
  for (const container of containers) {
    const text = elementText(container);
    if (!text.includes(target)) continue;
    if (text.length > 2000 || text.length >= bestSize) continue;
    if (!isVisible(container)) continue;
    bestSize = text.length;
    bestContainer = container;
  }

  if (!bestContainer) return null;

  const buttons = [...bestContainer.querySelectorAll('button, [role="button"], a, [class*="close"], [aria-label*="close" i], [aria-label*="关闭"]')]
    .filter(isVisible);
  if (buttons.length === 0) return null;

  const byAria = buttons.find(b => /close|关闭|dismiss|取消/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || ''));
  if (byAria) return byAria;

  const emptyBtn = buttons.find(b => !elementText(b));
  return emptyBtn || buttons[0];
}

function getConfigFallbackText(config) {
  if (!config) return '';
  if (config.triggerType === 'combo' && config.comboTrigger?.requireText) {
    return config.comboTrigger.textContent || '';
  }
  if (config.triggerType === 'text') return config.triggerText || '';
  return '';
}

/* ==========================================================================
 * 点击
 * ========================================================================== */

function resolveClickTarget(element) {
  return element?.closest?.('button, a, [role="button"], input[type="button"], input[type="submit"]') || element;
}

function clickElement(element) {
  const target = resolveClickTarget(element);
  if (!target) return false;

  try {
    const rect = target.getBoundingClientRect();
    const outOfView = rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth;
    if (outOfView) target.scrollIntoView({ block: 'center', inline: 'center' });
  } catch (e) { /* ignore */ }

  try { target.focus?.({ preventScroll: true }); } catch (e) { /* ignore */ }

  log('✅ 点击元素:', target);
  try {
    if (typeof target.click === 'function') {
      target.click();
    } else {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  } catch (e) {
    warn('❌ 点击失败:', e);
    return false;
  }
}

/* ==========================================================================
 * 执行步骤
 * ========================================================================== */

async function executeSteps(config) {
  const steps = config?.steps || [];
  log('🚀 开始执行步骤，共', steps.length, '步，配置:', config?.name);

  let clicked = 0;
  let missed = 0;
  const fallbackText = getConfigFallbackText(config);

  for (const step of steps) {
    try {
      if (step.delay) {
        await new Promise(r => setTimeout(r, step.delay));
      }

      let element = findMatchingElement(step.elementData);
      if (!element && fallbackText) {
        element = findCloseButtonNearText(fallbackText);
        if (element) log('📍 通过弹窗上下文匹配到按钮:', element);
      }

      if (element) {
        const count = Math.max(1, step.count || 1);
        for (let i = 0; i < count; i++) {
          if (clickElement(element)) clicked++;
          if (i < count - 1) {
            await new Promise(r => setTimeout(r, step.interval || 200));
          }
          if (!element.isConnected) break; // 元素已被移除（弹窗关掉了），无需继续
        }
      } else {
        missed++;
        warn('⚠️ 未找到目标元素，配置:', config?.name, '步骤:', step.order ?? step.id);
      }
    } catch (e) {
      warn('❌ 执行步骤出错:', e);
      missed++;
    }
  }

  log('🏁 执行完毕 - 成功点击', clicked, '次，未找到', missed, '个');
  return { clicked, missed };
}

function effectiveCooldown(configId, base) {
  const failures = failureCounts.get(configId) || 0;
  if (failures === 0) return base;
  return base * Math.min(Math.pow(2, failures), MAX_FAILURE_BACKOFF);
}

// 带锁触发；返回 {clicked, missed} 或 null（被锁/冷却拦截）
async function triggerConfig(config, options = {}) {
  const configId = String(config.id ?? 'default');
  const base = options.cooldown ?? TRIGGER_COOLDOWN_MS;

  if (executingConfigIds.has(configId)) {
    return null;
  }

  if (base > 0) {
    const cooldown = effectiveCooldown(configId, base);
    const elapsed = Date.now() - (lastAttemptAt.get(configId) || 0);
    if (elapsed < cooldown) {
      return null;
    }
  }

  executingConfigIds.add(configId);
  lastAttemptAt.set(configId, Date.now());
  try {
    const result = await executeSteps(config);
    if (result.clicked > 0) {
      failureCounts.delete(configId);
    } else {
      failureCounts.set(configId, (failureCounts.get(configId) || 0) + 1);
    }
    // 无论成败都更新时间戳，避免匹配失败时高频重试
    lastAttemptAt.set(configId, Date.now());
    return result;
  } finally {
    executingConfigIds.delete(configId);
  }
}

/* ==========================================================================
 * 触发条件
 * ========================================================================== */

function normalizeUrlForMatch(url) {
  return String(url || '')
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

// iframe 里 location.href 是子帧地址，需要同时考虑顶层页面地址
function getMatchableUrls() {
  const urls = [location.href];
  if (!IS_TOP) {
    try {
      if (window.top?.location?.href) urls.push(window.top.location.href);
    } catch (e) {
      // 跨域，退化到 referrer / ancestorOrigins
      if (document.referrer) urls.push(document.referrer);
      try {
        for (const origin of location.ancestorOrigins || []) urls.push(origin);
      } catch (e2) { /* ignore */ }
    }
  }
  return urls;
}

function checkWebsiteMatch(pattern) {
  if (!pattern) return true;
  const pat = normalizeUrlForMatch(pattern);
  if (!pat) return true;

  const patBase = pat.split(/[?#]/)[0];

  for (const raw of getMatchableUrls()) {
    const url = normalizeUrlForMatch(raw);
    if (!url) continue;

    if (pat.includes('*')) {
      const re = new RegExp(pat.split('*').map(escapeRegExp).join('.*'));
      if (re.test(url)) return true;
      continue;
    }

    if (url.includes(pat)) return true;
    // 配置里误存了带 query/hash 的完整地址时，退化为只比 host+path
    if (patBase && patBase !== pat && url.split(/[?#]/)[0].includes(patBase)) return true;
  }

  return false;
}

function checkTextMatch(text) {
  if (!text) return false;
  const target = normalizeText(text);
  if (!target) return false;
  const body = document.body;
  if (!body) return false;
  return elementText(body).includes(target);
}

function checkElementMatch(elementData) {
  return !!findMatchingElement(elementData);
}

function checkComboTrigger(comboTrigger) {
  if (!comboTrigger) return false;

  const hasAnyCondition = comboTrigger.requireWebsite || comboTrigger.requireElement || comboTrigger.requireText;
  if (!hasAnyCondition) return false; // 一个条件都没勾，绝不能视为「满足」

  if (comboTrigger.requireWebsite && !checkWebsiteMatch(comboTrigger.websiteUrl)) return false;
  if (comboTrigger.requireElement && !checkElementMatch(comboTrigger.elementData)) return false;
  if (comboTrigger.requireText && !checkTextMatch(comboTrigger.textContent)) return false;

  return true;
}

function shouldTriggerConfig(config) {
  if (!config) return false;

  if (config.triggerType === 'website') return checkWebsiteMatch(config.websiteUrl);
  if (config.triggerType === 'element') return checkElementMatch(config.triggerElement);
  if (config.triggerType === 'text') return checkTextMatch(config.triggerText);
  if (config.triggerType === 'combo') return checkComboTrigger(config.comboTrigger);

  return false;
}

// 上升沿：条件从「不满足」变「满足」时才触发。
// 关键点：只有真的点到了才把状态置为已触发；匹配失败不置位，下次还能重试。
function evaluateRisingEdge(configId, config) {
  const current = shouldTriggerConfig(config);
  if (!current) {
    triggerEdgeStates.set(configId, false);
    return false;
  }
  if (triggerEdgeStates.get(configId)) return false;
  return true;
}

function markEdgeResult(configId, result) {
  if (result && result.clicked > 0) {
    triggerEdgeStates.set(configId, true);
  }
}

/* ==========================================================================
 * 运行模式
 * ========================================================================== */

function cleanupOnLoadWatchers() {
  onLoadWatchers.forEach(id => clearTimeout(id));
  onLoadWatchers = [];
}

function cleanupPolling() {
  pollingTimers.forEach(timer => clearInterval(timer));
  pollingTimers = [];

  observers.forEach(observer => observer.disconnect());
  observers = [];

  observerDebounceTimers.forEach(id => clearTimeout(id));
  observerDebounceTimers = [];

  cleanupOnLoadWatchers();
}

function getLiveConfig(configId) {
  return allConfigs.find(c => String(c.id) === String(configId));
}

// 页面加载模式：持续等待条件出现（弹窗异步渲染、SPA 跳转都能覆盖）
// 前 15 秒高频检测，之后降频长期守候；靠上升沿避免重复点击
function startOnLoadWatcher(configId, initialDelay) {
  const FAST_INTERVAL = 300;
  const SLOW_INTERVAL = 1000;
  const FAST_PHASE_MS = 15000;
  const startTime = Date.now();

  const tick = () => {
    const config = getLiveConfig(configId);
    if (!config || config.paused) return;

    if (evaluateRisingEdge(configId, config)) {
      log('🟢 页面加载模式触发:', config.name);
      triggerConfig(config).then(result => markEdgeResult(configId, result));
    }

    const interval = (Date.now() - startTime) < FAST_PHASE_MS ? FAST_INTERVAL : SLOW_INTERVAL;
    const timerId = setTimeout(tick, interval);
    onLoadWatchers.push(timerId);
  };

  const initialId = setTimeout(tick, initialDelay ?? 1000);
  onLoadWatchers.push(initialId);
}

function startPolling(configId, interval) {
  const period = Math.max(200, interval || 3000);
  log('🔄 启动轮询，间隔:', period);

  const timer = setInterval(() => {
    const config = getLiveConfig(configId);
    if (!config || config.paused) return;
    if (shouldTriggerConfig(config)) {
      // 轮询模式由间隔本身节流，不再叠加冷却
      triggerConfig(config, { cooldown: 0 });
    }
  }, period);

  pollingTimers.push(timer);
}

function startObserver(configId) {
  log('👀 启动持续监听');

  let debounceId = null;

  const check = () => {
    debounceId = null;
    const config = getLiveConfig(configId);
    if (!config || config.paused) return;
    if (evaluateRisingEdge(configId, config)) {
      log('⚡ 监听模式触发:', config.name);
      triggerConfig(config).then(result => markEdgeResult(configId, result));
    }
  };

  const observer = new MutationObserver(() => {
    if (debounceId) return;
    debounceId = setTimeout(check, 150);
    observerDebounceTimers.push(debounceId);
  });

  const target = document.body || document.documentElement;
  if (!target) return;

  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
    // 很多弹窗是提前渲染、靠 class/style 切换显隐的，必须监听属性变化
    attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'open', 'disabled', 'data-state', 'data-visible']
  });

  observers.push(observer);
  // 挂载后立刻检查一次，避免元素在监听启动前就已存在
  setTimeout(check, 0);
}

async function run() {
  if (isRunning) {
    rerunQueued = true;
    return;
  }
  isRunning = true;

  try {
    do {
      rerunQueued = false;

      await loadConfigs();

      cleanupPolling();
      triggerEdgeStates.clear();
      lastAttemptAt.clear();
      failureCounts.clear();

      if (!allConfigs || allConfigs.length === 0) continue;

      for (const config of allConfigs) {
        const configId = String(config.id ?? 'default');

        if (config.paused) {
          log('⏸️ 配置已暂停:', config.name);
          continue;
        }

        if ((config.triggerMode || 'auto') === 'manual') {
          log('👆 仅手动触发:', config.name);
          continue;
        }

        const autoMode = config.autoMode || 'onLoad';
        if (autoMode === 'onLoad') {
          startOnLoadWatcher(configId, config.loadDelay);
        } else if (autoMode === 'polling') {
          startPolling(configId, config.pollingInterval);
        } else if (autoMode === 'observer') {
          startObserver(configId);
        }
      }
    } while (rerunQueued);
  } finally {
    isRunning = false;
  }
}

/* ==========================================================================
 * URL 变化检测（SPA）
 * 注意：content script 在隔离世界，patch history.pushState 拦不到页面自身调用，
 * 所以用事件 + 轮询 location.href 的方式。
 * ========================================================================== */

let navigationHooked = false;
let lastUrl = location.href;

function onNavigate(source) {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  log('🔀 URL 变化(' + source + '):', lastUrl);
  triggerEdgeStates.clear();
  lastAttemptAt.clear();
  failureCounts.clear();
  run();
}

function setupNavigationHandler() {
  if (navigationHooked) return;
  navigationHooked = true;

  window.addEventListener('popstate', () => onNavigate('popstate'));
  window.addEventListener('hashchange', () => onNavigate('hashchange'));

  if (window.navigation?.addEventListener) {
    try {
      window.navigation.addEventListener('navigatesuccess', () => onNavigate('navigation-api'));
    } catch (e) { /* ignore */ }
  }

  setInterval(() => onNavigate('poll'), 500);
}

/* ==========================================================================
 * 元素拾取
 * ========================================================================== */

function startPicker() {
  if (isPickerActive) return;
  isPickerActive = true;
  document.body?.classList.add('auto-clicker-picking');
  document.addEventListener('mouseover', handleOver, true);
  document.addEventListener('mouseout', handleOut, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeydown, true);
}

function clearHighlight() {
  if (highlightedElement) {
    highlightedElement.classList.remove('auto-clicker-highlight');
    highlightedElement = null;
  }
}

function stopPicker() {
  isPickerActive = false;
  document.body?.classList.remove('auto-clicker-picking');
  document.removeEventListener('mouseover', handleOver, true);
  document.removeEventListener('mouseout', handleOut, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeydown, true);
  clearHighlight();
}

function handleOver(e) {
  if (!isPickerActive) return;
  clearHighlight();
  highlightedElement = e.target;
  highlightedElement.classList?.add('auto-clicker-highlight');
}

function handleOut() {
  if (!isPickerActive) return;
  clearHighlight();
}

function handleKeydown(e) {
  if (!isPickerActive) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    stopPicker();
  }
}

function handleClick(e) {
  if (!isPickerActive) return;
  e.preventDefault();
  e.stopPropagation();

  const target = e.target;
  target.classList?.remove('auto-clicker-highlight');
  const elementData = getElementData(target);
  log('🎯 已拾取元素:', elementData);
  chrome.storage.local.set({ pendingElementData: elementData });
  stopPicker();
}

/* ==========================================================================
 * 配置加载 & 消息
 * ========================================================================== */

function loadConfigs() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['configs'], (result) => {
        if (chrome.runtime.lastError) {
          warn('读取配置失败:', chrome.runtime.lastError.message);
          resolve(allConfigs);
          return;
        }
        allConfigs = result.configs || [];
        resolve(allConfigs);
      });
    } catch (e) {
      warn('读取配置异常:', e);
      resolve(allConfigs);
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startPicker') {
    startPicker();
  }

  if (request.action === 'test') {
    if (request.config && request.config.steps) {
      // 手动测试 / 手动运行：不走冷却、不判断触发条件
      triggerConfig({ ...request.config, id: 'manual-' + (request.config.id ?? 'draft') }, { cooldown: 0 });
    }
  }

  if (request.action === 'triggerRun') {
    log('📨 收到 triggerRun');
    tryRun();
  }

  if (request.action === 'urlChanged') {
    onNavigate('background');
  }

  sendResponse({ status: 'ok', frame: IS_TOP ? 'top' : 'iframe' });
  return true;
});

/* ==========================================================================
 * 启动
 * ========================================================================== */

let hasRun = false;

function tryRun() {
  if (hasRun) return;
  hasRun = true;
  log('🟢 启动, readyState:', document.readyState);
  setupNavigationHandler();
  run();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(tryRun, 100);
} else {
  document.addEventListener('DOMContentLoaded', () => setTimeout(tryRun, 100));
}
window.addEventListener('load', () => setTimeout(tryRun, 100));
// 极端情况下上述时机都没触发（注入过晚等），兜底启动
setTimeout(tryRun, 2000);

// 配置变化后立即重建所有监听（保证新的间隔、新的步骤马上生效）
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!changes.configs) return;
  log('♻️ 配置已更新，重建监听');
  hasRun = true;
  setupNavigationHandler();
  run();
});

log('✅ content.js 初始化完成');

}
