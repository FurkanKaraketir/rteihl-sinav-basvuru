# RTE Proje İHL — Sınav Başvuru Sistemi

SvelteKit (static) + Firebase (Firestore, Auth, Storage, Hosting).

## Kurulum

```bash
npm install
cp env.template .env   # Firebase web config değerlerini girin
npm run dev
```

## Güvenlik modeli

- **Yöneticiler**: Firebase Auth'ta hesap açmak yetmez. Yönetici olması için
  Firestore'da `admins/{uid}` belgesi bulunmalıdır (içeriği önemsiz, ör. `{ "email": "..." }`).
  Bu belgeleri yalnızca Firebase konsolundan ekleyin.
- **Başvurular**: Form, tek bir transaction ile başvuruyu, salondaki öğrenci kaydını ve
  salonun `studentCount` sayacını birlikte yazar. Kurallar (`firestore.rules`) her adımı doğrular;
  ziyaretçiler diğer öğrencileri listeleyemez.
- **Sonuçlar**: Excel dosyası asla `static/` klasörüne konmaz. Yönetici paneli → Sistem Ayarları →
  Sonuç Dosyası Yönetimi'nden yüklenir; her satır `results/{sha256(yıl:TC:telefon)}` belgesine yazılır.
  Öğrenci sonucunu yalnızca T.C. + başvurudaki telefonla, `resultsReleaseAt` saatinden sonra
  ve sonuç sistemi açıkken görebilir (Google sunucu saatine göre).
- Kişisel veri içeren dosyalar `private-data/` altında tutulur; `.gitignore` bunları ve tüm
  `.xlsx/.csv` dosyalarını hariç tutar.

## Dağıtım (deploy)

1. Firebase konsolu → Firestore → `admins` koleksiyonuna kendi kullanıcı UID'nizle bir belge ekleyin.
   **Bunu kurallardan önce yapın**, yoksa yönetici paneline erişemezsiniz.
2. Firebase konsolu → Authentication → Settings → *User actions*: "Enable create (sign-up)"
   seçeneğini kapatın.
3. Kuralları test edin (Java 21 gerekir): `npm run test:rules`
4. Yayınlayın:
   ```bash
   npm run build
   firebase deploy --only firestore:rules,storage,hosting
   ```
5. Yönetici panelinde **Sistem Ayarları → Tarih Ayarlarını Kaydet**'e bir kez basın
   (kurallar için gereken `applicationStartAt / applicationDeadlineAt / resultsReleaseAt`
   zaman damgaları bu kayıtla oluşur), ardından Başvurular sayfasını bir kez açın: salon
   sayaçları ve mevcut başvuruların giriş belgesi kopyaları (`entryDocs`) oluşturulur.
   **Bunu yapmadan önce mevcut başvuru sahipleri giriş belgesini göremez.**
6. Sonuç dosyasını panelden yükleyin; eşleşmeyen satırlar ekranda listelenir.

## Sınav giriş belgesi

`examApplications` yalnızca yöneticiye açıktır. Başvuru sahibi giriş belgesini
`entryDocs/{sha256("rteihl-entry:v1:" + T.C. + ":" + telefon)}` kopyasından, T.C. **ve**
başvurudaki telefonla görür. Form bu kopyayı başvuruyla aynı transaction içinde yazar; kurallar
hash'i kendisi hesaplayıp doğrular.

## Bilinen kısıtlar

- Yönetici araçları başvuruları ve salon öğrencilerini doğrudan değiştirir. `studentCount`
  sayaçları ve `entryDocs` kopyaları, yönetici sayfaları (Başvurular, Sınav Salonları) açıldığında
  `syncHallCounts()` / `syncEntryDocs()` ile yeniden eşitlenir. Bir değişiklikten sonra Başvurular
  sayfası yenilenene kadar öğrenci eski giriş bilgisini görebilir.
- Başvuru formundaki mükerrer kontrol, bir T.C. ile başvuru yapılıp yapılmadığını (yalnızca var/yok)
  ortaya çıkarır; başvuru içeriğine erişim yoktur.
