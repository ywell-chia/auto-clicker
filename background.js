console.log('Background script loaded');

const INJECTABLE_URL_RE = /^https?:\/\//i;

function isInjectable(url) {
  return !!url && INJECTABLE_URL_RE.test(url);
}

// 向标签页所有 frame 注入 content script（幂等，content.js 自带重复注入保护）
async function ensureInjected(tabId, url) {
  if (!isInjectable(url)) return false;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ['content.css']
    });
  } catch (e) { /* 部分 frame 可能注入失败，忽略 */ }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js']
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function notifyTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch (e) {
    return false;
  }
}

// 扩展安装 / 更新 / 浏览器启动时，给所有已打开的标签页补注入
// （否则重载扩展后必须手动刷新页面才生效）
async function injectAllTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !isInjectable(tab.url)) continue;
      await ensureInjected(tab.id, tab.url);
      await notifyTab(tab.id, { action: 'triggerRun' });
    }
  } catch (e) {
    console.warn('批量注入失败:', e);
  }
}

chrome.runtime.onInstalled.addListener(injectAllTabs);
chrome.runtime.onStartup.addListener(injectAllTabs);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'elementPicked') {
    chrome.storage.local.set({ pendingElementData: request });
  }

  // popup 请求确保当前标签页已注入后再发消息
  if (request.action === 'ensureInjected' && request.tabId) {
    ensureInjected(request.tabId, request.url).then(ok => {
      sendResponse({ ok });
    });
    return true;
  }

  sendResponse({ ok: true });
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!isInjectable(tab.url)) return;

  if (changeInfo.status === 'complete') {
    const delivered = await notifyTab(tabId, { action: 'triggerRun' });
    if (!delivered) {
      // content script 不在（扩展刚重载 / 注入失败），补注入
      await ensureInjected(tabId, tab.url);
      await notifyTab(tabId, { action: 'triggerRun' });
    }
    return;
  }

  // SPA 内部跳转不会产生 status=complete，只有 url 变化
  if (changeInfo.url) {
    await notifyTab(tabId, { action: 'urlChanged' });
  }
});
