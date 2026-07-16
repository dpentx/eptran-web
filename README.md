# novel-site

eptran çıktılarını okunabilir bir Astro sitesine dönüştürür. Veri akışı
tamamen `ononoki-dp` botu üzerinden yürür — bu site hiçbir zaman doğrudan
eptran reposuna yazmaz, sadece botla HTTP üzerinden konuşur.

```
eptran repo (output/ değişir)
        │  GitHub Actions
        ▼
   ononoki-dp bot ── POST /api/ingest ──► bu site (Turso DB'ye yazar)
        ▲
        │  GET /api/suggestions?status=pending
        │  (Bearer INGEST_SECRET)
        │
   bekleyen typo/bağlam önerilerini alır, eptran reposuna PR açar
```

## Kurulum

1. `cp .env.example .env` doldur (Turso DB + `INGEST_SECRET`)
2. `npm install`
3. `npm run db:push` — şemayı Turso'ya uygular
4. `npm run dev`

## `/api/ingest` sözleşmesi

`ononoki-dp` botu, eptran'ın `output/<kitap-adi>/` klasörü her değiştiğinde
`multipart/form-data` ile buraya POST atar:

| alan | açıklama |
|---|---|
| `sourceKey` | `output/` altındaki klasör adı, novel eşleştirme anahtarı |
| `title`, `author`, `description` | novel metadata |
| `format` | `"epub"` veya `"txt"` |
| `file` | format `epub` ise tek `.epub` |
| `files[]` | format `txt` ise `001_..txt`, `002_..txt` ... sıralı dosyalar |

Header: `Authorization: Bearer $INGEST_SECRET`

Epub varsa her zaman epub tercih edilir (OPF spine sırasına göre otomatik
bölünür); yalnızca epub yoksa `txt` fallback'i kullanılır.

## Okuma ilerlemesi

Sunucuda **tutulmaz**. Her cihaz kendi `localStorage`'ında
(`src/lib/progress.ts`) novel bazlı son bölüm + scroll oranını saklar.
Bölüm listesinde "kaldığın yer" rozeti buradan gelir.

## Görülme sayacı

Bölüme girişte `/api/chapters/[id]/view` çağrılır, DB'de basit bir sayaç
artırılır (kullanıcı bazlı tekilleştirme yok).

## Typo / bağlam düzeltme önerileri

Okuyucu metni seçip öneri gönderdiğinde `edit_suggestions` tablosuna
`status: "pending"` olarak düşer. `ononoki-dp` botu bunları
`GET /api/suggestions?status=pending` ile periyodik çeker, eptran reposunda
ilgili `.txt`/epub kaynağını bulup PR açar, sonra durumu günceller.

Şu an gönderimler anonim (`submitterId: null`). Google/GitHub login
eklendiğinde bu alan doldurulacak ve PR'lar ononoki-dp adına ama
kullanıcı referansıyla açılabilecek.
