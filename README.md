# Nöbet Planlayıcı

Hemşireler için aylık hastane nöbet çizelgesi oluşturan bir web uygulaması. Sunucusu yok: personel, ayarlar ve çizelgeler tarayıcıda (`localStorage`) saklanır, bu yüzden her cihazın ve tarayıcının kendi verisi olur.

- Herkesin saat hedefini 24 ve 16 saatlik nöbetlerle tam tutturur. Nöbet ertesi gün boş kalır; izinlere ve "birlikte / ayrı çalışma" tercihlerine uyar.
- Kalabalık günleri herkese eşit paylaştırır ve her kişinin gerçek yükünü gösterir.
- Çizelge elle düzenlenebilir, Excel (CSV) ve yazdırılabilir PDF olarak indirilebilir.

## Çalıştırma

Node.js 22 veya üstü gerekir.

```sh
npm i
npm run dev
```

Ardından http://localhost:8080 adresini açın. Geliştirme sunucusu tüm ağ arayüzlerini dinler. Aynı ağdaki ya da Tailscale'deki bir telefondan `http://<bilgisayarın-ip-adresi>:8080` ile de açılabilir.

## Kontroller

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

GitHub Actions bunları her push'ta ve pull request'te çalıştırır.

## Teknolojiler

Vite, React, TypeScript, Tailwind CSS ve shadcn/ui.
