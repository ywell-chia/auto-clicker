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
      delay: stepData?.delay || 1000,
      count: stepData?.count || 1,
      interval: stepData?.interval || 200,
      order: stepData?.order || steps.length + 1
    });
    renderSteps();
  }
  
  function removeStep(id) {
    steps = steps.filter(s => s.id !== id);
    steps.forEach((s, i) => s.order = i + 1);
    renderSteps();
    saveDraft();
  }
  
  function renderSteps() {
    stepsContainer.innerHTML = '';
    
    steps.forEach((step, index) => {
      const div = document.createElement('div');
      div.className = 'step';
      div.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 8px;">${t('stepN', {n: step.order})}</div>
        ${step.elementData ? `
          <div class="element-preview">${t('elementSelected')}${step.elementData.tagName} ${(step.elementData.textContent || '').substring(0, 30)}</div>
        ` : ''}
        <button class="pick-element" data-id="${step.id}" style="background: #FF9800; margin-bottom: 6px; width: 100%;">${t('pickPageElement')}</button>
        <div class="form-row">
          <div class="form-group">
            <label>${t('delayLabel')}</label>
            <input type="number" class="delay-input" data-id="${step.id}" placeholder="0" value="${step.delay}" min="0" style="margin-bottom: 0;">
          </div>
          <div class="form-group">
            <label>${t('repeatCount')}</label>
            <input type="number" class="count-input" data-id="${step.id}" placeholder="1" value="${step.count}" min="1" style="margin-bottom: 0;">
          </div>
        </div>
        <div class="form-row" style="margin-top: 10px;">
          <div class="form-group">
            <label>${t('intervalLabel')}</label>
            <input type="number" class="interval-input" data-id="${step.id}" placeholder="200" value="${step.interval}" min="0" style="margin-bottom: 0;">
          </div>
        </div>
        <button class="delete-step" data-id="${step.id}" style="background: #f44336; margin-top: 8px;">${t('deleteStep')}</button>
      `;
      stepsContainer.appendChild(div);
    });
    
    document.querySelectorAll('.pick-element').forEach(btn => {
      btn.addEventListener('click', () => startElementPicker('step', parseInt(btn.dataset.id)));
    });
    document.querySelectorAll('.delete-step').forEach(btn => {
      btn.addEventListener('click', () => removeStep(parseInt(btn.dataset.id)));
    });
    document.querySelectorAll('.delay-input').forEach(input => {
      input.addEventListener('input', () => {
        const step = steps.find(s => s.id === parseInt(input.dataset.id));
        if (step) { step.delay = parseInt(input.value) || 0; saveDraft(); }
      });
    });
    document.querySelectorAll('.count-input').forEach(input => {
      input.addEventListener('input', () => {
        const step = steps.find(s => s.id === parseInt(input.dataset.id));
        if (step) { step.count = parseInt(input.value) || 1; saveDraft(); }
      });
    });
    document.querySelectorAll('.interval-input').forEach(input => {
      input.addEventListener('input', () => {
        const step = steps.find(s => s.id === parseInt(input.dataset.id));
        if (step) { step.interval = parseInt(input.value) || 200; saveDraft(); }
      });
    });
  }
  
  function startElementPicker(type, stepId = null) {
    currentPickerTarget = { type, stepId };
    
    chrome.storage.local.set({
      currentPickerTarget: currentPickerTarget,
      draft: getCurrentDraft()
    });
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || !tabs[0]) {
        showStatus(t('openWebpageFirst'), 'error');
        return;
      }
      
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'startPicker',
        pickerType: type,
        stepId: stepId
      });
      
      window.close();
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
        
        steps = result.draft.steps || [];
        stepIdCounter = result.draft.stepIdCounter || 0;
        editingConfigId = result.draft.editingConfigId || null;
        
        if (editingConfigId) showEditingMode();
        
        applyComboTriggerUI();
      }
      
      if (result.pendingElementData && result.currentPickerTarget) {
        if (result.currentPickerTarget.type === 'trigger') {
          triggerElementData = result.pendingElementData;
        } else if (result.currentPickerTarget.type === 'comboElement') {
          comboTriggerData.elementData = result.pendingElementData;
        } else if (result.currentPickerTarget.type === 'step') {
          if (result.draft) applyDraft(result.draft);
          const step = steps.find(s => s.id === result.currentPickerTarget.stepId);
          if (step) step.elementData = result.pendingElementData;
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
      triggerElementPreview.textContent = t('triggerElementSelected') + triggerElementData.tagName + ' ' + (triggerElementData.textContent || '').substring(0, 30);
    } else {
      triggerElementPreview.classList.add('hidden');
    }
  }
  
  function updateComboElementPreview() {
    if (comboTriggerData.elementData) {
      comboElementPreview.classList.remove('hidden');
      comboElementPreview.textContent = t('triggerElementSelected') + comboTriggerData.elementData.tagName + ' ' + (comboTriggerData.elementData.textContent || '').substring(0, 30);
    } else {
      comboElementPreview.classList.add('hidden');
    }
  }
  
  function applyComboTriggerUI() {
    comboRequireWebsite.checked = comboTriggerData.requireWebsite;
    comboWebsiteUrl.value = comboTriggerData.websiteUrl;
    comboWebsiteUrl.classList.toggle('hidden', !comboTriggerData.requireWebsite);
    
    comboRequireElement.checked = comboTriggerData.requireElement;
    comboPickElement.classList.toggle('hidden', !comboTriggerData.requireElement);
    updateComboElementPreview();
    
    comboRequireText.checked = comboTriggerData.requireText;
    comboTextContent.value = comboTriggerData.textContent;
    comboTextContent.classList.toggle('hidden', !comboTriggerData.requireText);
  }
  
  function applyDraft(draft) {
    if (draft.configName) configNameInput.value = draft.configName;
    if (draft.triggerType) triggerType = draft.triggerType;
    if (draft.websiteUrl) websiteUrlInput.value = draft.websiteUrl;
    if (draft.triggerElement) triggerElementData = draft.triggerElement;
    if (draft.triggerText) triggerTextContentInput.value = draft.triggerText;
    if (draft.comboTrigger) comboTriggerData = draft.comboTrigger;
    
    if (draft.triggerMode) {
      const triggerModeRadio = document.querySelector(`input[name="triggerMode"][value="${draft.triggerMode}"]`);
      if (triggerModeRadio) triggerModeRadio.checked = true;
    }
    updateTriggerModeUI();
    
    if (draft.autoMode) {
      const autoModeRadio = document.querySelector(`input[name="autoMode"][value="${draft.autoMode}"]`);
      if (autoModeRadio) autoModeRadio.checked = true;
    }
    if (draft.loadDelay) loadDelayInput.value = draft.loadDelay;
    if (draft.pollingInterval) pollingIntervalInput.value = draft.pollingInterval;
    updateAutoModeUI();
    
    if (draft.steps) steps = draft.steps;
    if (draft.stepIdCounter) stepIdCounter = draft.stepIdCounter;
    if (draft.editingConfigId) editingConfigId = draft.editingConfigId;
  }
  
  function showEditingMode() {
    editingModeDiv.classList.remove('hidden');
    if (editingConfigId) {
      const config = allConfigs.find(c => c.id === editingConfigId);
      if (config) editingConfigNameSpan.textContent = config.name;
    }
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
  
  function saveOrUpdateConfig() {
    const name = configNameInput.value.trim();
    if (!name) {
      showStatus(t('enterConfigName'), 'error');
      return;
    }
    
    if (steps.length === 0) {
      showStatus(t('addAtLeastOneStep'), 'error');
      return;
    }
    
    chrome.storage.local.get(['configs'], function(result) {
      allConfigs = result.configs || [];
      
      if (editingConfigId) {
        const index = allConfigs.findIndex(c => c.id === editingConfigId);
        if (index !== -1) {
          const configData = {
            id: editingConfigId,
            name: name,
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
            paused: allConfigs[index].paused || false,
            createdAt: allConfigs[index].createdAt,
            updatedAt: Date.now()
          };
          allConfigs[index] = configData;
        }
      } else {
        const configData = {
          id: Date.now(),
          name: name,
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
          paused: false,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        allConfigs.unshift(configData);
      }
      
      chrome.storage.local.set({ configs: allConfigs }, function() {
        showStatus(editingConfigId ? t('configUpdated') : t('configSaved'), 'success');
        clearDraft();
        loadConfigs();
      });
    });
  }
  
  function testCurrentDraft() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (!tabs || !tabs[0]) {
        showStatus(t('openWebpageFirst'), 'error');
        return;
      }
      
      const draft = getCurrentDraft();
      
      chrome.storage.local.set({ testConfig: draft }, function() {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'test', config: draft });
        window.close();
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
  
  function renderConfigList() {
    if (!allConfigs || allConfigs.length === 0) {
      configListDiv.innerHTML = `<div style="text-align: center; color: #666; padding: 20px;">${t('noSavedConfigs')}</div>`;
      return;
    }
    
    let filteredConfigs = allConfigs;
    if (searchQuery) {
      filteredConfigs = allConfigs.filter(c => 
        c.name.toLowerCase().includes(searchQuery)
      );
    }
    
    const triggerTypeMap = {
      website: 'triggerTypeWebsite',
      element: 'triggerTypeElement',
      text: 'triggerTypeText',
      combo: 'triggerTypeCombo'
    };
    
    configListDiv.innerHTML = filteredConfigs.map(config => {
      const triggerTypeText = t(triggerTypeMap[config.triggerType] || 'triggerTypeWebsite');
      const statusIcon = config.paused ? t('statusPaused') : (config.triggerMode === 'manual' ? t('statusManual') : t('statusActive'));
      
      return `
        <div class="config-item" data-id="${config.id}">
          <div class="config-item-header">
            <div class="config-item-name">${config.name}</div>
            <div class="config-item-meta">${triggerTypeText} | ${statusIcon}</div>
          </div>
          <div class="config-item-actions">
            <button class="config-action-btn edit-config" data-id="${config.id}" title="${t('tipEdit')}">✏️</button>
            <button class="config-action-btn toggle-config-pause" data-id="${config.id}" title="${config.paused ? t('tipEnable') : t('tipPause')}">${config.paused ? '🔛' : '⏸️'}</button>
            <button class="config-action-btn run-config" data-id="${config.id}" title="${t('tipRun')}">▶️</button>
            <button class="config-action-btn delete-config" data-id="${config.id}" title="${t('tipDelete')}">🗑️</button>
          </div>
        </div>
      `;
    }).join('');
    
    configListDiv.querySelectorAll('.edit-config').forEach(btn => {
      btn.addEventListener('click', () => loadConfigToEdit(parseInt(btn.dataset.id)));
    });
    configListDiv.querySelectorAll('.toggle-config-pause').forEach(btn => {
      btn.addEventListener('click', () => toggleConfigPause(parseInt(btn.dataset.id)));
    });
    configListDiv.querySelectorAll('.run-config').forEach(btn => {
      btn.addEventListener('click', () => runConfig(parseInt(btn.dataset.id)));
    });
    configListDiv.querySelectorAll('.delete-config').forEach(btn => {
      btn.addEventListener('click', () => deleteConfig(parseInt(btn.dataset.id)));
    });
  }
  
  function loadConfigToEdit(configId) {
    const config = allConfigs.find(c => c.id === configId);
    if (!config) return;
    
    configNameInput.value = config.name;
    triggerType = config.triggerType;
    websiteUrlInput.value = config.websiteUrl;
    triggerElementData = config.triggerElement;
    triggerTextContentInput.value = config.triggerText;
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
    
    steps = config.steps || [];
    stepIdCounter = Math.max(...steps.map(s => s.id || 0), 0) + 1;
    editingConfigId = configId;
    
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
      const config = allConfigs.find(c => c.id === configId);
      if (config) {
        config.paused = !config.paused;
        config.updatedAt = Date.now();
        chrome.storage.local.set({ configs: allConfigs }, function() {
          renderConfigList();
          showStatus(config.paused ? t('configPaused') : t('configEnabled'), 'success');
        });
      }
    });
  }
  
  function runConfig(configId) {
    chrome.storage.local.get(['configs'], function(result) {
      allConfigs = result.configs || [];
      const config = allConfigs.find(c => c.id === configId);
      if (!config) return;
      
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (!tabs || !tabs[0]) {
          showStatus(t('openWebpageFirst'), 'error');
          return;
        }
        
        chrome.storage.local.set({ testConfig: config }, function() {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'test', config: config });
          window.close();
        });
      });
    });
  }
  
  function deleteConfig(configId) {
    if (!confirm(t('confirmDelete'))) return;
    
    chrome.storage.local.get(['configs'], function(result) {
      allConfigs = result.configs || [];
      allConfigs = allConfigs.filter(c => c.id !== configId);
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
            <div class="picker-item-name">${config.name}</div>
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
        
        const validConfigs = importedConfigs.filter(c => c.name && c.steps);
        if (validConfigs.length === 0) {
          showStatus(t('invalidFormat'), 'error');
          return;
        }
        
        showConfigPicker(validConfigs, 'selectConfigsToImport', 'confirmImport', function(selected) {
          chrome.storage.local.get(['configs'], function(result) {
            let allConfigs = result.configs || [];
            const existingIds = new Set(allConfigs.map(c => c.id));
            
            selected.forEach(config => {
              let newId = Date.now() + Math.floor(Math.random() * 1000);
              while (existingIds.has(newId)) {
                newId = Date.now() + Math.floor(Math.random() * 1000);
              }
              const newConfig = {
                ...config,
                id: newId,
                paused: config.paused || false,
                createdAt: Date.now(),
                updatedAt: Date.now()
              };
              allConfigs.unshift(newConfig);
              existingIds.add(newId);
            });
            
            chrome.storage.local.set({ configs: allConfigs }, function() {
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
