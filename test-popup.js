// popup.js 保存 / 校验 / 导入 / 编辑逻辑测试（jsdom）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIR = __dirname;
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) pass++;
  else { fail++; failures.push(name + (extra ? ' -> ' + extra : '')); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makePopup(initialStorage = {}) {
  const html = fs.readFileSync(path.join(DIR, 'popup.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'chrome-extension://abc/popup.html', runScripts: 'outside-only' });
  const { window } = dom;

  const storage = { lang: 'zh', configs: [], ...initialStorage };
  const sentMessages = [];
  let activeTab = { id: 1, url: 'https://example.com/page' };

  window.chrome = {
    runtime: {
      lastError: null,
      sendMessage(msg, cb) { sentMessages.push({ target: 'runtime', msg }); if (cb) cb({ ok: true }); }
    },
    tabs: {
      query(q, cb) { cb(activeTab ? [activeTab] : []); },
      sendMessage(tabId, msg, cb) { sentMessages.push({ target: 'tab', tabId, msg }); if (cb) cb({ status: 'ok' }); }
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of [].concat(keys)) out[k] = storage[k]; cb(out); },
        set(obj, cb) { Object.assign(storage, structuredClone(obj)); if (cb) cb(); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete storage[k]; if (cb) cb(); }
      },
      onChanged: { addListener() {} }
    }
  };
  window.close = () => { sentMessages.push({ target: 'close' }); };
  window.confirm = () => true;
  window.structuredClone = structuredClone;

  window.eval(fs.readFileSync(path.join(DIR, 'i18n.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(DIR, 'popup.js'), 'utf8'));
  // 注意：不要手动 dispatch DOMContentLoaded。jsdom 会在构造函数返回后异步派发一次，
  // 手动再派发会让 popup.js 初始化两遍、给每个按钮绑两个 handler（真实浏览器只会触发一次）。
  // 调用方 await sleep(...) 等 jsdom 自己派发即可。

  const $ = id => window.document.getElementById(id);
  const clickTrigger = type => window.document.querySelector(`.trigger-tab[data-trigger="${type}"]`).click();

  return {
    window, doc: window.document, storage, sentMessages, $, clickTrigger,
    setTab(t) { activeTab = t; },
    status: () => $('status').textContent,
    // 走真实 UI 路径填一个最小可用配置
    async fillBasicConfig({ name = '测试配置', site = 'example.com' } = {}) {
      $('configName').value = name;
      $('configName').dispatchEvent(new window.Event('input'));
      clickTrigger('website');
      $('websiteUrl').value = site;
      $('websiteUrl').dispatchEvent(new window.Event('input'));
      $('addStepBtn').click();
      await sleep(5);
      // 模拟拾取完成：直接把元素数据塞进草稿的步骤里
      const draft = storage.draft;
      draft.steps[0].elementData = { v: 2, tagName: 'BUTTON', textContent: '确定', attrs: { 'data-testid': 'ok' }, classes: [] };
      storage.draft = draft;
      storage.currentPickerTarget = { type: 'step', stepId: draft.steps[0].id };
      storage.pendingElementData = draft.steps[0].elementData;
      // 重开 popup 让草稿+拾取结果生效
      return draft;
    }
  };
}

// 直接构造带完整步骤的草稿，省去反复重开 popup
function draftWith(overrides = {}) {
  return {
    configName: '配置A',
    triggerType: 'website',
    websiteUrl: 'example.com',
    triggerElement: null,
    triggerText: '',
    comboTrigger: { requireWebsite: false, websiteUrl: '', requireElement: false, elementData: null, requireText: false, textContent: '' },
    triggerMode: 'auto',
    autoMode: 'onLoad',
    loadDelay: 1000,
    pollingInterval: 3000,
    steps: [{ id: 0, type: 'click', elementData: { v: 2, tagName: 'BUTTON', textContent: '确定', attrs: { 'data-testid': 'ok' }, classes: [] }, delay: 1000, count: 1, interval: 200, order: 1 }],
    stepIdCounter: 1,
    editingConfigId: null,
    ...overrides
  };
}

(async () => {

/* ---------- 1. 正常保存 ---------- */
{
  const p = makePopup({ draft: draftWith() });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('保存成功', p.storage.configs.length === 1, JSON.stringify(p.storage.configs));
  check('提示为已保存', p.status() === '配置已保存', p.status());
  const c = p.storage.configs[0];
  check('字段完整', c.name === '配置A' && c.websiteUrl === 'example.com' && c.steps.length === 1, JSON.stringify(c));
  check('保存后清除草稿', p.storage.draft === undefined);
}

/* ---------- 2. 缺元素的步骤不能保存（否则运行时必然「失效」） ---------- */
{
  const p = makePopup({ draft: draftWith({ steps: [{ id: 0, elementData: null, delay: 0, count: 1, interval: 200, order: 1 }] }) });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('步骤没选元素时拒绝保存', p.storage.configs.length === 0);
  check('给出明确提示', p.status().includes('还没选元素'), p.status());
}

/* ---------- 3. website 类型必须填网址 ---------- */
{
  const p = makePopup({ draft: draftWith({ websiteUrl: '   ' }) });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('空网址被拒绝', p.storage.configs.length === 0);
  check('提示填写网址', p.status().includes('网站地址'), p.status());
}

/* ---------- 4. combo 一个条件都不勾 -> 拒绝（旧版会在所有网站乱点） ---------- */
{
  const p = makePopup({ draft: draftWith({ triggerType: 'combo' }) });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('combo 无条件被拒绝', p.storage.configs.length === 0);
  check('提示至少勾一项', p.status().includes('至少要勾选一项'), p.status());
}

/* ---------- 5. combo 勾了文字但没填内容 -> 拒绝 ---------- */
{
  const p = makePopup({ draft: draftWith({
    triggerType: 'combo',
    comboTrigger: { requireWebsite: false, websiteUrl: '', requireElement: false, elementData: null, requireText: true, textContent: '' }
  }) });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('combo 勾文字未填内容被拒绝', p.storage.configs.length === 0);
  check('提示填写文字', p.status().includes('文字'), p.status());
}

/* ---------- 6. combo 条件完整 -> 通过 ---------- */
{
  const p = makePopup({ draft: draftWith({
    triggerType: 'combo',
    comboTrigger: { requireWebsite: true, websiteUrl: 'a.com', requireElement: false, elementData: null, requireText: true, textContent: '弹窗' }
  }) });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('combo 条件完整可保存', p.storage.configs.length === 1, p.status());
}

/* ---------- 7. 编辑保存：更新而非新增 ---------- */
{
  const existing = { id: 111, name: '老配置', triggerType: 'website', websiteUrl: 'old.com',
    triggerMode: 'auto', autoMode: 'onLoad', loadDelay: 1000, pollingInterval: 3000,
    paused: true, createdAt: 1000, updatedAt: 1000,
    steps: [{ id: 0, elementData: { v: 2, tagName: 'BUTTON', attrs: {}, classes: [] }, delay: 0, count: 1, interval: 200, order: 1 }] };
  const p = makePopup({
    configs: [existing],
    draft: draftWith({ configName: '新名字', websiteUrl: 'new.com', editingConfigId: 111 })
  });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('编辑不新增条目', p.storage.configs.length === 1, 'len=' + p.storage.configs.length);
  const c = p.storage.configs[0];
  check('内容已更新', c.name === '新名字' && c.websiteUrl === 'new.com', JSON.stringify(c));
  check('id 保持不变', c.id === 111);
  check('保留 paused 状态', c.paused === true);
  check('保留 createdAt', c.createdAt === 1000);
  check('updatedAt 已刷新', c.updatedAt > 1000);
  check('提示为已更新', p.status() === '配置已更新', p.status());
}

/* ---------- 8. 旧版核心 bug：编辑的配置已不存在时，编辑内容不能静默丢失 ---------- */
{
  const p = makePopup({
    configs: [{ id: 999, name: '别的配置', triggerType: 'website', websiteUrl: 'x.com', steps: [] }],
    draft: draftWith({ configName: '我辛苦改的配置', websiteUrl: 'mine.com', editingConfigId: 111 })
  });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('编辑目标丢失时转为新建，内容不丢', p.storage.configs.length === 2, 'len=' + p.storage.configs.length);
  const saved = p.storage.configs.find(c => c.name === '我辛苦改的配置');
  check('新建的配置内容正确', saved && saved.websiteUrl === 'mine.com', JSON.stringify(saved));
  check('未误删原有配置', p.storage.configs.some(c => c.id === 999));
}

/* ---------- 9. 字符串 id（导入的配置）也能正常编辑保存 ---------- */
{
  const p = makePopup({
    configs: [{ id: '1755000000123', name: '导入的', triggerType: 'website', websiteUrl: 'i.com',
      paused: false, createdAt: 500, steps: [{ id: 0, elementData: { v: 2, tagName: 'A', attrs: {}, classes: [] }, delay: 0, count: 1, interval: 200, order: 1 }] }],
    draft: draftWith({ configName: '改过的导入配置', editingConfigId: '1755000000123' })
  });
  await sleep(20);
  p.$('saveBtn').click();
  await sleep(20);
  check('字符串 id 配置更新成功（不新增）', p.storage.configs.length === 1, 'len=' + p.storage.configs.length);
  check('字符串 id 内容已更新', p.storage.configs[0].name === '改过的导入配置', p.storage.configs[0].name);
}

/* ---------- 10. 配置列表渲染 + 编辑/暂停/删除按钮走字符串 id ---------- */
{
  const configs = [
    { id: 1001, name: '数字ID配置', triggerType: 'website', websiteUrl: 'a.com', triggerMode: 'auto', autoMode: 'polling', paused: false, steps: [{ id: 0, elementData: {}, delay: 0, count: 1, interval: 200, order: 1 }] },
    { id: '1002xyz', name: '字符串ID配置', triggerType: 'text', triggerText: 'hi', triggerMode: 'auto', autoMode: 'observer', paused: false, steps: [{ id: 0, elementData: {}, delay: 0, count: 1, interval: 200, order: 1 }] }
  ];
  const p = makePopup({ configs });
  await sleep(20);
  p.$('listBtn').click();
  await sleep(20);

  const items = p.doc.querySelectorAll('.config-item');
  check('两个配置都渲染出来', items.length === 2, 'len=' + items.length);
  check('显示运行模式标签', p.doc.getElementById('configList').textContent.includes('轮询'),
    p.doc.getElementById('configList').textContent);

  // 暂停字符串 id 的配置
  p.doc.querySelectorAll('.toggle-config-pause')[1].click();
  await sleep(20);
  const strCfg = p.storage.configs.find(c => String(c.id) === '1002xyz');
  check('字符串 id 配置能被暂停', strCfg.paused === true, JSON.stringify(strCfg));

  // 删除数字 id 的配置
  p.doc.querySelectorAll('.delete-config')[0].click();
  await sleep(20);
  check('删除后只剩一个', p.storage.configs.length === 1, 'len=' + p.storage.configs.length);
  check('删掉的是目标配置', p.storage.configs[0].name === '字符串ID配置');
}

/* ---------- 11. 配置名含 HTML 时不破坏列表结构（XSS/渲染健壮性） ---------- */
{
  const p = makePopup({ configs: [
    { id: 1, name: '<img src=x onerror=alert(1)>坑名字', triggerType: 'website', websiteUrl: 'a.com', triggerMode: 'auto', autoMode: 'onLoad', paused: false, steps: [{ id: 0, elementData: {}, delay: 0, count: 1, interval: 200, order: 1 }] }
  ] });
  await sleep(20);
  p.$('listBtn').click();
  await sleep(20);
  check('不注入 img 标签', p.doc.querySelectorAll('#configList img').length === 0);
  check('名字按文本显示', p.doc.querySelector('.config-item-name').textContent.includes('坑名字'),
    p.doc.querySelector('.config-item-name').textContent);
  check('操作按钮仍然完整', p.doc.querySelectorAll('.config-item .config-action-btn').length === 4);
}

/* ---------- 12. 删除正在编辑的配置 -> 退出编辑态，不会「复活」 ---------- */
{
  const p = makePopup({
    configs: [{ id: 222, name: '待删除', triggerType: 'website', websiteUrl: 'a.com', triggerMode: 'auto', autoMode: 'onLoad', paused: false, steps: [{ id: 0, elementData: { v: 2, tagName: 'B', attrs: {}, classes: [] }, delay: 0, count: 1, interval: 200, order: 1 }] }],
    draft: draftWith({ editingConfigId: 222 })
  });
  await sleep(20);
  check('初始处于编辑态', !p.$('editingMode').classList.contains('hidden'));

  p.$('listBtn').click();
  await sleep(20);
  p.doc.querySelector('.delete-config').click();
  await sleep(20);
  check('配置已删除', p.storage.configs.length === 0);
  check('退出编辑态', p.$('editingMode').classList.contains('hidden'));
  check('草稿的 editingConfigId 已清空', p.storage.draft.editingConfigId === null,
    JSON.stringify(p.storage.draft.editingConfigId));

  // 此时再保存，应该是新建，而不是把删掉的配置复活成同一个 id
  p.$('saveBtn').click();
  await sleep(20);
  check('保存后是新建配置', p.storage.configs.length === 1 && p.storage.configs[0].id !== 222,
    JSON.stringify(p.storage.configs.map(c => c.id)));
}

/* ---------- 13. 步骤参数输入：非法值被钳制 ---------- */
{
  const p = makePopup({ draft: draftWith() });
  await sleep(20);
  const countInput = p.doc.querySelector('.count-input');
  countInput.value = '0';
  countInput.dispatchEvent(new p.window.Event('input'));
  await sleep(10);
  check('重复次数下限为 1', p.storage.draft.steps[0].count === 1, 'count=' + p.storage.draft.steps[0].count);

  const delayInput = p.doc.querySelector('.delay-input');
  delayInput.value = '-500';
  delayInput.dispatchEvent(new p.window.Event('input'));
  await sleep(10);
  check('延迟不为负', p.storage.draft.steps[0].delay === 0, 'delay=' + p.storage.draft.steps[0].delay);
}

/* ---------- 14. 轮询间隔下限（防止填极小值卡死页面） ---------- */
{
  const p = makePopup({ draft: draftWith({ autoMode: 'polling', pollingInterval: 5 }) });
  await sleep(20);
  p.$('pollingInterval').value = '5';
  p.$('pollingInterval').dispatchEvent(new p.window.Event('input'));
  await sleep(10);
  p.$('saveBtn').click();
  await sleep(20);
  check('轮询间隔被钳到 200ms', p.storage.configs[0].pollingInterval === 200,
    'interval=' + p.storage.configs[0].pollingInterval);
}

/* ---------- 15. 拾取元素：先确保注入再发消息 ---------- */
{
  const p = makePopup({ draft: draftWith() });
  await sleep(20);
  p.doc.querySelector('.pick-element').click();
  await sleep(20);

  const ensure = p.sentMessages.find(m => m.target === 'runtime' && m.msg.action === 'ensureInjected');
  const picker = p.sentMessages.find(m => m.target === 'tab' && m.msg.action === 'startPicker');
  check('先发 ensureInjected', !!ensure, JSON.stringify(p.sentMessages));
  check('再发 startPicker', !!picker);
  check('ensureInjected 在 startPicker 之前',
    p.sentMessages.indexOf(ensure) < p.sentMessages.indexOf(picker));
  check('记录了拾取目标', p.storage.currentPickerTarget?.type === 'step',
    JSON.stringify(p.storage.currentPickerTarget));
  check('拾取前保存了草稿', !!p.storage.draft);
}

/* ---------- 16. 拾取结果回填到对应步骤 ---------- */
{
  const picked = { v: 2, tagName: 'BUTTON', textContent: '关闭', attrs: { 'aria-label': '关闭' }, classes: ['modal-close'] };
  const p = makePopup({
    draft: draftWith({ steps: [{ id: 3, elementData: null, delay: 0, count: 1, interval: 200, order: 1 }], stepIdCounter: 4 }),
    currentPickerTarget: { type: 'step', stepId: 3 },
    pendingElementData: picked
  });
  await sleep(30);
  check('元素回填到步骤', p.storage.draft.steps[0].elementData?.attrs['aria-label'] === '关闭',
    JSON.stringify(p.storage.draft.steps[0].elementData));
  check('清理了 pending 数据', p.storage.pendingElementData === undefined && p.storage.currentPickerTarget === undefined);
  check('预览显示 aria-label（无文字元素也看得出选了什么）',
    p.doc.querySelector('#stepsContainer .element-preview').textContent.includes('关闭'),
    p.doc.querySelector('#stepsContainer .element-preview').textContent);
}

/* ---------- 17. 拾取时目标步骤已被删除 -> 提示而非静默丢弃 ---------- */
{
  const p = makePopup({
    draft: draftWith({ steps: [{ id: 5, elementData: null, delay: 0, count: 1, interval: 200, order: 1 }], stepIdCounter: 6 }),
    currentPickerTarget: { type: 'step', stepId: 99 },
    pendingElementData: { v: 2, tagName: 'BUTTON', attrs: {}, classes: [] }
  });
  await sleep(30);
  check('目标步骤丢失时给出提示', p.status().includes('步骤已被删除'), p.status());
}

/* ---------- 18. 非 http 页面（chrome:// 等）给出明确提示，不静默失败 ---------- */
{
  const p = makePopup({ draft: draftWith() });
  await sleep(20);
  p.setTab({ id: 2, url: 'chrome://extensions' });
  p.$('testBtn').click();
  await sleep(20);
  check('chrome:// 页面提示先打开网页', p.status().includes('请先打开一个网页'), p.status());
  check('未向该页面发消息', !p.sentMessages.some(m => m.target === 'tab' && m.msg.action === 'test'));
}

/* ---------- 19. 测试草稿：缺元素时不发消息 ---------- */
{
  const p = makePopup({ draft: draftWith({ steps: [{ id: 0, elementData: null, delay: 0, count: 1, interval: 200, order: 1 }] }) });
  await sleep(20);
  p.$('testBtn').click();
  await sleep(20);
  check('缺元素时测试被拦截', p.status().includes('还没选元素'), p.status());
  check('未发送 test 消息', !p.sentMessages.some(m => m.target === 'tab' && m.msg.action === 'test'));
}

/* ---------- 20. 导入：规整字段、id 不冲突、非法项被过滤 ---------- */
{
  const p = makePopup({ configs: [{ id: 5000, name: '已有', steps: [] }] });
  await sleep(20);

  const imported = [
    { name: '合法配置', triggerType: 'website', websiteUrl: 'ok.com',
      steps: [{ elementData: { v: 2, tagName: 'BUTTON', attrs: {}, classes: [] }, delay: '800', count: '3', interval: 'abc' }] },
    { name: '脏字段配置', triggerType: 'bogus', autoMode: 'bogus', pollingInterval: 1, loadDelay: -5,
      steps: [{ elementData: { v: 2, tagName: 'A', attrs: {}, classes: [] } }] },
    { name: '没有步骤的配置', steps: [] },
    { name: '步骤不是数组', steps: 'nope' },
    null
  ];

  // 走真实导入路径：FileReader + 配置选择弹窗
  const file = new p.window.File([JSON.stringify(imported)], 'c.json', { type: 'application/json' });
  Object.defineProperty(p.$('importFile'), 'files', { value: [file], configurable: true });
  p.$('importFile').dispatchEvent(new p.window.Event('change'));
  await sleep(60);

  const pickerItems = p.doc.querySelectorAll('#pickerList .picker-item');
  check('只有 2 个合法配置进入选择列表', pickerItems.length === 2, 'len=' + pickerItems.length);

  p.$('pickerConfirmBtn').click();
  await sleep(40);

  check('导入后共 3 个配置', p.storage.configs.length === 3, 'len=' + p.storage.configs.length);
  const ids = p.storage.configs.map(c => String(c.id));
  check('id 无重复', new Set(ids).size === ids.length, JSON.stringify(ids));
  check('未覆盖已有配置', p.storage.configs.some(c => c.id === 5000));

  const legal = p.storage.configs.find(c => c.name === '合法配置');
  check('字符串数字被转为数字', legal.steps[0].delay === 800 && legal.steps[0].count === 3,
    JSON.stringify(legal.steps[0]));
  check('非法 interval 回落默认值', legal.steps[0].interval === 200, 'interval=' + legal.steps[0].interval);
  check('步骤 order 重排', legal.steps[0].order === 1);

  const dirty = p.storage.configs.find(c => c.name === '脏字段配置');
  check('非法 triggerType 回落 website', dirty.triggerType === 'website', dirty.triggerType);
  check('非法 autoMode 回落 onLoad', dirty.autoMode === 'onLoad', dirty.autoMode);
  check('过小 pollingInterval 被钳制', dirty.pollingInterval === 200, 'v=' + dirty.pollingInterval);
  // 负值钳到 0（0 是合法选择：加载后立刻触发）；只有字段缺失才回落默认 1000
  check('负 loadDelay 被钳到 0', dirty.loadDelay === 0, 'v=' + dirty.loadDelay);
  check('补齐 comboTrigger 结构', !!dirty.comboTrigger && dirty.comboTrigger.requireWebsite === false);
}

/* ---------- 21. 导入非数组 JSON -> 明确报错 ---------- */
{
  const p = makePopup();
  await sleep(20);
  const file = new p.window.File([JSON.stringify({ not: 'an array' })], 'c.json', { type: 'application/json' });
  Object.defineProperty(p.$('importFile'), 'files', { value: [file], configurable: true });
  p.$('importFile').dispatchEvent(new p.window.Event('change'));
  await sleep(60);
  check('非数组 JSON 报格式错误', p.status().includes('无效') || p.status().includes('导入失败'), p.status());
  check('未写入任何配置', (p.storage.configs || []).length === 0);
}

/* ---------- 22. 加载已有配置进入编辑态，字段正确回填 ---------- */
{
  const cfg = { id: 333, name: '待编辑', triggerType: 'text', triggerText: '优惠券',
    websiteUrl: '', triggerElement: null, triggerMode: 'auto', autoMode: 'polling',
    loadDelay: 2000, pollingInterval: 1500, paused: false, createdAt: 1, updatedAt: 1,
    steps: [{ id: 7, elementData: { v: 2, tagName: 'BUTTON', textContent: '领取', attrs: {}, classes: [] }, delay: 500, count: 2, interval: 300, order: 1 }] };
  const p = makePopup({ configs: [cfg] });
  await sleep(20);
  p.$('listBtn').click();
  await sleep(20);
  p.doc.querySelector('.edit-config').click();
  await sleep(20);

  check('名称回填', p.$('configName').value === '待编辑', p.$('configName').value);
  check('触发文字回填', p.$('triggerTextContent').value === '优惠券');
  check('轮询间隔回填', p.$('pollingInterval').value === '1500', p.$('pollingInterval').value);
  check('autoMode 选中 polling', p.doc.querySelector('input[name="autoMode"]:checked').value === 'polling');
  check('进入编辑态', !p.$('editingMode').classList.contains('hidden'));
  check('编辑态显示配置名', p.$('editingConfigName').textContent === '待编辑', p.$('editingConfigName').textContent);
  check('步骤参数回填', p.doc.querySelector('.count-input').value === '2', p.doc.querySelector('.count-input').value);
  check('stepIdCounter 大于已有步骤 id', p.storage.draft.stepIdCounter > 7, 'v=' + p.storage.draft.stepIdCounter);

  // 编辑不应影响原配置，直到点保存
  check('尚未修改 storage 中的配置', p.storage.configs[0].name === '待编辑');
}

/* ---------- 23. 编辑时修改步骤不污染已保存的配置（引用隔离） ---------- */
{
  const cfg = { id: 444, name: 'iso', triggerType: 'website', websiteUrl: 'a.com',
    triggerMode: 'auto', autoMode: 'onLoad', loadDelay: 1000, pollingInterval: 3000,
    paused: false, createdAt: 1, updatedAt: 1,
    steps: [{ id: 0, elementData: { v: 2, tagName: 'BUTTON', attrs: {}, classes: [] }, delay: 100, count: 1, interval: 200, order: 1 }] };
  const p = makePopup({ configs: [cfg] });
  await sleep(20);
  p.$('listBtn').click();
  await sleep(20);
  p.doc.querySelector('.edit-config').click();
  await sleep(20);

  const countInput = p.doc.querySelector('.count-input');
  countInput.value = '9';
  countInput.dispatchEvent(new p.window.Event('input'));
  await sleep(20);

  check('草稿里的步骤已改', p.storage.draft.steps[0].count === 9, 'v=' + p.storage.draft.steps[0].count);
  check('未保存前 storage 配置不受影响', p.storage.configs[0].steps[0].count === 1,
    'v=' + p.storage.configs[0].steps[0].count);

  p.$('saveBtn').click();
  await sleep(20);
  check('保存后才写入', p.storage.configs[0].steps[0].count === 9, 'v=' + p.storage.configs[0].steps[0].count);
}

/* ---------- 24. 清除草稿 ---------- */
{
  const p = makePopup({ draft: draftWith({ editingConfigId: 555 }) });
  await sleep(20);
  p.$('clearBtn').click();
  await sleep(20);
  check('草稿被清除', p.storage.draft === undefined);
  check('输入框清空', p.$('configName').value === '');
  check('退出编辑态', p.$('editingMode').classList.contains('hidden'));
  check('回到默认触发方式', p.doc.querySelector('.trigger-tab.active').dataset.trigger === 'website');
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
