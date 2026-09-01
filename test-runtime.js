// 第二组测试：注入保护、配置热更新、iframe URL、popup 保存逻辑
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const EXPORT_LINE = `
window.__acTest = {
  getElementData, findMatchingElement, checkWebsiteMatch, getLiveConfig,
  triggerConfig, run, loadConfigs, isVisible, elementText,
  getConfigFallbackText, executeSteps, resolveClickTarget
};
window.__acState = { get allConfigs() { return allConfigs; }, get pollingTimers() { return pollingTimers; } };
`;
const lastBrace = SRC.lastIndexOf('}');
const INSTRUMENTED = SRC.slice(0, lastBrace) + EXPORT_LINE + SRC.slice(lastBrace);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? ' -> ' + extra : '')); }
}

function makeEnv(html, url = 'https://example.com/page', initialConfigs = []) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  const storage = { configs: initialConfigs };
  const changeListeners = [];
  const msgListeners = [];

  window.chrome = {
    runtime: {
      onMessage: { addListener(fn) { msgListeners.push(fn); } },
      lastError: null,
      sendMessage() {}
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of [].concat(keys)) out[k] = storage[k]; cb(out); },
        set(obj, cb) {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) changes[k] = { oldValue: storage[k], newValue: v };
          Object.assign(storage, obj);
          if (cb) cb();
          changeListeners.forEach(fn => fn(changes, 'local'));
        },
        remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; if (cb) cb(); }
      },
      onChanged: { addListener(fn) { changeListeners.push(fn); } }
    }
  };
  window.eval(INSTRUMENTED);
  return { window, doc: window.document, api: window.__acTest, state: window.__acState, storage, msgListeners };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {

/* ---------- 1. 重复注入保护（content_scripts + chrome.scripting 同时注入） ---------- */
{
  const env = makeEnv('<body><div>hi</div></body>');
  const before = env.window.__autoClickerProLoaded;
  let logs = [];
  const origLog = env.window.console.log;
  env.window.console.log = (...a) => logs.push(a.join(' '));
  env.window.eval(INSTRUMENTED); // 模拟第二次注入
  env.window.console.log = origLog;

  check('首次注入设置了标记', before === true);
  check('二次注入被跳过', logs.some(l => l.includes('跳过重复注入')), JSON.stringify(logs));
}

/* ---------- 2 & 3. iframe 行为：用真实嵌套 iframe 验证 ---------- */
function makeFrameEnv(frameHtml, { width, height, topUrl, frameUrl }) {
  const parent = new JSDOM(
    `<body><iframe src="${frameUrl}"></iframe></body>`,
    { url: topUrl, resources: 'usable', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const iframe = parent.window.document.querySelector('iframe');
  const win = iframe.contentWindow;
  win.document.open();
  win.document.write(frameHtml);
  win.document.close();

  Object.defineProperty(win, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(win, 'innerHeight', { value: height, configurable: true });

  win.chrome = {
    runtime: { onMessage: { addListener() {} }, lastError: null, sendMessage() {} },
    storage: {
      local: { get(k, cb) { cb({ configs: [] }); }, set(o, cb) { if (cb) cb(); }, remove(k, cb) { if (cb) cb(); } },
      onChanged: { addListener() {} }
    }
  };
  return { parent, win };
}

{
  // 1x1 像素埋点 iframe：不应初始化
  const { win } = makeFrameEnv('<body><button>x</button></body>', {
    width: 1, height: 1, topUrl: 'https://host.com/', frameUrl: 'about:blank'
  });
  check('iframe 环境搭建正确（top 不是自身）', win.top !== win, 'top===self');
  win.eval(SRC);
  check('1x1 像素 iframe 不初始化', win.__acTest === undefined && win.__autoClickerProLoaded === true);
}

{
  // 正常尺寸 iframe：应初始化，且能用顶层页面 URL 匹配网站条件
  const { win } = makeFrameEnv('<body><button data-testid="close">x</button></body>', {
    width: 400, height: 300, topUrl: 'https://shop.taobao.com/detail?id=5', frameUrl: 'about:blank'
  });
  win.eval(INSTRUMENTED);
  const api = win.__acTest;
  check('正常尺寸 iframe 会初始化', !!api);
  if (api) {
    check('iframe 内用顶层 URL 匹配网站条件', api.checkWebsiteMatch('shop.taobao.com'));
    check('iframe 内不匹配无关域名', !api.checkWebsiteMatch('jd.com'));
    // iframe 里也要能真正找到并点到元素
    const recorded = api.getElementData(win.document.querySelector('button'));
    check('iframe 内能匹配到元素', api.findMatchingElement(recorded) === win.document.querySelector('button'));
  }
}

/* ---------- 4. 配置热更新：轮询间隔改了要立刻生效（旧版闭包捕获旧值） ---------- */
{
  const env = makeEnv(
    '<body><button data-testid="go">go</button></body>',
    'https://example.com/page',
    [{ id: 7, name: 'p', triggerType: 'website', websiteUrl: 'example.com',
       triggerMode: 'auto', autoMode: 'polling', pollingInterval: 5000,
       steps: [{ id: 0, elementData: { v: 2, tagName: 'BUTTON', attrs: { 'data-testid': 'go' }, classes: [] }, delay: 0, count: 1 }] }]
  );
  await env.api.run();
  await sleep(20);
  check('轮询定时器已建立', env.state.pollingTimers.length === 1, 'timers=' + env.state.pollingTimers.length);
  check('内存里是旧间隔', env.state.allConfigs[0].pollingInterval === 5000);

  // 模拟 popup 保存新配置
  env.window.chrome.storage.local.set({
    configs: [{ ...env.storage.configs[0], pollingInterval: 300, name: 'p-new' }]
  });
  await sleep(60);
  check('storage 变化后配置已刷新', env.state.allConfigs[0].pollingInterval === 300,
    'got=' + env.state.allConfigs[0].pollingInterval);
  check('新配置名生效', env.state.allConfigs[0].name === 'p-new');
  check('旧定时器被清理，只留一个', env.state.pollingTimers.length === 1, 'timers=' + env.state.pollingTimers.length);

  // 运行中的 watcher 通过 getLiveConfig 拿最新配置，而不是闭包里的旧对象
  const live = env.api.getLiveConfig('7');
  check('getLiveConfig 返回最新配置', live && live.pollingInterval === 300);
  check('getLiveConfig 兼容字符串/数字 id', env.api.getLiveConfig(7) === live);
}

/* ---------- 5. 暂停的配置在运行中被暂停后不再执行 ---------- */
{
  // 轮询间隔有 200ms 下限（防止用户填极小值卡死页面），测试节奏按此设定
  const env = makeEnv(
    '<body><button data-testid="go">go</button>弹窗文字</body>',
    'https://example.com/p',
    [{ id: 8, name: 'x', triggerType: 'text', triggerText: '弹窗文字',
       triggerMode: 'auto', autoMode: 'polling', pollingInterval: 200,
       steps: [{ id: 0, elementData: { v: 2, tagName: 'BUTTON', attrs: { 'data-testid': 'go' }, classes: [] }, delay: 0, count: 1 }] }]
  );
  let clicks = 0;
  env.doc.querySelector('button').addEventListener('click', () => clicks++);

  await env.api.run();
  await sleep(700);
  const during = clicks;
  check('轮询期间有重复点击', during >= 2, 'clicks=' + during);

  env.state.allConfigs[0].paused = true;
  const atPause = clicks;
  await sleep(700);
  check('暂停后停止点击', clicks === atPause, `atPause=${atPause} now=${clicks}`);
}

/* ---------- 6. 手动模式的配置不会自动跑 ---------- */
{
  const env = makeEnv(
    '<body><button data-testid="go">go</button></body>',
    'https://example.com/p',
    [{ id: 9, name: 'manual', triggerType: 'website', websiteUrl: 'example.com',
       triggerMode: 'manual', autoMode: 'polling', pollingInterval: 200,
       steps: [{ id: 0, elementData: { v: 2, tagName: 'BUTTON', attrs: { 'data-testid': 'go' }, classes: [] }, delay: 0, count: 1 }] }]
  );
  let clicks = 0;
  env.doc.querySelector('button').addEventListener('click', () => clicks++);
  await env.api.run();
  await sleep(600);
  check('manual 模式不自动点击', clicks === 0, 'clicks=' + clicks);
  check('manual 模式不建定时器', env.state.pollingTimers.length === 0);

  // 但手动运行消息应该点
  env.msgListeners.forEach(fn => fn(
    { action: 'test', config: env.state.allConfigs[0] }, {}, () => {}
  ));
  await sleep(60);
  check('手动运行消息能点击', clicks === 1, 'clicks=' + clicks);
}

/* ---------- 7. 点击目标提升：点到内部 span 时应点可交互父元素 ---------- */
{
  const env = makeEnv('<body><button id="btn"><span id="label">确定</span></button></body>');
  const span = env.doc.getElementById('label');
  check('内部 span 提升为 button', env.api.resolveClickTarget(span) === env.doc.getElementById('btn'));

  let btnClicks = 0;
  env.doc.getElementById('btn').addEventListener('click', () => btnClicks++);
  const recorded = env.api.getElementData(span);
  const result = await env.api.executeSteps({ name: 's', steps: [{ id: 0, elementData: recorded, delay: 0, count: 1 }] });
  check('点击 span 只触发一次 button click', btnClicks === 1, 'clicks=' + btnClicks);
  check('执行结果记为成功', result.clicked === 1 && result.missed === 0, JSON.stringify(result));
}

/* ---------- 8. 兜底文字来源：只在 text/combo-text 配置下启用 ---------- */
{
  const env = makeEnv('<body></body>');
  check('text 配置提供兜底文字',
    env.api.getConfigFallbackText({ triggerType: 'text', triggerText: '弹窗' }) === '弹窗');
  check('combo 勾了文字提供兜底',
    env.api.getConfigFallbackText({ triggerType: 'combo', comboTrigger: { requireText: true, textContent: 'abc' } }) === 'abc');
  check('combo 未勾文字不提供兜底',
    env.api.getConfigFallbackText({ triggerType: 'combo', comboTrigger: { requireText: false, textContent: 'abc' } }) === '');
  check('website 配置不提供兜底',
    env.api.getConfigFallbackText({ triggerType: 'website', websiteUrl: 'a.com' }) === '');
}

/* ---------- 9. 匹配失败时指数退避，不高频重试 ---------- */
{
  const env = makeEnv('<body><div>空</div></body>');
  const ghost = { v: 2, tagName: 'BUTTON', textContent: '不存在', attrs: { 'data-testid': 'nope' }, classes: [] };
  const config = { id: 'bo', name: 'backoff', steps: [{ id: 0, elementData: ghost, delay: 0, count: 1 }] };

  const r1 = await env.api.triggerConfig(config, { cooldown: 30 });
  check('首次尝试执行了（并失败）', r1 && r1.clicked === 0, JSON.stringify(r1));

  await sleep(40);
  const r2 = await env.api.triggerConfig(config, { cooldown: 30 });
  check('失败1次后冷却被放大（30ms 后仍被拦）', r2 === null, JSON.stringify(r2));

  await sleep(40);
  const r3 = await env.api.triggerConfig(config, { cooldown: 30 });
  check('等够退避时间后可重试', r3 !== null, JSON.stringify(r3));
}

/* ---------- 10. 隐藏元素判定（真实浏览器语义） ---------- */
{
  const env = makeEnv(`
    <body>
      <div id="wrap" style="display:none"><button id="inner">x</button></div>
      <div id="ok"><button id="shown">y</button></div>
      <button id="ariaHidden" aria-hidden="true">z</button>
      <button id="hiddenAttr" hidden>w</button>
    </body>
  `);
  check('display:none 容器内的按钮不可见', !env.api.isVisible(env.doc.getElementById('inner')));
  check('正常按钮可见', env.api.isVisible(env.doc.getElementById('shown')));
  check('aria-hidden 按钮不可见', !env.api.isVisible(env.doc.getElementById('ariaHidden')));
  check('hidden 属性按钮不可见', !env.api.isVisible(env.doc.getElementById('hiddenAttr')));
  check('已脱离文档的元素不可见', !env.api.isVisible(env.doc.createElement('button')));
}

console.log('\n' + '='.repeat(50));
console.log(`通过 ${pass}，失败 ${fail}`);
if (failures.length) {
  console.log('\n失败项:');
  failures.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('全部通过 ✅');
process.exit(0);
})();
