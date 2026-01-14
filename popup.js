document.addEventListener('DOMContentLoaded', function() {
    const toggleSwitch = document.getElementById('toggleSwitch');
    const statusText = document.getElementById('statusText');
    const refreshToggle = document.getElementById('refreshToggle');
    const refreshInterval = document.getElementById('refreshInterval');
    const filterIdInput = document.getElementById('filterId');
    const refreshStatus = document.getElementById('refreshStatus');
    let currentTabId = null;
    const ignoredListEl = document.getElementById('ignoredList');
    const clearIgnoredBtn = document.getElementById('clearIgnored');
    const saveFilterBtn = document.getElementById('saveFilterBtn');
    const throttleSecondsInput = document.getElementById('throttleSeconds');
    const onePerCycleCheckbox = document.getElementById('onePerCycle');

    // Helper to safely send messages to content script (handles missing content script)
    function safeSendToTab(tabId, message, cb) {
        if (!tabId) {
            console.log('safeSendToTab: tabId yok');
            if (cb) cb(null);
            return;
        }
        chrome.tabs.sendMessage(tabId, message, function(response) {
            if (chrome.runtime.lastError) {
                // No content script in this tab or other messaging error
                console.log('İçerik scripti yok veya mesaj gönderilemiyor:', chrome.runtime.lastError.message);
                if (cb) cb(null);
                return;
            }
            if (cb) cb(response);
        });
    }

    // Aktif tab'i al ve durumları yükle
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
            currentTabId = tabs[0].id;
            
            // Tab'a özel ayarları yükle
            chrome.storage.local.get(`tab_${currentTabId}`, function(data) {
                const tabSettings = data[`tab_${currentTabId}`] || {};
                toggleSwitch.checked = tabSettings.isEnabled || false;
                refreshToggle.checked = tabSettings.refreshEnabled || false;
                    refreshInterval.value = tabSettings.refreshInterval || 30;
                    filterIdInput.value = tabSettings.filterId || 17639;
                
                updateStatus(toggleSwitch.checked);
                updateRefreshStatus(refreshToggle.checked);

                // Sadece yenileme durumunu başlat, bildirim gönderme
                if (refreshToggle.checked) {
                    sendRefreshStatus(true, refreshInterval.value);
                }
            });
        }

        // Load global notification settings
        chrome.storage.local.get(['notifyThrottleSeconds','onePerCycle'], function(cfg) {
            throttleSecondsInput.value = cfg.notifyThrottleSeconds || 30;
            onePerCycleCheckbox.checked = cfg.onePerCycle === undefined ? true : cfg.onePerCycle;
        });
        // Load ignored list
        loadIgnoredList();

        clearIgnoredBtn.addEventListener('click', function() {
            // Remove all ignored_* keys
            chrome.storage.local.get(null, function(items) {
                const toRemove = Object.keys(items).filter(k => k.startsWith('ignored_'));
                if (toRemove.length === 0) return;
                chrome.storage.local.remove(toRemove, function() {
                    loadIgnoredList();
                });
            });
        });

        saveFilterBtn.addEventListener('click', function() {
            // Save current filter input
            saveTabSettings();
            const id = parseInt(filterIdInput.value) || 17639;
            safeSendToTab(currentTabId, { action: 'updateFilterId', filterId: id, tabId: currentTabId });
            chrome.runtime.sendMessage({ action: 'updateSettings', tabId: currentTabId, settings: { filterId: id } });
        });

        // Save throttle / onePerCycle when changed
        throttleSecondsInput.addEventListener('change', function() {
            const v = parseInt(throttleSecondsInput.value) || 30;
            chrome.storage.local.set({ notifyThrottleSeconds: v });
        });

        onePerCycleCheckbox.addEventListener('change', function() {
            chrome.storage.local.set({ onePerCycle: !!onePerCycleCheckbox.checked });
        });
    });

    // Yenileme aralığı değiştiğinde
    refreshInterval.addEventListener('change', function() {
        const interval = parseInt(refreshInterval.value) || 30;
        refreshInterval.value = interval;
        saveTabSettings();
        
        if (refreshToggle.checked) {
            sendRefreshStatus(true, interval);
        }
    });

    // Yenileme switch'i değiştiğinde
    refreshToggle.addEventListener('change', function() {
        const isEnabled = refreshToggle.checked;
        const interval = parseInt(refreshInterval.value);
        
        console.log('🔄 Yenileme durumu değişiyor:', isEnabled, 'Interval:', interval);
        saveTabSettings();
        updateRefreshStatus(isEnabled);
        
        if (isEnabled) {
            console.log('⏰ Yenileme başlatılıyor...');
        } else {
            console.log('⏹️ Yenileme durduruluyor...');
        }
        
        sendRefreshStatus(isEnabled, interval);
    });

    // Takip switch'i değiştiğinde
    toggleSwitch.addEventListener('change', function() {
        const isEnabled = toggleSwitch.checked;
        const interval = parseInt(refreshInterval.value);
        
        // Ayarları kaydet
        saveTabSettings();
        updateStatus(isEnabled);
        
        // Background script'e bildir
        chrome.runtime.sendMessage({
            type: 'STATUS_CHANGE',
            isEnabled: isEnabled,
            interval: interval,
            tabId: currentTabId,
            message: isEnabled ? 'Jira Takip Eklentisi Aktif Edildi' : 'Jira Takip Eklentisi Kapatıldı',
            details: isEnabled ? 'Atanmamış görevler takip ediliyor' : 'Görev takibi durduruldu'
        });

        // Content script'e bildir
        sendMonitoringStatus(isEnabled);
    });

    // Filter ID değiştiğinde
    filterIdInput.addEventListener('change', function() {
        const id = parseInt(filterIdInput.value) || 17639;
        filterIdInput.value = id;
        saveTabSettings();

        // Notify content and background about new filter id (safely)
        safeSendToTab(currentTabId, {
            action: 'updateFilterId',
            filterId: id,
            tabId: currentTabId
        });

        chrome.runtime.sendMessage({
            action: 'updateSettings',
            tabId: currentTabId,
            settings: { filterId: id }
        });
    });

    function loadIgnoredList() {
        chrome.storage.local.get(null, function(items) {
            const keys = Object.keys(items).filter(k => k.startsWith('ignored_'));
            if (keys.length === 0) {
                ignoredListEl.innerHTML = '<small style="color:#666;">Yok</small>';
                return;
            }

            ignoredListEl.innerHTML = '';
            keys.forEach(k => {
                const issueKey = k.replace('ignored_', '');
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.justifyContent = 'space-between';
                row.style.alignItems = 'center';
                row.style.padding = '4px 0';

                const label = document.createElement('span');
                label.textContent = issueKey;
                label.style.fontSize = '12px';

                const btn = document.createElement('button');
                btn.textContent = 'Geri Al';
                btn.style.padding = '4px 6px';
                btn.style.border = '0';
                btn.style.borderRadius = '6px';
                btn.style.background = '#2196F3';
                btn.style.color = '#fff';
                btn.style.cursor = 'pointer';
                btn.addEventListener('click', function() {
                    chrome.storage.local.remove(k, function() {
                        loadIgnoredList();
                    });
                });

                row.appendChild(label);
                row.appendChild(btn);
                ignoredListEl.appendChild(row);
            });
        });
    }



    function sendMonitoringStatus(isEnabled) {
        safeSendToTab(currentTabId, {
            action: 'toggleMonitoring',
            isEnabled: isEnabled,
            tabId: currentTabId,
            filterId: parseInt(filterIdInput.value) || 17639
        });
    }

    function sendRefreshStatus(isEnabled, interval) {
        // Content script'e mesaj gönder
        safeSendToTab(currentTabId, {
            action: 'updateRefresh',
            isEnabled: isEnabled,
            interval: interval,
            tabId: currentTabId
        });

        // Background script'e de bildir
        chrome.runtime.sendMessage({
            action: 'updateRefresh',
            isEnabled: isEnabled,
            interval: interval,
            tabId: currentTabId
        });
    }


    function saveTabSettings() {
        const settings = {
            isEnabled: toggleSwitch.checked,
            refreshEnabled: refreshToggle.checked,
            refreshInterval: parseInt(refreshInterval.value),
            filterId: parseInt(filterIdInput.value) || 17639
        };
        
        // Storage'a kaydet
        chrome.storage.local.set({
            [`tab_${currentTabId}`]: settings
        }, function() {
            // Background script'e ayarları bildir
            chrome.runtime.sendMessage({
                action: 'updateSettings',
                tabId: currentTabId,
                settings: settings
            });
        });
    }

    function updateStatus(isEnabled) {
        statusText.textContent = isEnabled ? 'Takip Aktif' : 'Takip Devre Dışı';
        statusText.style.color = isEnabled ? '#2196F3' : '#666';
    }

    function updateRefreshStatus(isEnabled) {
        refreshStatus.textContent = isEnabled 
            ? `${refreshInterval.value} saniyede bir yenileniyor`
            : 'Otomatik yenileme kapalı';
    }

    // Her 5 saniyede bir yenileme durumunu kontrol et
    setInterval(() => {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {action: 'checkRefreshStatus'}, function(response) {
                    if (chrome.runtime.lastError) {
                        // Content script yok
                        //console.log('checkRefreshStatus failed:', chrome.runtime.lastError.message);
                        return;
                    }
                    if (response && response.isRefreshing) {
                        console.log('✅ Yenileme aktif çalışıyor');
                    } else {
                        console.log('❌ Yenileme durmuş olabilir');
                    }
                });
            }
        });
    }, 5000);
}); 