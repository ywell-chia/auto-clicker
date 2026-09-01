document.addEventListener('DOMContentLoaded', function() {
  console.log('Popup loaded');
  
  const configNameInput = document.getElementById('configName');
  const triggerTabs = document.querySelectorAll('.trigger-tab');
  const triggerWebsiteDiv = document.getElementById('triggerWebsite');
  const triggerElementDiv = document.getElementById('triggerElement');
  const triggerTextDiv = document.getElementById('triggerText');
  const triggerComboDiv = document.getElementById('triggerCombo');
  const websiteUrlInput = document.getElementById('websiteUrl');
  const pickTriggerElementBtn = document.getElementById('pickTriggerElement');
  const triggerElementPreview = document.getElementById('triggerElementPreview');
  const triggerTextContentInput = document.getElementById('triggerTextContent');
  const stepsContainer = document.getElementById('stepsContainer');
  const addStepBtn = document.getElementById('addStepBtn');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const listBtn = document.getElementById('listBtn');
  const clearBtn = document.getElementById('clearBtn');
  const listContainer = document.getElementById('listContainer');
  const configListDiv = document.getElementById('configList');
  const statusDiv = document.getElementById('status');
  const configSearchInput = document.getElementById('configSearch');
  const editingModeDiv = document.getElementById('editingMode');
  const editingConfigNameSpan = document.getElementById('editingConfigName');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  
  const triggerModeRadios = document.querySelectorAll('input[name="triggerMode"]');
  const autoTriggerOptions = document.getElementById('autoTriggerOptions');
  const autoModeRadios = document.querySelectorAll('input[name="autoMode"]');
  const loadDelayRow = document.getElementById('loadDelayRow');
  const loadDelayInput = document.getElementById('loadDelay');
  const pollingIntervalRow = document.getElementById('pollingIntervalRow');
  const pollingIntervalInput = document.getElementById('pollingInterval');
  
  const comboRequireWebsite = document.getElementById('comboRequireWebsite');
  const comboWebsiteUrl = document.getElementById('comboWebsiteUrl');
  const comboRequireElement = document.getElementById('comboRequireElement');
  const comboPickElement = document.getElementById('comboPickElement');
  const comboElementPreview = document.getElementById('comboElementPreview');
  const comboRequireText = document.getElementById('comboRequireText');
  const comboTextContent = document.getElementById('comboTextContent');
  
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile');
  
  const langDropdown = document.getElementById('langDropdown');
  
  let triggerType = 'website';
  let triggerElementData = null;
  let comboTriggerData = {
    requireWebsite: false,
    websiteUrl: '',
    requireElement: false,
    elementData: null,
    requireText: false,
    textContent: ''
  };
  let steps = [];
  let stepIdCounter = 0;
  let allConfigs = [];
  let currentPickerTarget = null;
  let editingConfigId = null;
  let searchQuery = '';
  
  initLang();
  
  function initLang() {
    chrome.storage.local.get(['lang'], function(result) {
      currentLang = result.lang || 'zh';
      langDropdown.value = currentLang;
      applyI18nToDOM();
      onLangReady();
    });
  }
  
  langDropdown.addEventListener('change', function() {
    setLang(this.value);
    renderSteps();
    renderConfigList();
    updateTriggerElementPreview();
    updateComboElementPreview();
  });
  
  function onLangReady() {
    loadDraft();
    loadConfigs();
  }
  
  triggerTabs.forEach(tab => {
    tab.addEventListener('click', function() {
      triggerType = this.dataset.trigger;
      updateTriggerTabs();
      saveDraft();
    });
  });
  
  pickTriggerElementBtn.addEventListener('click', function() {
    startElementPicker('trigger');
  });
  
  comboPickElement.addEventListener('click', function() {
    startElementPicker('comboElement');
  });
  
  comboRequireWebsite.addEventListener('change', function() {
    comboWebsiteUrl.classList.toggle('hidden', !this.checked);
    comboTriggerData.requireWebsite = this.checked;
    saveDraft();
  });
  
  comboRequireElement.addEventListener('change', function() {
    comboPickElement.classList.toggle('hidden', !this.checked);
    if (!this.checked) comboElementPreview.classList.add('hidden');
    comboTriggerData.requireElement = this.checked;
    saveDraft();
  });
  
  comboRequireText.addEventListener('change', function() {
    comboTextContent.classList.toggle('hidden', !this.checked);
    comboTriggerData.requireText = this.checked;
    saveDraft();
  });
  
  comboWebsiteUrl.addEventListener('input', function() {
    comboTriggerData.websiteUrl = this.value;
    saveDraft();
  });
  
  comboTextContent.addEventListener('input', function() {
    comboTriggerData.textContent = this.value;
    saveDraft();
  });
  
  triggerModeRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      updateTriggerModeUI();
      saveDraft();
    });
  });
  autoModeRadios.forEach(radio => {
    radio.addEventListener('change', function() {
      updateAutoModeUI();
      saveDraft();
    });
  });
  loadDelayInput.addEventListener('input', saveDraft);
  pollingIntervalInput.addEventListener('input', saveDraft);
  
  addStepBtn.addEventListener('click', function() {
    addStep();
    saveDraft();
  });
  
  saveBtn.addEventListener('click', saveOrUpdateConfig);
  testBtn.addEventListener('click', testCurrentDraft);
  listBtn.addEventListener('click', toggleConfigList);
  clearBtn.addEventListener('click', clearDraft);
  configSearchInput.addEventListener('input', handleSearch);
  cancelEditBtn.addEventListener('click', cancelEdit);
  
  configNameInput.addEventListener('input', saveDraft);
  websiteUrlInput.addEventListener('input', saveDraft);
  triggerTextContentInput.addEventListener('input', saveDraft);
  
  exportBtn.addEventListener('click', exportConfigs);
  importBtn.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', importConfigs);
  
  // ---- 标签页通信：先确保 content script 已注入，再发消息 ----
  function getActiveTab(callback) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id || !/^https?:\/\//i.test(tab.url || '')) {
        showStatus(t('openWebpageFirst'), 'error');
        return;
      }
      callback(tab);
    });
  }

  // 扩展刚重载 / 页面在扩展安装前就打开时，content script 可能不在，
  // 先让 background 补注入再发消息，避免「点了没反应」
  function sendToTab(tab, message, onDone) {
    chrome.runtime.sendMessage({ action: 'ensureInjected', tabId: tab.id, url: tab.url }, function() {
      void chrome.runtime.lastError;
      chrome.tabs.sendMessage(tab.id, message, function() {
        const err = chrome.runtime.lastError;
        if (err) {
          showStatus(t('pageNotReady'), 'error');
          return;
        }
        if (onDone) onDone();
      });
    });
  }

  function updateTriggerTabs() {
    triggerTabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.trigger === triggerType);
    });
    
    triggerWebsiteDiv.classList.add('hidden');
    triggerElementDiv.classList.add('hidden');
    triggerTextDiv.classList.add('hidden');
    triggerComboDiv.classList.add('hidden');
    
    if (triggerType === 'website') triggerWebsiteDiv.classList.remove('hidden');
    else if (triggerType === 'element') triggerElementDiv.classList.remove('hidden');
    else if (triggerType === 'text') triggerTextDiv.classList.remove('hidden');
    else if (triggerType === 'combo') triggerComboDiv.classList.remove('hidden');
  }
  
  function updateTriggerModeUI() {
    const selectedMode = document.querySelector('input[name="triggerMode"]:checked').value;
    autoTriggerOptions.style.display = selectedMode === 'auto' ? 'block' : 'none';
  }
  
  function updateAutoModeUI() {
    const selectedMode = document.querySelector('input[name="autoMode"]:checked').value;
    loadDelayRow.style.display = selectedMode === 'onLoad' ? 'flex' : 'none';
    pollingIntervalRow.style.display = selectedMode === 'polling' ? 'flex' : 'none';
  }
  
  function addStep(stepData = null) {
    const id = stepIdCounter++;
    steps.push({
      id: id,
      type: 'click',
      elementData: stepData?.elementData || null,
      delay: stepData?.delay ?? 1000,
      count: stepData?.count ?? 1,
      interval: stepData?.interval ?? 200,
      order: steps.length + 1
    });
    renderSteps();
  }

  function removeStep(id) {
    steps = steps.filter(s => String(s.id) !== String(id));
    steps.forEach((s, i) => s.order = i + 1);
    renderSteps();
    saveDraft();
  }

  function findStep(id) {
    return steps.find(s => String(s.id) === String(id));
  }

  // 元素摘要：图标按钮没有文字，光显示 tagName 看不出选中了什么
  function describeElement(data) {
    if (!data) return '';
    const parts = [data.tagName ? data.tagName.toLowerCase() : '?'];
    const text = (data.textContent || '').trim();
    if (text) {
      parts.push('"' + text.substring(0, 24) + '"');
    } else {
      const attrs = data.attrs || {};
      const label = attrs['aria-label'] || attrs.title || attrs['data-testid'] || attrs.name || attrs.alt;
      if (label) parts.push('[' + String(label).substring(0, 24) + ']');
      else if (data.stableId) parts.push('#' + data.stableId.substring(0, 24));
      else if ((data.classes || []).length) parts.push('.' + data.classes[0].substring(0, 24));
      else parts.push(t('noTextElement'));
    }
    return parts.join(' ');
  }

  function renderSteps() {
    stepsContainer.innerHTML = '';

    steps.forEach((step) => {
      const div = document.createElement('div');
      div.className = 'step';
      div.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 8px;">${t('stepN', {n: step.order})}</div>
        ${step.elementData
          ? `<div class="element-preview">${t('elementSelected')}${escapeHtml(describeElement(step.elementData))}</div>`
          : `<div class="element-preview" style="background:#fff3cd;color:#856404;">${t('stepMissingElement')}</div>`}
        <button class="pick-element" data-id="${escapeHtml(step.id)}" style="background: #FF9800; margin-bottom: 6px; width: 100%;">${t('pickPageElement')}</button>
        <div class="form-row">
          <div class="form-group">
            <label>${t('delayLabel')}</label>
            <input type="number" class="delay-input" data-id="${escapeHtml(step.id)}" placeholder="0" value="${escapeHtml(step.delay)}" min="0" style="margin-bottom: 0;">
          </div>
          <div class="form-group">
            <label>${t('repeatCount')}</label>
            <input type="number" class="count-input" data-id="${escapeHtml(step.id)}" placeholder="1" value="${escapeHtml(step.count)}" min="1" style="margin-bottom: 0;">
          </div>
        </div>
        <div class="form-row" style="margin-top: 10px;">
          <div class="form-group">
            <label>${t('intervalLabel')}</label>
            <input type="number" class="interval-input" data-id="${escapeHtml(step.id)}" placeholder="200" value="${escapeHtml(step.interval)}" min="0" style="margin-bottom: 0;">
          </div>
        </div>
        <button class="delete-step" data-id="${escapeHtml(step.id)}" style="background: #f44336; margin-top: 8px;">${t('deleteStep')}</button>
      `;
      stepsContainer.appendChild(div);
    });
    
    stepsContainer.querySelectorAll('.pick-element').forEach(btn => {
      btn.addEventListener('click', () => startElementPicker('step', btn.dataset.id));
    });
    stepsContainer.querySelectorAll('.delete-step').forEach(btn => {
      btn.addEventListener('click', () => removeStep(btn.dataset.id));
    });
    stepsContainer.querySelectorAll('.delay-input').forEach(input => {
      input.addEventListener('input', () => {
        const step = findStep(input.dataset.id);
        if (step) { step.delay = Math.max(0, parseInt(input.value) || 0); saveDraft(); }
      });
    });
    stepsContainer.querySelectorAll('.count-input').forEach(input => {
      input.addEventListener('input', () => {
        const step = findStep(input.dataset.id);
        if (step) { step.count = Math.max(1, parseInt(input.value) || 1); saveDraft(); }
      });
    });
    stepsContainer.querySelectorAll('.interval-input').forEach(input => {
      input.addEventListener('input', () => {
        const step = findStep(input.dataset.id);
        if (step) { step.interval = Math.max(0, parseInt(input.value) || 200); saveDraft(); }
      });
    });
  }
  
  function startElementPicker(type, stepId = null) {
    currentPickerTarget = { type, stepId };

    chrome.storage.local.set({
      currentPickerTarget: currentPickerTarget,
      draft: getCurrentDraft()
    }, function() {
      getActiveTab(function(tab) {
        sendToTab(tab, {
          action: 'startPicker',
          pickerType: type,
          stepId: stepId
        }, function() {
          window.close();
        });
      });
    });
  }
  
  function getCurrentDraft() {
    return {
      configName: configNameInput.value,
      triggerType: triggerType,
      websiteUrl: websiteUrlInput.value,
      triggerElement: triggerElementData,
      triggerText: triggerTextContentInput.value,
      comboTrigger: comboTriggerData,
      triggerMode: document.querySelector('input[name="triggerMode"]:checked').value,
      autoMode: document.querySelector('input[name="autoMode"]:checked').value,
      loadDelay: parseInt(loadDelayInput.value) || 0,
      pollingInterval: parseInt(pollingIntervalInput.value) || 3000,
      steps: steps,
      stepIdCounter: stepIdCounter,
      editingConfigId: editingConfigId
    };
  }
  
  function saveDraft() {
    chrome.storage.local.set({ draft: getCurrentDraft() });
  }
  
  function loadDraft() {
    chrome.storage.local.get(['draft', 'currentPickerTarget', 'pendingElementData'], function(result) {
      if (result.draft) {
        configNameInput.value = result.draft.configName || '';
        triggerType = result.draft.triggerType || 'website';
        websiteUrlInput.value = result.draft.websiteUrl || '';
        triggerElementData = result.draft.triggerElement || null;
        triggerTextContentInput.value = result.draft.triggerText || '';
        comboTriggerData = result.draft.comboTrigger || {
          requireWebsite: false,
          websiteUrl: '',
          requireElement: false,
          elementData: null,
          requireText: false,
          textContent: ''
        };

        const triggerMode = result.draft.triggerMode || 'auto';
        const triggerModeRadio = document.querySelector(`input[name="triggerMode"][value="${triggerMode}"]`);
        if (triggerModeRadio) triggerModeRadio.checked = true;
        updateTriggerModeUI();

        const autoMode = result.draft.autoMode || 'onLoad';
        const autoModeRadio = document.querySelector(`input[name="autoMode"][value="${autoMode}"]`);
        if (autoModeRadio) autoModeRadio.checked = true;
        loadDelayInput.value = result.draft.loadDelay || 1000;
        pollingIntervalInput.value = result.draft.pollingInterval || 3000;
        updateAutoModeUI();

        steps = (result.draft.steps || []).map(s => ({ ...s }));
        stepIdCounter = result.draft.stepIdCounter || (Math.max(0, ...steps.map(s => Number(s.id) || 0)) + 1);
        editingConfigId = result.draft.editingConfigId ?? null;

        if (editingConfigId != null) showEditingMode();

        applyComboTriggerUI();
      }

      if (result.pendingElementData && result.currentPickerTarget) {
        const target = result.currentPickerTarget;
        if (target.type === 'trigger') {
          triggerElementData = result.pendingElementData;
        } else if (target.type === 'comboElement') {
          comboTriggerData.elementData = result.pendingElementData;
        } else if (target.type === 'step') {
          const step = steps.find(s => String(s.id) === String(target.stepId));
          if (step) {
            step.elementData = result.pendingElementData;
          } else {
            // 草稿里已找不到这个步骤（被删掉了），提示而不是静默丢弃
            showStatus(t('pickedStepMissing'), 'warning');
          }
        }
        chrome.storage.local.remove(['pendingElementData', 'currentPickerTarget']);
        saveDraft();
        applyComboTriggerUI();
      }

      updateTriggerTabs();
      updateTriggerElementPreview();
      renderSteps();
    });
  }
  
  function updateTriggerElementPreview() {
    if (triggerElementData) {
      triggerElementPreview.classList.remove('hidden');
      triggerElementPreview.textContent = t('triggerElementSelected') + describeElement(triggerElementData);
    } else {
      triggerElementPreview.classList.add('hidden');
    }
  }
  
  function updateComboElementPreview() {
    if (comboTriggerData.elementData) {
      comboElementPreview.classList.remove('hidden');
      comboElementPreview.textContent = t('triggerElementSelected') + describeElement(comboTriggerData.elementData);
    } else {
      comboElementPreview.classList.add('hidden');
    }
  }

  function applyComboTriggerUI() {
    comboRequireWebsite.checked = !!comboTriggerData.requireWebsite;
    comboWebsiteUrl.value = comboTriggerData.websiteUrl || '';
    comboWebsiteUrl.classList.toggle('hidden', !comboTriggerData.requireWebsite);

    comboRequireElement.checked = !!comboTriggerData.requireElement;
    comboPickElement.classList.toggle('hidden', !comboTriggerData.requireElement);
    updateComboElementPreview();

    comboRequireText.checked = !!comboTriggerData.requireText;
    comboTextContent.value = comboTriggerData.textContent || '';
    comboTextContent.classList.toggle('hidden', !comboTriggerData.requireText);
  }
  
  function showEditingMode() {
    editingModeDiv.classList.remove('hidden');
    // allConfigs 可能还没加载完（与 loadDraft 并行），退回用输入框里的名字
    const config = findConfigById(allConfigs, editingConfigId);
    editingConfigNameSpan.textContent = config?.name || configNameInput.value || '';
  }
  
  function hideEditingMode() {
    editingModeDiv.classList.add('hidden');
    editingConfigNameSpan.textContent = '';
  }
  
  function cancelEdit() {
    clearDraft();
  }
  
  function handleSearch() {
    searchQuery = configSearchInput.value.trim().toLowerCase();
    renderConfigList();
  }
  
  // 保存前校验，拦掉「一定不会生效」或「会到处乱点」的配置
  function validateConfig(draft) {
    if (!draft.name) return t('enterConfigName');
    if (!draft.steps || draft.steps.length === 0) return t('addAtLeastOneStep');

    if (draft.steps.some(s => !s.elementData)) {
      return t('stepMissingElement');
    }

    if (draft.triggerType === 'website' && !draft.websiteUrl.trim()) {
      return t('websiteUrlRequired');
    }
    if (draft.triggerType === 'element' && !draft.triggerElement) {
      return t('triggerElementRequired');
    }
    if (draft.triggerType === 'text' && !draft.triggerText.trim()) {
      return t('triggerTextRequired');
    }
    if (draft.triggerType === 'combo') {
      const combo = draft.comboTrigger || {};
      if (!combo.requireWebsite && !combo.requireElement && !combo.requireText) {
        return t('comboNeedsCondition');
      }
      if (combo.requireWebsite && !(combo.websiteUrl || '').trim()) {
        return t('websiteUrlRequired');
      }
      if (combo.requireElement && !combo.elementData) {
        return t('triggerElementRequired');
      }
      if (combo.requireText && !(combo.textContent || '').trim()) {
        return t('triggerTextRequired');
      }
    }

    return null;
  }

  function buildConfigPayload(name) {
    return {
      name: name,
      triggerType: triggerType,
      websiteUrl: websiteUrlInput.value.trim(),
      triggerElement: triggerElementData,
      triggerText: triggerTextContentInput.value.trim(),
      comboTrigger: comboTriggerData,
      triggerMode: document.querySelector('input[name="triggerMode"]:checked').value,
      autoMode: document.querySelector('input[name="autoMode"]:checked').value,
      loadDelay: parseInt(loadDelayInput.value) || 0,
      pollingInterval: Math.max(200, parseInt(pollingIntervalInput.value) || 3000),
      steps: steps
    };
  }

  function saveOrUpdateConfig() {
    const name = configNameInput.value.trim();
    const payload = buildConfigPayload(name);

    const error = validateConfig(payload);
    if (error) {
      showStatus(error, 'error');
      return;
    }

    chrome.storage.local.get(['configs'], function(result) {
      allConfigs = result.configs || [];

      // id 可能是 number 也可能是 string（导入的配置），统一按字符串比
      const index = editingConfigId != null
        ? allConfigs.findIndex(c => String(c.id) === String(editingConfigId))
        : -1;

      const isUpdate = index !== -1;

      if (editingConfigId != null && !isUpdate) {
        // 正在编辑的配置已不存在（被删掉 / 被其他窗口改过）：
        // 不能静默丢弃用户的编辑，转为新建保存
        showStatus(t('editTargetMissing'), 'warning');
      }

      if (isUpdate) {
        allConfigs[index] = {
          ...payload,
          id: allConfigs[index].id,
          paused: allConfigs[index].paused || false,
          createdAt: allConfigs[index].createdAt || Date.now(),
          updatedAt: Date.now()
        };
      } else {
        allConfigs.unshift({
          ...payload,
          id: Date.now(),
          paused: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }

      chrome.storage.local.set({ configs: allConfigs }, function() {
        if (chrome.runtime.lastError) {
          showStatus(t('saveFailed') + chrome.runtime.lastError.message, 'error');
          return;
        }
        showStatus(isUpdate ? t('configUpdated') : t('configSaved'), 'success');
        clearDraft();
        loadConfigs();
      });
    });
  }
  
  function testCurrentDraft() {
    const draft = getCurrentDraft();

    if (!draft.steps || draft.steps.length === 0) {
      showStatus(t('addAtLeastOneStep'), 'error');
      return;
    }
    if (draft.steps.some(s => !s.elementData)) {
      showStatus(t('stepMissingElement'), 'error');
      return;
    }

    getActiveTab(function(tab) {
      // 测试时把草稿名补上，content script 日志里能对上号
      const testConfig = { ...draft, name: draft.configName || t('testBtn'), id: 'draft' };
      chrome.storage.local.set({ testConfig: testConfig }, function() {
        sendToTab(tab, { action: 'test', config: testConfig }, function() {
          window.close();
        });
      });
    });
  }
  
  function toggleConfigList() {
    listContainer.classList.toggle('hidden');
    if (!listContainer.classList.contains('hidden')) {
      loadConfigs();
    }
  }
  
  function loadConfigs() {
    chrome.storage.local.get(['configs'], function(result) {
      allConfigs = result.configs || [];
      renderConfigList();
    });
  }
  
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderConfigList() {
    if (!allConfigs || allConfigs.length === 0) {
      configListDiv.innerHTML = `<div style="text-align: center; color: #666; padding: 20px;">${t('noSavedConfigs')}</div>`;
      return;
    }

    let filteredConfigs = allConfigs;
    if (searchQuery) {
      filteredConfigs = allConfigs.filter(c =>
        (c.name || '').toLowerCase().includes(searchQuery)
      );
    }

    const triggerTypeMap = {
      website: 'triggerTypeWebsite',
      element: 'triggerTypeElement',
      text: 'triggerTypeText',
      combo: 'triggerTypeCombo'
    };

    const autoModeMap = {
      onLoad: 'modeTagOnLoad',
      polling: 'modeTagPolling',
      observer: 'modeTagObserver'
    };

    configListDiv.innerHTML = filteredConfigs.map(config => {
      const triggerTypeText = t(triggerTypeMap[config.triggerType] || 'triggerTypeWebsite');
      const statusIcon = config.paused ? t('statusPaused') : (config.triggerMode === 'manual' ? t('statusManual') : t('statusActive'));
      const modeText = (config.triggerMode || 'auto') === 'manual'
        ? ''
        : ' | ' + t(autoModeMap[config.autoMode || 'onLoad']);
      const id = escapeHtml(config.id);

      return `
        <div class="config-item" data-id="${id}">
          <div class="config-item-header">
            <div class="config-item-name">${escapeHtml(config.name)}</div>
            <div class="config-item-meta">${triggerTypeText}${modeText} | ${statusIcon}</div>
          </div>
          <div class="config-item-actions">
            <button class="config-action-btn edit-config" data-id="${id}" title="${t('tipEdit')}">✏️</button>
            <button class="config-action-btn toggle-config-pause" data-id="${id}" title="${config.paused ? t('tipEnable') : t('tipPause')}">${config.paused ? '🔛' : '⏸️'}</button>
            <button class="config-action-btn run-config" data-id="${id}" title="${t('tipRun')}">▶️</button>
            <button class="config-action-btn delete-config" data-id="${id}" title="${t('tipDelete')}">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    // id 统一按字符串传递，避免 parseInt 把导入配置的字符串 id 变成 NaN
    configListDiv.querySelectorAll('.edit-config').forEach(btn => {
      btn.addEventListener('click', () => loadConfigToEdit(btn.dataset.id));
    });
    configListDiv.querySelectorAll('.toggle-config-pause').forEach(btn => {
      btn.addEventListener('click', () => toggleConfigPause(btn.dataset.id));
    });
    configListDiv.querySelectorAll('.run-config').forEach(btn => {
      btn.addEventListener('click', () => runConfig(btn.dataset.id));
    });
    configListDiv.querySelectorAll('.delete-config').forEach(btn => {
      btn.addEventListener('click', () => deleteConfig(btn.dataset.id));
    });
  }

  function findConfigById(configs, configId) {
    return (configs || []).find(c => String(c.id) === String(configId));
  }

  function loadConfigToEdit(configId) {
    const config = findConfigById(allConfigs, configId);
    if (!config) {
      showStatus(t('editTargetMissing'), 'error');
      loadConfigs();
      return;
    }

    configNameInput.value = config.name || '';
    triggerType = config.triggerType || 'website';
    websiteUrlInput.value = config.websiteUrl || '';
    triggerElementData = config.triggerElement || null;
    triggerTextContentInput.value = config.triggerText || '';
    comboTriggerData = config.comboTrigger || {
      requireWebsite: false,
      websiteUrl: '',
      requireElement: false,
      elementData: null,
      requireText: false,
      textContent: ''
    };

    const triggerMode = config.triggerMode || 'auto';
    const triggerModeRadio = document.querySelector(`input[name="triggerMode"][value="${triggerMode}"]`);
    if (triggerModeRadio) triggerModeRadio.checked = true;
    updateTriggerModeUI();

    const autoMode = config.autoMode || 'onLoad';
    const autoModeRadio = document.querySelector(`input[name="autoMode"][value="${autoMode}"]`);
    if (autoModeRadio) autoModeRadio.checked = true;
    loadDelayInput.value = config.loadDelay || 1000;
    pollingIntervalInput.value = config.pollingInterval || 3000;
    updateAutoModeUI();

    steps = (config.steps || []).map(s => ({ ...s }));
    stepIdCounter = Math.max(0, ...steps.map(s => Number(s.id) || 0)) + 1;
    editingConfigId = config.id;

    updateTriggerTabs();
    applyComboTriggerUI();
    showEditingMode();
    updateTriggerElementPreview();

    renderSteps();
    saveDraft();
    listContainer.classList.add('hidden');
  }

  function toggleConfigPause(configId) {
    chrome.storage.local.get(['configs'], function(result) {
      allConfigs = result.configs || [];
      const config = findConfigById(allConfigs, configId);
      if (!config) {
        showStatus(t('editTargetMissing'), 'error');
        loadConfigs();
        return;
      }
      config.paused = !config.paused;
      config.updatedAt = Date.now();
      chrome.storage.local.set({ configs: allConfigs }, function() {
        renderConfigList();
        showStatus(config.paused ? t('configPaused') : t('configEnabled'), 'success');
      });
    });
  }

  function runConfig(configId) {
    chrome.storage.local.get(['configs'], function(result) {
      allConfigs = result.configs || [];
      const config = findConfigById(allConfigs, configId);
      if (!config) {
        showStatus(t('editTargetMissing'), 'error');
        loadConfigs();
        return;
      }

      getActiveTab(function(tab) {
        chrome.storage.local.set({ testConfig: config }, function() {
          sendToTab(tab, { action: 'test', config: config }, function() {
            window.close();
          });
        });
      });
    });
  }
  
  function deleteConfig(configId) {
    if (!confirm(t('confirmDelete'))) return;

    chrome.storage.local.get(['configs'], function(result) {
      const configs = result.configs || [];
      allConfigs = configs.filter(c => String(c.id) !== String(configId));

      // 正在编辑的配置被删掉了，退出编辑态，避免保存时把它「复活」
      if (editingConfigId != null && String(editingConfigId) === String(configId)) {
        editingConfigId = null;
        hideEditingMode();
        saveDraft();
      }

      chrome.storage.local.set({ configs: allConfigs }, function() {
        showStatus(t('configDeleted'), 'success');
        loadConfigs();
      });
    });
  }
  
  function clearDraft() {
    configNameInput.value = '';
    triggerType = 'website';
    websiteUrlInput.value = '';
    triggerElementData = null;
    triggerTextContentInput.value = '';
    comboTriggerData = {
      requireWebsite: false,
      websiteUrl: '',
      requireElement: false,
      elementData: null,
      requireText: false,
      textContent: ''
    };
    
    const triggerModeRadio = document.querySelector('input[name="triggerMode"][value="auto"]');
    if (triggerModeRadio) triggerModeRadio.checked = true;
    updateTriggerModeUI();
    
    const defaultAutoMode = document.querySelector('input[name="autoMode"][value="onLoad"]');
    if (defaultAutoMode) defaultAutoMode.checked = true;
    loadDelayInput.value = 1000;
    pollingIntervalInput.value = 3000;
    updateAutoModeUI();
    
    steps = [];
    stepIdCounter = 0;
    editingConfigId = null;
    searchQuery = '';
    configSearchInput.value = '';
    
    hideEditingMode();
    updateTriggerTabs();
    applyComboTriggerUI();
    triggerElementPreview.classList.add('hidden');
    renderSteps();
    chrome.storage.local.remove(['draft']);
  }
  
  const configPickerModal = document.getElementById('configPickerModal');
  const pickerTitle = document.getElementById('pickerTitle');
  const pickerSelectAll = document.getElementById('pickerSelectAll');
  const pickerSelectAllLabel = document.getElementById('pickerSelectAllLabel');
  const pickerList = document.getElementById('pickerList');
  const pickerConfirmBtn = document.getElementById('pickerConfirmBtn');
  const pickerCancelBtn = document.getElementById('pickerCancelBtn');
  
  let pickerConfirmCallback = null;
  
  function showConfigPicker(configs, titleKey, confirmKey, onConfirm) {
    const triggerTypeMap = {
      website: 'triggerTypeWebsite',
      element: 'triggerTypeElement',
      text: 'triggerTypeText',
      combo: 'triggerTypeCombo'
    };
    
    pickerTitle.textContent = t(titleKey);
    pickerSelectAllLabel.textContent = t('selectAll');
    pickerConfirmBtn.textContent = t(confirmKey);
    pickerCancelBtn.textContent = t('cancel');
    pickerSelectAll.checked = true;
    
    pickerList.innerHTML = configs.map((config, idx) => {
      const typeText = t(triggerTypeMap[config.triggerType] || 'triggerTypeWebsite');
      const stepsCount = (config.steps || []).length;
      return `
        <label class="picker-item">
          <input type="checkbox" class="picker-checkbox" data-idx="${idx}" checked>
          <div class="picker-item-info">
            <div class="picker-item-name">${escapeHtml(config.name)}</div>
            <div class="picker-item-meta">${typeText} · ${stepsCount} ${t('stepsLabel').toLowerCase()}</div>
          </div>
        </label>
      `;
    }).join('');
    
    const checkboxes = pickerList.querySelectorAll('.picker-checkbox');
    
    pickerSelectAll.onchange = function() {
      checkboxes.forEach(cb => cb.checked = pickerSelectAll.checked);
    };
    
    checkboxes.forEach(cb => {
      cb.onchange = function() {
        pickerSelectAll.checked = [...checkboxes].every(c => c.checked);
      };
    });
    
    pickerConfirmCallback = function() {
      const selectedIdxs = [...checkboxes].filter(cb => cb.checked).map(cb => parseInt(cb.dataset.idx));
      if (selectedIdxs.length === 0) {
        showStatus(t('noConfigSelected'), 'error');
        return;
      }
      const selected = selectedIdxs.map(i => configs[i]);
      hideConfigPicker();
      onConfirm(selected);
    };
    
    configPickerModal.classList.remove('hidden');
  }
  
  function hideConfigPicker() {
    configPickerModal.classList.add('hidden');
    pickerConfirmCallback = null;
  }
  
  pickerConfirmBtn.addEventListener('click', function() {
    if (pickerConfirmCallback) pickerConfirmCallback();
  });
  pickerCancelBtn.addEventListener('click', hideConfigPicker);
  
  function exportConfigs() {
    chrome.storage.local.get(['configs'], function(result) {
      const configs = result.configs || [];
      if (configs.length === 0) {
        showStatus(t('noConfigsToExport'), 'error');
        return;
      }
      
      showConfigPicker(configs, 'selectConfigsToExport', 'confirmExport', function(selected) {
        const dataStr = JSON.stringify(selected, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const exportFileDefaultName = `auto-clicker-configs-${new Date().toISOString().split('T')[0]}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        showStatus(t('exportSuccess', {n: selected.length}), 'success');
      });
    });
  }
  
  // 导入的配置可能来自旧版本或手工编辑，逐字段规整，避免存进去后运行时报错
  function normalizeImportedConfig(config, newId) {
    const steps = (config.steps || []).map((step, i) => ({
      id: Number.isFinite(Number(step.id)) ? Number(step.id) : i,
      type: 'click',
      elementData: step.elementData || null,
      delay: Math.max(0, parseInt(step.delay) || 0),
      count: Math.max(1, parseInt(step.count) || 1),
      interval: Math.max(0, parseInt(step.interval) || 200),
      order: i + 1
    }));

    const validTriggerTypes = ['website', 'element', 'text', 'combo'];
    const validAutoModes = ['onLoad', 'polling', 'observer'];

    return {
      id: newId,
      name: String(config.name).slice(0, 200),
      triggerType: validTriggerTypes.includes(config.triggerType) ? config.triggerType : 'website',
      websiteUrl: String(config.websiteUrl || '').trim(),
      triggerElement: config.triggerElement || null,
      triggerText: String(config.triggerText || '').trim(),
      comboTrigger: config.comboTrigger || {
        requireWebsite: false,
        websiteUrl: '',
        requireElement: false,
        elementData: null,
        requireText: false,
        textContent: ''
      },
      triggerMode: config.triggerMode === 'manual' ? 'manual' : 'auto',
      autoMode: validAutoModes.includes(config.autoMode) ? config.autoMode : 'onLoad',
      loadDelay: Math.max(0, parseInt(config.loadDelay) || 1000),
      pollingInterval: Math.max(200, parseInt(config.pollingInterval) || 3000),
      steps: steps,
      paused: !!config.paused,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  function importConfigs(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const importedConfigs = JSON.parse(e.target.result);
        if (!Array.isArray(importedConfigs)) {
          throw new Error(t('invalidFormat'));
        }

        const validConfigs = importedConfigs.filter(c =>
          c && typeof c === 'object' && c.name && Array.isArray(c.steps) && c.steps.length > 0
        );
        if (validConfigs.length === 0) {
          showStatus(t('invalidFormat'), 'error');
          return;
        }

        showConfigPicker(validConfigs, 'selectConfigsToImport', 'confirmImport', function(selected) {
          chrome.storage.local.get(['configs'], function(result) {
            const existing = result.configs || [];
            // id 可能是数字也可能是字符串，统一按字符串判重
            const existingIds = new Set(existing.map(c => String(c.id)));

            selected.forEach(config => {
              let newId = Date.now() + Math.floor(Math.random() * 100000);
              while (existingIds.has(String(newId))) {
                newId++;
              }
              existing.unshift(normalizeImportedConfig(config, newId));
              existingIds.add(String(newId));
            });

            chrome.storage.local.set({ configs: existing }, function() {
              if (chrome.runtime.lastError) {
                showStatus(t('saveFailed') + chrome.runtime.lastError.message, 'error');
                return;
              }
              showStatus(t('importSuccess', {n: selected.length}), 'success');
              loadConfigs();
            });
          });
        });
      } catch (err) {
        showStatus(t('importFailed') + err.message, 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }
  
  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = 'status';
    statusDiv.style.display = 'block';
    if (type === 'error') {
      statusDiv.classList.add('error');
    } else if (type === 'success') {
      statusDiv.classList.add('success');
    } else if (type === 'warning') {
      statusDiv.classList.add('warning');
    }
  }
});
