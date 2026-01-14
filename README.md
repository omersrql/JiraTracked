# Jira Görev Takipçisi Chrome Eklentisi

Bu Chrome eklentisi, Jira üzerindeki atanmamış görevleri otomatik olarak takip eder ve yeni görevler olduğunda bildirim gönderir.

## 🚀 Özellikler

### Ana Özellikler
- 🔄 Otomatik sayfa yenileme
- 🔔 Masaüstü bildirimleri
- 👀 Atanmamış görev takibi
- ⚡ Arka planda çalışma
- 🎛️ Sekme bazlı ayarlar

### Detaylı Özellikler
1. **Otomatik Yenileme**
   - Özelleştirilebilir yenileme aralığı (15-3600 saniye)
   - Yenileme durumu göstergesi
   - Geri sayım badge'i

2. **Bildirim Sistemi**
   - Etkileşimli masaüstü bildirimleri
   - Tek tıkla Jira'ya erişim
   - Sesli bildirimler

3. **Monitoring**
   - Sekme bazlı izleme ayarları
   - Arka plan kontrolü (15 saniyede bir)
   - DOM değişikliklerini anlık takip

## ⚙️ Ayarlar

### Popup Ayarları
- `toggleSwitch`: Takip sistemini açma/kapama
- `refreshToggle`: Otomatik yenilemeyi açma/kapama
- `refreshInterval`: Yenileme aralığı (saniye)

## 🔍 Hata Yakalama

Eklenti aşağıdaki durumlarda otomatik olarak kendini düzeltir:
- Bağlantı kopması
- Sayfa yenileme hataları
- Element bulunamama durumları
- Mesaj iletim hataları

## 📝 Notlar

1. Eklenti Chrome açık olduğu sürece arka planda çalışır
2. Sekme kapalı olsa bile kontroller devam eder
3. Ayarlar tarayıcı kapatılsa bile saklanır
4. Her sekme için ayrı ayarlar tutulur

## ⚠️ Sınırlamalar

- Sadece Chrome tarayıcısında çalışır
- Jira oturumu açık olmalıdır
- İnternet bağlantısı gerektirir
- Chrome'un arka planda çalışıyor olması gerekir

## 🔄 Versiyon Geçmişi

### v1.0
- İlk sürüm
- Temel takip özellikleri
- Otomatik yenileme sistemi
- Bildirim sistemi

### Storage Ayarları

javascript
// Tab bazlı ayarlar örneği
{
"tab_123": {
"isEnabled": true, // Takip durumu
"refreshEnabled": true, // Yenileme durumu
"refreshInterval": 30, // Yenileme aralığı
"filterId": 17639 // İzlenecek Jira filter ID (eklentiden değiştirilebilir)
}
}


### Sistem Değişkenleri

javascript
// Background.js
let activeTabSettings = {}; // Aktif tab ayarları
let lastCount = 0; // Son kontrol edilen değer
// Content.js
let isMonitoringEnabled = false;
let refreshInterval = null;
let heartbeatInterval = null;

### Zamanlayıcılar
- Arka plan kontrolü: 15 saniye
- Heartbeat kontrolü: 5 saniye
- Yenileme aralığı: Kullanıcı tanımlı (varsayılan: 30 saniye)


## 🛠️ Teknik Detaylar

### Kontrol Edilen Element

javascript
// Jira'da kontrol edilen element (filter id istenirse değiştirilebilir)
td.counts[data-filter-id="<FILTER_ID>"] aui-badge

### Manifest Ayarları

json
{
"permissions": [
"notifications",
"storage",
"tabs",
"webRequest",
"alarms",
"background"
],
"host_permissions": [
"://jira.com.tr/"
]
}