let activeTabSettings = {};
// Notification throttle and cycle control
// Defaults (can be overridden by popup settings)
const DEFAULT_NOTIFY_THROTTLE_MS = 30000; // 30 seconds
const cycleAllowed = {}; // filterId -> boolean (true if first notification after countdown is allowed)

async function notifyIssue(filterId, key, summary) {
    try {
        const now = Date.now();

        // Check ignored flag
        const ignoredObj = await chrome.storage.local.get(`ignored_${key}`);
        if (ignoredObj[`ignored_${key}`]) return false;

        // Check per-issue last notified timestamp and configured throttle
        const cfg = await chrome.storage.local.get('notifyThrottleSeconds');
        const throttleSeconds = cfg.notifyThrottleSeconds || Math.floor(DEFAULT_NOTIFY_THROTTLE_MS/1000);
        const throttleMs = throttleSeconds * 1000;

        const lastObj = await chrome.storage.local.get(`lastNotified_${key}`);
        const lastTs = lastObj[`lastNotified_${key}`] || 0;
        if (lastTs && (now - lastTs) < throttleMs) {
            // Too soon since last notification for this issue
            return false;
        }

        // If cycleAllowed for this filter is true, allow first notification and then disable further ones for this cycle
        // Check one-per-cycle setting
        const cycleCfg = await chrome.storage.local.get('onePerCycle');
        const onePerCycle = cycleCfg.onePerCycle === undefined ? true : !!cycleCfg.onePerCycle;

        if (onePerCycle && cycleAllowed[filterId]) {
            cycleAllowed[filterId] = false;
            console.log('notifyIssue: cycleAllowed used for filter', filterId, 'issue', key);
            const notifId = `jiraNotification__${filterId}__${key}__${Date.now()}`;
            chrome.notifications.create(notifId, {
                type: 'basic',
                iconUrl: 'icon.png',
                title: `Yeni Jira: ${key}`,
                message: summary || `Yeni görev: ${key}`,
                contextMessage: `Filter ${filterId}`,
                priority: 2,
                requireInteraction: true,
                buttons: [ { title: 'Aç' }, { title: 'Yoksay' } ]
            });
            const setObj = {};
            setObj[`lastNotified_${key}`] = now;
            await chrome.storage.local.set(setObj);
            return true;
        }

        // Otherwise, use per-issue throttle logic
        if (!lastTs || (now - lastTs) >= throttleMs) {
            const notifId = `jiraNotification__${filterId}__${key}__${Date.now()}`;
            chrome.notifications.create(notifId, {
                type: 'basic',
                iconUrl: 'icon.png',
                title: `Yeni Jira: ${key}`,
                message: summary || `Yeni görev: ${key}`,
                contextMessage: `Filter ${filterId}`,
                priority: 2,
                requireInteraction: true,
                buttons: [ { title: 'Aç' }, { title: 'Yoksay' } ]
            });
            const setObj = {};
            setObj[`lastNotified_${key}`] = now;
            await chrome.storage.local.set(setObj);
            return true;
        }

        return false;
    } catch (err) {
        console.error('notifyIssue error:', err);
        return false;
    }
}

// Arka plan kontrolünü başlat
function startBackgroundCheck() {
    console.log('Arka plan kontrolü başlatılıyor');
    
    // Mevcut alarmı temizle
    chrome.alarms.clearAll();
    
    // Yeni alarm oluştur
    chrome.alarms.create('checkJira', {
        periodInMinutes: 0.25,  // 15 saniye
        delayInMinutes: 0
    }, () => {
        // Alarm oluşturulduğunda hemen ilk kontrolü yap
        checkJiraInBackground();
    });

    // Her 5 dakikada bir alarm durumunu kontrol et
    setInterval(() => {
        chrome.alarms.get('checkJira', alarm => {
            if (!alarm) {
                console.log('Alarm kaybolmuş, yeniden oluşturuluyor');
                chrome.alarms.create('checkJira', {
                    periodInMinutes: 0.25,
                    delayInMinutes: 0
                });
            }
        });
    }, 300000); // 5 dakika
}

// Mesaj dinleyici
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background mesaj aldı:', message);

    if (message.type === 'STATUS_CHANGE') {
        // Tab ayarlarını güncelle
        if (message.tabId) {
            activeTabSettings[message.tabId] = {
                isEnabled: message.isEnabled,
                refreshInterval: message.interval || 30
            };
        }

        // Bildirim gönder
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'Jira Bildirimi',
            message: message.message,
            contextMessage: message.details,
            requireInteraction: false,
            priority: 0
        });

        // Hemen kontrol yap
        if (message.isEnabled) {
            checkJiraInBackground();
        }
    }
    else if (message.type === 'NEW_TASK') {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'icon.png',
            title: 'Jira Bildirimi',
            message: message.message,
            contextMessage: message.details,
            requireInteraction: true,
            priority: 2
        });
    }
    else if (message.action === 'runFilterCheck' && message.filterId) {
        // Run an immediate check for the provided filterId (called from content when DOM lookup fails)
        runFilterCheck(parseInt(message.filterId));
        sendResponse({ started: true });
        return true;
    }
    else if (message.action === 'countdownFinished' && message.filterId) {
        // Allow one notification for this filter cycle
        try {
            cycleAllowed[message.filterId] = true;
            console.log('countdownFinished: cycleAllowed set for filter', message.filterId);
        } catch (e) {
            console.error('countdownFinished handler error:', e);
        }
    }
    else if (message.type === 'UPDATE_COUNTDOWN') {
        // Geri sayım güncellemesi
        if (message.remainingTime !== '') {
            chrome.action.setBadgeText({ text: message.remainingTime.toString() });
            chrome.action.setBadgeBackgroundColor({ color: '#2196F3' });
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    }
    else if (message.action === 'getTabId') {
        sendResponse({ tabId: sender.tab ? sender.tab.id : null });
        return true;
    }
});

// Jira kontrolü yapan fonksiyon
async function checkJiraInBackground() {
    try {
        console.log('Arka planda kontrol başlatıldı');
        
        // Tüm kayıtlı ayarları kontrol et
        const data = await chrome.storage.local.get(null);
        let hasActiveMonitoring = false;
        
        // Aktif monitoring var mı kontrol et
        Object.keys(data).forEach(key => {
            if (key.startsWith('tab_')) {
                const settings = data[key];
                if (settings.isEnabled) {
                    hasActiveMonitoring = true;
                }
            }
        });
        
        // Eğer aktif monitoring varsa kontrol yap
        if (hasActiveMonitoring) {
            try {
                // Fetch kullanarak istek yap
                const response = await fetch('https://jira.com.tr/secure/Dashboard.jspa', {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const text = await response.text();

                // HTML içeriğini regex ile kontrol et
                // Collect unique filter IDs from tab_* settings that are enabled
                const enabledFilterIds = new Set();
                Object.keys(data).forEach(key => {
                    if (key.startsWith('tab_')) {
                        const settings = data[key];
                        if (settings.isEnabled) {
                            enabledFilterIds.add(settings.filterId || 17639);
                        }
                    }
                });

                // For each enabled filter id, parse the HTML and check the badge
                for (const filterId of enabledFilterIds) {
                    try {
                        const re = new RegExp(`td[^>]*data-filter-id="${filterId}"[^>]*>.*?<aui-badge[^>]*>(.*?)<\\/aui-badge>`, 'i');
                        const match = text.match(re);
                        if (!match) {
                            console.log(`Element bulunamadı (filterId=${filterId})`);
                            continue;
                        }

                        const value = match[1].trim();
                        const currentCount = parseInt(value) || 0;
                        console.log('🔍 Arka planda kontrol (filterId=' + filterId + '):', currentCount);

                        // Get previous count for this filter
                        const lastCountObj = await chrome.storage.local.get(`lastCount_${filterId}`);
                        const previousCount = lastCountObj[`lastCount_${filterId}`] || 0;

                        if (currentCount > 0) {
                            // Additionally fetch issue details via REST API to identify new issues
                            try {
                                const searchUrl = `https://jira.com.tr/rest/api/2/search?jql=filter=${filterId}&fields=key,summary&maxResults=50`;
                                const apiResp = await fetch(searchUrl, { method: 'GET', credentials: 'include', cache: 'no-store' });
                                if (apiResp && apiResp.ok) {
                                    const json = await apiResp.json();
                                    const issues = Array.isArray(json.issues) ? json.issues : [];

                                    // Load previous known issues for this filter
                                    const prevObj = await chrome.storage.local.get(`lastIssues_${filterId}`);
                                    const prevIssues = prevObj[`lastIssues_${filterId}`] || [];

                                    // For each issue, if not ignored, notify respecting per-issue throttle and per-cycle limit
                                    for (const issue of issues) {
                                        const key = issue.key;
                                        const summary = issue.fields && issue.fields.summary ? issue.fields.summary : '';
                                        await notifyIssue(filterId, key, summary);
                                    }

                                    // Update stored list of known issues for this filter
                                    const newKeys = issues.map(i => i.key);
                                    const setObj = {};
                                    setObj[`lastIssues_${filterId}`] = newKeys;
                                    await chrome.storage.local.set(setObj);
                                } else {
                                    console.log('REST API çağrısı başarısız veya yetki yok:', apiResp && apiResp.status);
                                }
                            } catch (err) {
                                console.error('Issue fetch hatası:', err);
                            }
                        }
                    } catch (err) {
                        console.error('Filter check hatası (filterId=' + filterId + '):', err);
                    }
                }
            } catch (error) {
                console.error('Fetch veya parse hatası:', error);
                // Hata durumunda 30 saniye sonra tekrar dene
                setTimeout(checkJiraInBackground, 30000);
            }
        }
    } catch (error) {
        console.error('Kontrol hatası:', error);
    }
}

// Run a REST-based check for a single filter id and notify for new issues
async function runFilterCheck(filterId) {
    try {
        console.log('runFilterCheck çağrıldı for filterId=', filterId);
        const searchUrl = `https://jira.com.tr/rest/api/2/search?jql=filter=${filterId}&fields=key,summary&maxResults=50`;
        const apiResp = await fetch(searchUrl, { method: 'GET', credentials: 'include', cache: 'no-store' });
        if (!apiResp.ok) {
            console.log('runFilterCheck: API çağrısı başarısız, status=', apiResp.status);
            return;
        }

        const json = await apiResp.json();
        const issues = Array.isArray(json.issues) ? json.issues : [];

        const prevObj = await chrome.storage.local.get(`lastIssues_${filterId}`);
        const prevIssues = prevObj[`lastIssues_${filterId}`] || [];

        for (const issue of issues) {
            const key = issue.key;
            const summary = issue.fields && issue.fields.summary ? issue.fields.summary : '';
            await notifyIssue(filterId, key, summary);
        }

        const newKeys = issues.map(i => i.key);
        const setObj = {};
        setObj[`lastIssues_${filterId}`] = newKeys;
        await chrome.storage.local.set(setObj);
    } catch (err) {
        console.error('runFilterCheck hatası:', err);
    }
}

// Alarm tetiklendiğinde
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkJira') {
        console.log('Alarm tetiklendi, kontrol yapılıyor');
        checkJiraInBackground();
    }
});

// Service worker'ı canlı tutmak için
let isServiceWorkerActive = false;

chrome.runtime.onConnect.addListener(function(port) {
    if (port.name === 'keepAlive') {
        console.log('Content script bağlandı');
        isServiceWorkerActive = true;
        
        port.onDisconnect.addListener(function() {
            console.log('Content script bağlantısı koptu');
            isServiceWorkerActive = false;
        });
    }
});

// Periyodik kontrol
setInterval(() => {
    if (!isServiceWorkerActive) {
        console.log('Service worker yeniden aktifleştiriliyor...');
        startBackgroundCheck();
    }
}, 25000);

// Eklenti yüklendiğinde/güncellendiğinde
chrome.runtime.onInstalled.addListener(() => {
    console.log('Eklenti yüklendi/güncellendi');
    startBackgroundCheck();
});

// Chrome başlatıldığında
chrome.runtime.onStartup.addListener(() => {
    console.log('Chrome başlatıldı');
    startBackgroundCheck();
});

// Bildirim gönderme fonksiyonu
async function sendNotification(title, message, details, requireInteraction = false) {
    try {
        const notificationOptions = {
            type: 'basic',
            iconUrl: 'icon.png',
            title: title,
            message: message,
            contextMessage: details,
            requireInteraction: requireInteraction,
            priority: 2,
            silent: false,
            buttons: [{ title: 'Jira\'yı Aç' }]
        };

        // Chrome bildirimi oluştur
        await chrome.notifications.create('jiraNotification_' + Date.now(), notificationOptions);
        
    } catch (error) {
        console.error('Bildirim gönderme hatası:', error);
    }
}

// Bildirim tıklama olaylarını güncelle
chrome.notifications.onClicked.addListener((notificationId) => {
    // If notificationId encodes issue key, open that issue; otherwise open dashboard
    try {
        if (notificationId && notificationId.startsWith('jiraNotification__')) {
            const parts = notificationId.split('__');
            // jiraNotification__<filterId>__<issueKey>__<ts>
            if (parts.length >= 4) {
                const issueKey = parts[2];
                openIssueTab(issueKey);
                return;
            }
        }
    } catch (e) {
        console.error('Notification click parse error:', e);
    }
    openJiraTab();
});

chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    try {
        // Button index 0: Aç, Button index 1: Yoksay
        if (notificationId && notificationId.startsWith('jiraNotification__')) {
            const parts = notificationId.split('__');
            // jiraNotification__<filterId>__<issueKey>__<ts>
            if (parts.length >= 4) {
                const issueKey = parts[2];
                if (buttonIndex === 0) {
                    openIssueTab(issueKey);
                    return;
                } else if (buttonIndex === 1) {
                    // Mark issue as ignored
                    const key = `ignored_${issueKey}`;
                    const obj = {};
                    obj[key] = true;
                    chrome.storage.local.set(obj, () => {
                        console.log('Issue yoksayıldı:', issueKey);
                    });
                    // Optionally clear the notification
                    try { chrome.notifications.clear(notificationId); } catch (e) {}
                    return;
                }
            }
        }

        // Fallback: open dashboard for first button
        if (buttonIndex === 0) openJiraTab();
    } catch (err) {
        console.error('Notification button handler error:', err);
    }
});

function openIssueTab(issueKey) {
    const url = `https://jira.com.tr/browse/${issueKey}`;
    chrome.tabs.create({ url: url, active: true });
}

// Jira'yı açma fonksiyonu
function openJiraTab() {
    chrome.tabs.create({
        url: 'https://jira.com.tr/secure/Dashboard.jspa',
        active: true // Tab'i aktif yap
    });
}

// Tab kapatıldığında ayarları temizle
chrome.tabs.onRemoved.addListener((tabId) => {
    delete activeTabSettings[tabId];
});

// Tab güncellendiğinde ayarları koru
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url.includes('jira.com.tr')) {
        const settings = activeTabSettings[tabId];
        if (settings) {
            // Ayarları geri yükle
            chrome.tabs.sendMessage(tabId, {
                action: 'restoreSettings',
                settings: settings
            }).catch(() => {
                console.log('Tab henüz hazır değil');
            });
        }
    }
});