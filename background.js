console.log('Background script loaded');

let pendingElementData = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background收到消息:', request);
  
  if (request.action === 'elementPicked') {
    pendingElementData = request;
    chrome.storage.local.set({pendingElementData: request}, () => {
      console.log('已保存待处理的元素数据');
    });
  }
  
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome') && !tab.url.startsWith('edge')) {
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { action: 'triggerRun' }).catch(() => {});
    }, 300);
  }
});
