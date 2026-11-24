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
bölünür); yalnızca epub yoksa `txt` fallback'i kullanılır. (Bot şu an `txt`
gönderiyor; bölüm sırası library'deki `NNN.txt` sırasıyla birebir aynıdır.)

Testler: `npm test` (yerel libSQL dosyası + sahte library, ağ gerekmez).

## `/api/ingest-library` sözleşmesi

Metin [eptran-library](https://github.com/dpentx/eptran-library) reposuna
taşındığı için bot dosyaları gövdeye koymak yerine sadece **hangi cildin**
okunacağını söyler, site metni library'den kendisi çeker (public repo, token
gerekmez):

```json
POST /api/ingest-library
{ "series": "kusuriya", "slug": "knh-11", "sourceKey": "knh-11", "ref": "main" }
```

| alan | açıklama |
|---|---|
| `series`, `slug` | library'deki `<seri>/<cilt>` yolu (zorunlu) |
| `sourceKey` | novel eşleştirme anahtarı; verilmezse `slug` |
| `ref` | dal / etiket / commit (varsayılan `main`) |

Header: `Authorization: Bearer $INGEST_SECRET` (`/api/ingest` ile aynı).

- `<seri>/index.json`'dan başlık, yazar ve `bolum_sayisi` okunur; bölümler
  `001.txt … NNN.txt` olarak çekilir. Library ana dalındaki **yayın biçimi**
  (ilk satır başlık) `parseTxtChapter` ile olduğu gibi okunur; biçim tanımı
  library README'sindedir.
- Aynı yazma mantığı `/api/ingest` ile ortaktır (`src/lib/ingestCore.ts`): içerik
  hash'i değişmeyen bölüme dokunulmaz, bot'un push'u ile library'den çekme aynı
  metin için aynı hash'i üretir.
- Novel zaten varsa başlık, yazar ve kapak **değiştirilmez**; yalnızca
  bölümler eklenir/güncellenir. Library'de bir düzeltme birleşince aynı çağrı
  yeniden ingest işi görür.
- Ortam: `LIBRARY_REPO` (opsiyonel, varsayılan `dpentx/eptran-library`).

## Okuma ilerlemesi

Sunucuda **tutulmaz**. Her cihaz kendi `localStorage`'ında
(`src/lib/progress.ts`) novel bazlı son bölüm + scroll oranını saklar.
Bölüm listesinde "kaldığın yer" rozeti buradan gelir.

## Görülme sayacı

Bölüme girişte `/api/chapters/[id]/view` çağrılır, DB'de basit bir sayaç
artırılır (kullanıcı bazlı tekilleştirme yok).

## Typo / bağlam düzeltme önerileri

Okuyucu metni seçip öneri gönderdiğinde `edit_suggestions` tablosuna
`status: "pending"` olarak düşer. `ononoki-dp` botu periyodik olarak bunları
çeker, **eptran-library**'de ilgili `<seri>/<kitap>/NNN.txt` dosyasını bulup
düzeltme PR'ı açar ve durumu günceller (eptran'daki `apply_suggestions.py`):

| uç | açıklama |
|---|---|
| `GET /api/suggestions?status=pending` | Bot için **ince** liste (bölüm içeriği yok): `id, status, selectedText, contextBefore, contextAfter, suggestedText, note, prUrl, createdAt, chapterId, chapterIndex, chapterTitle, sourceKey, novelSlug`. Eskiden yeniye sıralı. `NNN = chapterIndex + 1`. |
| `PATCH /api/suggestions` | `{ id, status, prUrl? }`. Geçişler: `pending → pr_open \| rejected`, `pr_open → merged \| rejected`. `pr_open` için github.com PR adresi gerekli; `merged`/`rejected` son durumdur. |

Her ikisi de `Authorization: Bearer $INGEST_SECRET` ister. Mantık
`src/lib/suggestionsCore.ts`'dedir (testli).

PR birleşince bot `POST /api/ingest-library` ile bölümü yeniden okutur, düzeltme
sitede görünür. Bot metni otomatik uygulayamadığı öneriyi (metin bulunamadı ya
da birden fazla yerde geçiyor) `rejected` yapar.

Şu an gönderimler anonim (`submitterId: null`). Google/GitHub login
eklendiğinde bu alan doldurulacak ve PR'lar ononoki-dp adına ama
kullanıcı referansıyla açılabilecek.
