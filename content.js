let isMonitoringEnabled = false;
let refreshInterval = null;

// Yenileme durumunu kontrol eden zamanlayıcı
let heartbeatInterval = null;

let lastCount = 0; // Son kontrol edilen değeri sakla
let monitoredFilterId = 17639; // Default filter id, can be updated from popup

console.log('Content script yüklendi');

function sendMessageToBackground(message) {
    try {
        chrome.runtime.sendMessage(message).catch(error => {
            console.log('Mesaj gönderme hatası yakalandı, yeniden deneniyor...');
            // Hata durumunda 1 saniye bekleyip tekrar dene
            setTimeout(() => {
                chrome.runtime.sendMessage(message).catch(error => {
                    console.error('İkinci deneme başarısız:', error);
                });
            }, 1000);
        });
    } catch (error) {
        console.error('Kritik mesaj gönderme hatası:', error);
    }
}

function checkJiraTask() {
    console.log('🔍 Yeni görev kontrolü başlatıldı');
    
    try {
    const selector = `td.counts[data-filter-id="${monitoredFilterId}"] aui-badge`;
    const countElement = document.querySelector(selector);
    console.log('🔎 Element aranıyor (selector):', selector, countElement ? 'Element bulundu' : 'Element bulunamadı');

        if (!countElement) {
            console.log('❌ Element bulunamadı! Kontrol yapılamıyor');
            // Eğer DOM elemanı bulunamıyorsa arka plana REST tabanlı bir kontrol yapması için talep gönder
            try {
                chrome.runtime.sendMessage({ action: 'runFilterCheck', filterId: monitoredFilterId });
            } catch (e) {
                console.log('runFilterCheck mesajı gönderilemedi:', e);
            }
            return;
        }

        const currentCount = parseInt(countElement.textContent.trim()) || 0;    
        console.log('📊 Element değeri:', currentCount, 'Önceki değer:', lastCount);

        // Değer değiştiyse veya ilk kontrolse ve monitoring aktifse, arka plana sayıyı bildir (background kendi bildirimlerini yapar)
        if (isMonitoringEnabled && (currentCount !== lastCount)) {
            try {
                sendMessageToBackground({
                    type: 'COUNT_CHANGE',
                    filterId: monitoredFilterId,
                    count: currentCount
                });
            } catch (e) {
                console.log('COUNT_CHANGE mesajı gönderilemedi:', e);
            }
        }

        // Son değeri güncelle
        lastCount = currentCount;
    } catch (error) {
        console.error('Kontrol hatası:', error);
    }
}

function updateCountdown(remainingTime) {
    try {
        chrome.runtime.sendMessage({
            type: 'UPDATE_COUNTDOWN',
            remainingTime: remainingTime
        }).catch(error => {
            console.log('Geri sayım güncellemesi başarısız, önemsiz hata');
        });
    } catch (error) {
        console.log('Geri sayım hatası, devam ediliyor');
    }
}

function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
        if (!refreshInterval) {
            console.log('💔 Yenileme durmuş, yeniden başlatılıyor...');
            restartRefresh();
        }
    }, 5000); // Her 5 saniyede bir kontrol et
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

function restartRefresh() {
    // Mevcut ayarları al
    chrome.storage.local.get(null, function(data) {
        chrome.runtime.sendMessage({ action: 'getTabId' }, function(response) {
            if (response && response.tabId) {
                const tabId = response.tabId;
                const tabSettings = data[`tab_${tabId}`] || {};
                
                if (tabSettings.refreshEnabled) {
                    console.log('🔄 Yenileme yeniden başlatılıyor...');
                    startRefreshTimer(tabSettings.refreshInterval || 30);
                    // Hemen bir kontrol yap
                    checkJiraTask();
                }
            }
        });
    });
}

function startRefreshTimer(interval) {
    console.log('⏰ Yenileme zamanlayıcısı başlatılıyor:', interval, 'saniye');
    stopRefreshTimer();
    startHeartbeat();

    try {
        let remainingTime = interval;
        console.log('⏰ Geri sayım başlatılıyor. Başlangıç:', remainingTime);

        async function refresh() {
            try {
                // Eklenti bağlamı kontrolü
                if (!chrome.runtime?.id) {
                    console.log('Eklenti bağlamı geçersiz, yeniden başlatılıyor...');
                    stopRefreshTimer();
                    await restartExtension();
                    return;
                }

                console.log('⏱️ Zamanlayıcı çalışıyor. Kalan süre:', remainingTime);
                
                // Geri sayımı güncelle
                try {
                    await updateCountdown(remainingTime);
                } catch (error) {
                    console.log('Geri sayım güncellemesi başarısız:', error);
                }

                // Süre dolduğunda sayfayı yenile
                if (remainingTime <= 0) {
                    console.log('🔄 Süre doldu! Sayfa yenileme başlıyor...');
                    
                    try {
                        // Bildir: geri sayım tamamlandı (background bu cycle için 1 bildirim izni verebilir)
                        try {
                            chrome.runtime.sendMessage({ action: 'countdownFinished', filterId: monitoredFilterId });
                        } catch (e) {
                            console.log('countdownFinished mesajı gönderilemedi:', e);
                        }

                        // Kısa gecikme ver, mesajın iletilmesi için
                        await new Promise(resolve => setTimeout(resolve, 200));

                        // Yenileme öncesi son bir kontrol yap
                        await checkJiraTask();
                        
                        // Ayarları sakla
                        await new Promise((resolve) => {
                            chrome.runtime.sendMessage({ action: 'getTabId' }, async function(response) {
                                if (chrome.runtime.lastError) {
                                    console.log('Tab ID alınamadı:', chrome.runtime.lastError);
                                    resolve();
                                    return;
                                }

                                if (response && response.tabId) {
                                            const currentSettings = {
                                                isEnabled: isMonitoringEnabled,
                                                refreshEnabled: true,
                                                refreshInterval: interval,
                                                filterId: monitoredFilterId
                                            };

                                    try {
                                        await chrome.storage.local.set({
                                            [`tab_${response.tabId}`]: currentSettings
                                        });
                                    } catch (error) {
                                        console.error('Ayarlar kaydedilemedi:', error);
                                    }
                                }
                                resolve();
                            });
                        });
                        
                        // Sayfayı yenile
                        window.location.reload();
                        return;
                    } catch (error) {
                        console.error('Yenileme hatası:', error);
                        // Hata durumunda 5 saniye bekle ve tekrar dene
                        remainingTime = 5;
                    }
                }

                remainingTime--;
                
                // Sonraki kontrolü planla
                if (chrome.runtime?.id) {
                    refreshInterval = setTimeout(refresh, 1000);
                } else {
                    console.log('Eklenti bağlamı kayboldu, yenileme durduruluyor');
                    stopRefreshTimer();
                    await restartExtension();
                }
            } catch (error) {
                console.error('Yenileme döngüsü hatası:', error);
                if (chrome.runtime?.id) {
                    setTimeout(refresh, 3000);
                } else {
                    stopRefreshTimer();
                    await restartExtension();
                }
            }
        }

        // İlk yenilemeyi başlat
        refresh();
        console.log(`✅ Zamanlayıcı kurulumu tamamlandı. Her ${interval} saniyede bir yenilenecek`);
    } catch (error) {
        console.error('Zamanlayıcı başlatma hatası:', error);
        stopHeartbeat();
    }
}

function stopRefreshTimer() {
    stopHeartbeat();
    if (refreshInterval) {
        console.log('⏹️ Yenileme zamanlayıcısı durduruluyor...');
        clearTimeout(refreshInterval);
        refreshInterval = null;
        
        // Badge'i temizle
        try {
            chrome.runtime.sendMessage({
                type: 'UPDATE_COUNTDOWN',
                remainingTime: ''
            });
        } catch (error) {
            console.error('Badge temizleme hatası:', error);
        }
        
        console.log('✅ Yenileme zamanlayıcısı başarıyla durduruldu');
    } else {
        console.log('ℹ️ Durduralacak zamanlayıcı bulunamadı');
    }
}

// Content script yüklendiğinde background service worker'ı canlı tut
function keepAlive() {
    let port = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;
    let isConnecting = false;
    let reconnectTimer = null;

    function connect() {
        if (isConnecting || !chrome.runtime?.id) {
            console.log('Bağlantı kurulmuyor: Zaten bağlanıyor veya eklenti bağlamı geçersiz');
            return;
        }

        try {
            if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                console.log('Maksimum yeniden bağlanma denemesi aşıldı');
                // Sayfayı yenilemek yerine ayarları sıfırla ve yeniden başlat
                reconnectAttempts = 0;
                restartExtension();
                return;
            }

            isConnecting = true;
            port = chrome.runtime.connect({name: 'keepAlive'});
            console.log('Background script\'e bağlanıldı');
            
            port.onDisconnect.addListener(() => {
                const error = chrome.runtime.lastError;
                console.log('Bağlantı koptu:', error?.message || 'Bilinmeyen hata');
                
                port = null;
                isConnecting = false;

                // Extension context invalidated hatası kontrolü
                if (!chrome.runtime?.id) {
                    console.log('Eklenti bağlamı geçersiz, yeniden başlatılıyor...');
                    restartExtension();
                    return;
                }

                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
                
                // Önceki zamanlayıcıyı temizle
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                }
                
                // Yeni bağlantı denemesi planla
                reconnectTimer = setTimeout(() => {
                    connect();
                }, delay);
            });

            // Başarılı bağlantı sonrası
            reconnectAttempts = 0;
            startHeartbeat();

        } catch (error) {
            console.error('Bağlantı hatası:', error);
            isConnecting = false;

            if (!chrome.runtime?.id) {
                restartExtension();
                return;
            }

            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
            
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }
            
            reconnectTimer = setTimeout(connect, delay);
        }
    }

    function startHeartbeat() {
        const heartbeatInterval = setInterval(() => {
            if (!port || !chrome.runtime?.id) {
                clearInterval(heartbeatInterval);
                return;
            }

            try {
                port.postMessage({type: 'heartbeat'});
            } catch (error) {
                console.log('Heartbeat başarısız:', error);
                clearInterval(heartbeatInterval);
                if (port) {
                    try {
                        port.disconnect();
                    } catch (e) {
                        console.log('Port kapatma hatası:', e);
                    }
                }
                port = null;
                connect();
            }
        }, 15000);
    }

    function restartExtension() {
        console.log('Eklenti yeniden başlatılıyor...');
        
        // Tüm zamanlayıcıları temizle
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }
        
        // Mevcut portu temizle
        if (port) {
            try {
                port.disconnect();
            } catch (e) {
                console.log('Port kapatma hatası:', e);
            }
        }

        // Ayarları sıfırla
        isConnecting = false;
        port = null;
        reconnectAttempts = 0;

        // 2 saniye sonra yeniden başlat
        setTimeout(() => {
            console.log('Yeniden başlatma girişimi...');
            connect();
            initializeSettings();
        }, 2000);
    }

    // İlk bağlantıyı başlat
    connect();

    // Sayfa kapatılırken temizlik yap
    window.addEventListener('beforeunload', () => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }
        if (port) {
            try {
                port.disconnect();
            } catch (error) {
                console.log('Port kapatma hatası:', error);
            }
        }
    });
}

// Sayfa yüklendiğinde ayarları yükle ve yenilemeyi başlat
function initializeSettings() {
    console.log('📄 Ayarlar yükleniyor...');
    
    // Tab ID'yi al ve ayarları yükle
    chrome.runtime.sendMessage({ action: 'getTabId' }, function(response) {
        if (response && response.tabId) {
            chrome.storage.local.get(`tab_${response.tabId}`, function(data) {
                const settings = data[`tab_${response.tabId}`] || {};
                isMonitoringEnabled = settings.isEnabled || false;
                monitoredFilterId = settings.filterId || monitoredFilterId;
                
                console.log('📊 Yüklenen ayarlar:', settings);
                
                // Eğer yenileme aktifse başlat
                if (settings.refreshEnabled) {
                    console.log('🔄 Otomatik yenileme başlatılıyor...');
                    startRefreshTimer(settings.refreshInterval || 30);
                }
                
                // İlk kontrolü yap
                if (isMonitoringEnabled) {
                    checkJiraTask();
                }
            });
        }
    });
}

// Sayfa yüklendiğinde keepAlive'ı ve ayarları başlat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            keepAlive();
            initializeSettings();
        }, 1000);
    });
} else {
    setTimeout(() => {
        keepAlive();
        initializeSettings();
    }, 1000);
}

// DOMContentLoaded event listener'ı güncelle
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM yüklendi');
    // checkJiraTask artık initializeSettings içinde çağrılacak
});

// Yenileme durumunu kontrol eden fonksiyon
function checkRefreshStatus() {
    if (refreshInterval) {
        console.log('⏰ Yenileme zamanlayıcısı aktif');
        return true;
    }
    console.log('⏰ Yenileme zamanlayıcısı pasif');
    return false;
}

// Mesaj dinleyicisine yeni bir kontrol ekleyelim
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('📨 Yeni mesaj alındı:', message);

    if (message.action === 'checkRefreshStatus') {
        const status = checkRefreshStatus();
        sendResponse({ isRefreshing: status });
        return true;
    }

    if (message.action === 'checkJiraTask') {
        console.log('🔍 Manuel kontrol isteği alındı');
        checkJiraTask();
    }
    else if (message.action === 'toggleMonitoring') {
        isMonitoringEnabled = message.isEnabled;
        console.log(`${isMonitoringEnabled ? '▶️' : '⏹️'} Monitoring durumu değişti:`, isMonitoringEnabled);
        
        // Durum değişikliği bildirimi
        chrome.runtime.sendMessage({
            type: 'STATUS_CHANGE',
            message: isMonitoringEnabled ? 'Jira Takip Eklentisi Aktif Edildi' : 'Jira Takip Eklentisi Kapatıldı',
            details: isMonitoringEnabled ? 'Atanmamış görevler takip ediliyor' : 'Görev takibi durduruldu',
            isEnabled: isMonitoringEnabled
        });

        // Aktif edildiğinde hemen kontrol et
        if (isMonitoringEnabled) {
            console.log('🔄 İlk kontrol yapılıyor...');
            checkJiraTask();
        }
    }
    else if (message.action === 'updateRefresh') {
        console.log('⚙️ Yenileme ayarları güncelleniyor:', message);
        if (message.isEnabled) {
            startRefreshTimer(message.interval);
        } else {
            stopRefreshTimer();
        }
    }

    if (message.action === 'updateFilterId') {
        console.log('⚙️ Filter ID güncelleniyor:', message.filterId);
        monitoredFilterId = parseInt(message.filterId) || 17639;
        // Update stored settings for this tab as well
        chrome.runtime.sendMessage({ action: 'getTabId' }, function(response) {
            if (response && response.tabId) {
                chrome.storage.local.get(`tab_${response.tabId}`, function(data) {
                    const settings = data[`tab_${response.tabId}`] || {};
                    settings.filterId = monitoredFilterId;
                    chrome.storage.local.set({ [`tab_${response.tabId}`]: settings });
                });
            }
        });

        // Immediately run a check with new filter id
        if (isMonitoringEnabled) {
            checkJiraTask();
        }
    }

    if (message.action === 'restoreSettings') {
        console.log('⚙️ Ayarlar geri yükleniyor:', message.settings);
        isMonitoringEnabled = message.settings.isEnabled;
        monitoredFilterId = message.settings.filterId || monitoredFilterId;
        if (message.settings.refreshEnabled) {
            startRefreshTimer(message.settings.refreshInterval || 30);
        }
        // Hemen kontrol yap
        checkJiraTask();
    }

    sendResponse({ success: true });
    return true;
});

// DOM değişikliklerini izle
const observer = new MutationObserver(() => {
    if (isMonitoringEnabled) {
        checkJiraTask();
    }
});

// Gözlemlemeye başla
observer.observe(document.body, {
    childList: true,
    subtree: true
});

console.log('Content script kurulumu tamamlandı');

// Eklentiyi yeniden başlatma fonksiyonu
async function restartExtension() {
    console.log('Eklenti yeniden başlatılıyor...');
    
    // Tüm zamanlayıcıları temizle
    stopRefreshTimer();
    stopHeartbeat();
    
    // 2 saniye bekle
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
        // Ayarları yeniden yükle ve başlat
        await initializeSettings();
        console.log('Eklenti başarıyla yeniden başlatıldı');
    } catch (error) {
        console.error('Yeniden başlatma hatası:', error);
        // Sayfayı yenilemeyi dene
        window.location.reload();
    }
}

// UpdateCountdown fonksiyonunu güncelle
async function updateCountdown(remainingTime) {
    if (!chrome.runtime?.id) {
        throw new Error('Eklenti bağlamı geçersiz');
    }

    try {
        await chrome.runtime.sendMessage({
            type: 'UPDATE_COUNTDOWN',
            remainingTime: remainingTime
        });
    } catch (error) {
        console.log('Geri sayım güncellemesi başarısız:', error);
        throw error;
    }
}