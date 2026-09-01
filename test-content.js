// content.js 匹配/触发逻辑测试（jsdom）
// 通过字符串注入把内部函数暴露给测试，不改动生产代码
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const EXPORT_LINE = `
window.__acTest = {
  getElementData, findMatchingElement, checkWebsiteMatch, checkTextMatch,
  checkComboTrigger, shouldTriggerConfig, evaluateRisingEdge, markEdgeResult,
  triggerEdgeStates, findCloseButtonNearText, isVisible, executeSteps,
  triggerConfig, normalizeText, stableClasses, isStableIdValue, buildCssPath
};
`;
// 文件最后一个 } 是 autoClickerProMain 的收尾
const lastBrace = SRC.lastIndexOf('}');
const INSTRUMENTED = SRC.slice(0, lastBrace) + EXPORT_LINE + SRC.slice(lastBrace);

let pass = 0, fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (extra ? ' -> ' + extra : '')); }
}

function makeEnv(html, url = 'https://example.com/page') {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;

  const storage = { configs: [] };
  window.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      lastError: null,
      sendMessage() {}
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of [].concat(keys)) out[k] = storage[k]; cb(out); },
        set(obj, cb) { Object.assign(storage, obj); if (cb) cb(); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; if (cb) cb(); }
      },
      onChanged: { addListener() {} }
    }
  };
  window.eval(INSTRUMENTED);
  return { window, doc: window.document, api: window.__acTest, storage };
}

/* ---------- 1. 稳定 id 与生成式 id 的区分 ---------- */
{
  const { api } = makeEnv('<body></body>');
  check('稳定 id 被接受', api.isStableIdValue('submit-button'));
  check('React 生成 id 被拒绝', !api.isStableIdValue(':r3:'));
  check('长 hash id 被拒绝', !api.isStableIdValue('modal-a3f9e21c8b7d'));
  check('rc- 前缀被拒绝', !api.isStableIdValue('rc_select_1'));
  check('纯数字后缀被拒绝', !api.isStableIdValue('dialog-1234567'));
}

/* ---------- 2. 采集特征：CSS Modules class 应被过滤 ---------- */
{
  const { doc, api } = makeEnv(`
    <body><div class="Modal_wrapper__a1b2c css-1x2y3z modal-close is-active">x</div></body>
  `);
  const el = doc.querySelector('div');
  const classes = api.stableClasses(el);
  check('过滤 CSS Modules class', !classes.includes('Modal_wrapper__a1b2c'), JSON.stringify(classes));
  check('过滤 emotion class', !classes.includes('css-1x2y3z'), JSON.stringify(classes));
  check('过滤状态 class', !classes.includes('is-active'), JSON.stringify(classes));
  check('保留语义 class', classes.includes('modal-close'), JSON.stringify(classes));
}

/* ---------- 3. 核心场景：id 变了、层级位移了，仍能匹配（旧版失效的场景） ---------- */
{
  // 录制时的页面
  const rec = makeEnv(`
    <body>
      <div id="app">
        <div class="banner">promo</div>
        <div class="modal" id="modal-a3f9e21c8b7d">
          <div class="modal-title">限时活动</div>
          <button class="modal-close" aria-label="关闭"></button>
        </div>
      </div>
    </body>
  `);
  const recorded = rec.api.getElementData(rec.doc.querySelector('.modal-close'));
  check('采集到 aria-label', recorded.attrs['aria-label'] === '关闭', JSON.stringify(recorded.attrs));
  check('不采集生成式 id', recorded.stableId === null, String(recorded.stableId));

  // 重新加载后：id 变了、上面多了两个兄弟节点（绝对 XPath 一定失效）
  const now = makeEnv(`
    <body>
      <div id="app">
        <div class="toast">hi</div>
        <div class="notice">notice</div>
        <div class="banner">promo</div>
        <div class="modal" id="modal-99ff11aa22bb">
          <div class="modal-title">限时活动</div>
          <button class="modal-close" aria-label="关闭"></button>
        </div>
      </div>
    </body>
  `);
  const oldXPath = now.window.document.evaluate(
    recorded.xpath, now.doc, null, now.window.XPathResult.FIRST_ORDERED_NODE_TYPE, null
  ).singleNodeValue;
  const found = now.api.findMatchingElement(recorded);
  check('旧绝对 XPath 确实已失配（前提成立）', oldXPath !== now.doc.querySelector('.modal-close'));
  check('id变+层级位移后仍匹配到关闭按钮', found === now.doc.querySelector('.modal-close'),
    found ? found.outerHTML : 'null');
}

/* ---------- 4. 无文字图标按钮（旧版直接 return null 的场景） ---------- */
{
  const rec = makeEnv(`
    <body><div class="dlg"><button data-testid="close-btn"><svg></svg></button></div></body>
  `);
  const recorded = rec.api.getElementData(rec.doc.querySelector('button'));
  check('无文字元素也采到 data-testid', recorded.attrs['data-testid'] === 'close-btn');

  const now = makeEnv(`
    <body>
      <div class="other"><button>取消</button></div>
      <div class="dlg2"><span></span><button data-testid="close-btn"><svg></svg></button></div>
    </body>
  `);
  const found = now.api.findMatchingElement(recorded);
  check('无文字图标按钮靠 testid 匹配成功', found === now.doc.querySelector('[data-testid="close-btn"]'),
    found ? found.outerHTML : 'null');
}

/* ---------- 5. 不能乱点：目标真的不存在时必须返回 null ---------- */
{
  const rec = makeEnv('<body><button data-testid="pay-now">立即支付</button></body>');
  const recorded = rec.api.getElementData(rec.doc.querySelector('button'));

  const now = makeEnv('<body><button class="unrelated">订阅</button><button>返回</button></body>');
  const found = now.api.findMatchingElement(recorded);
  check('目标不存在时不误点其它按钮', found === null, found ? found.outerHTML : 'null');
}

/* ---------- 6. 可见性优先：隐藏的同名元素不应被选中 ---------- */
{
  const rec = makeEnv('<body><button data-action="confirm">确定</button></body>');
  const recorded = rec.api.getElementData(rec.doc.querySelector('button'));

  const now = makeEnv(`
    <body>
      <button data-action="confirm" id="hidden-one" style="display:none">确定</button>
      <button data-action="confirm" id="visible-one">确定</button>
    </body>
  `);
  const found = now.api.findMatchingElement(recorded);
  check('优先选可见元素', found && found.id === 'visible-one', found ? found.id : 'null');
}

/* ---------- 7. 网站匹配：带 query 的配置、通配符、协议/www 差异 ---------- */
{
  const { api } = makeEnv('<body></body>', 'https://www.taobao.com/item?id=99&from=home#top');
  check('裸域名匹配', api.checkWebsiteMatch('taobao.com'));
  check('带 www 配置匹配', api.checkWebsiteMatch('www.taobao.com'));
  check('带协议配置匹配', api.checkWebsiteMatch('https://taobao.com'));
  check('配置存了旧 query 也能匹配', api.checkWebsiteMatch('taobao.com/item?id=1&from=search'));
  check('通配符匹配', api.checkWebsiteMatch('taobao.com/item*'));
  check('不相关域名不匹配', !api.checkWebsiteMatch('jd.com'));
  check('空配置视为匹配', api.checkWebsiteMatch(''));
}

/* ---------- 8. combo 不勾条件时不得视为满足（旧版会到处乱点） ---------- */
{
  const { api } = makeEnv('<body>hello</body>');
  check('combo 全不勾 = 不触发', !api.checkComboTrigger({
    requireWebsite: false, requireElement: false, requireText: false
  }));
  check('combo 勾了文字且命中 = 触发', api.checkComboTrigger({
    requireText: true, textContent: 'hello'
  }));
  check('combo 勾了文字未命中 = 不触发', !api.checkComboTrigger({
    requireText: true, textContent: '不存在的文字'
  }));
  check('未知 triggerType 不触发', !api.shouldTriggerConfig({ triggerType: 'bogus' }));
}

/* ---------- 9. 上升沿：匹配失败不应把配置永久锁死（旧版的核心 bug） ---------- */
{
  const { api } = makeEnv('<body><div>弹窗出现了</div></body>');
  const config = { id: 'c1', triggerType: 'text', triggerText: '弹窗出现了' };

  check('首次条件满足 -> 允许触发', api.evaluateRisingEdge('c1', config));
  // 模拟：条件满足但没点到（clicked=0）
  api.markEdgeResult('c1', { clicked: 0, missed: 1 });
  check('点击失败后仍可重试（不被锁死）', api.evaluateRisingEdge('c1', config));
  // 这次点到了
  api.markEdgeResult('c1', { clicked: 1, missed: 0 });
  check('点击成功后不再重复触发', !api.evaluateRisingEdge('c1', config));
}

/* ---------- 10. 上升沿：条件消失再出现应能再次触发 ---------- */
{
  const env = makeEnv('<body><div id="popup">弹窗A</div></body>');
  const config = { id: 'c2', triggerType: 'text', triggerText: '弹窗A' };

  check('弹窗出现 -> 触发', env.api.evaluateRisingEdge('c2', config));
  env.api.markEdgeResult('c2', { clicked: 1, missed: 0 });
  check('弹窗还在 -> 不重复', !env.api.evaluateRisingEdge('c2', config));

  env.doc.getElementById('popup').remove();
  check('弹窗消失 -> 不触发', !env.api.evaluateRisingEdge('c2', config));

  const again = env.doc.createElement('div');
  again.textContent = '弹窗A';
  env.doc.body.appendChild(again);
  check('弹窗二次出现 -> 再次触发', env.api.evaluateRisingEdge('c2', config));
}

/* ---------- 11. 弹窗上下文兜底找关闭按钮 ---------- */
{
  const { doc, api } = makeEnv(`
    <body>
      <div class="page">很长的页面正文内容，这里有很多字。</div>
      <div class="overlay">
        <div class="dialog">
          <p>确认要退出吗？</p>
          <button aria-label="close"></button>
          <button>确认</button>
        </div>
      </div>
    </body>
  `);
  const btn = api.findCloseButtonNearText('确认要退出吗？');
  check('弹窗兜底找到 aria-label=close 的按钮', btn === doc.querySelector('[aria-label="close"]'),
    btn ? btn.outerHTML : 'null');
  check('文字不存在时兜底返回 null', api.findCloseButtonNearText('页面上没有这句话') === null);
}

/* ---------- 12. executeSteps：找不到元素时如实上报 missed ---------- */
(async () => {
  {
    const { doc, api } = makeEnv('<body><button data-testid="go">开始</button></body>');
    const recorded = api.getElementData(doc.querySelector('button'));
    let clicks = 0;
    doc.querySelector('button').addEventListener('click', () => clicks++);

    const result = await api.executeSteps({
      name: 'ok', steps: [{ id: 0, elementData: recorded, delay: 0, count: 2, interval: 0 }]
    });
    check('重复点击次数正确', clicks === 2, 'clicks=' + clicks);
    check('全部命中时 missed=0', result.missed === 0 && result.clicked === 2, JSON.stringify(result));
  }
  {
    const { api } = makeEnv('<body><div>空页面</div></body>');
    const ghost = { v: 2, tagName: 'BUTTON', textContent: '不存在', attrs: { 'data-testid': 'nope' }, classes: [] };
    const result = await api.executeSteps({
      name: 'miss', steps: [{ id: 0, elementData: ghost, delay: 0, count: 1 }]
    });
    check('找不到元素时 clicked=0 且 missed=1', result.clicked === 0 && result.missed === 1, JSON.stringify(result));
  }

  /* ---------- 13. triggerConfig：并发去重 + 冷却 ---------- */
  {
    const { doc, api } = makeEnv('<body><button data-testid="t">点我</button></body>');
    const recorded = api.getElementData(doc.querySelector('button'));
    let clicks = 0;
    doc.querySelector('button').addEventListener('click', () => clicks++);
    const config = { id: 'cd1', name: 'cd', steps: [{ id: 0, elementData: recorded, delay: 5, count: 1 }] };

    const [r1, r2] = await Promise.all([api.triggerConfig(config), api.triggerConfig(config)]);
    check('并发触发只执行一次', clicks === 1, 'clicks=' + clicks);
    check('被锁的那次返回 null', (r1 === null) !== (r2 === null), JSON.stringify([r1, r2]));

    const r3 = await api.triggerConfig(config);
    check('冷却期内被拦截', r3 === null && clicks === 1, 'clicks=' + clicks);

    const r4 = await api.triggerConfig(config, { cooldown: 0 });
    check('手动运行(cooldown=0)不受冷却限制', r4 !== null && clicks === 2, 'clicks=' + clicks);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`通过 ${pass}，失败 ${fail}`);
  if (failures.length) {
    console.log('\n失败项:');
    failures.forEach(f => console.log('  ✗ ' + f));
    process.exit(1);
  }
  console.log('全部通过 ✅');
  // setupNavigationHandler 的 setInterval 会挂住事件循环，显式退出
  process.exit(0);
})();
