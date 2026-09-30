
# KERTAS KERJA

## CADANGAN PERLAKSANAAN PROGRAM PEMUDA SURAU AL-ABQORI
### Rekod Solat, Al-Quran dan Amal Kebajikan Anak Remaja di Surau

---

| | |
|---|---|
| **Disediakan untuk** | Ahli Jawatankuasa (AJK) Surau Al-Abqori |
| **Lokasi** | Surau Al-Abqori, Jalan Cerdik, Taman Universiti, 43000 Kajang, Selangor |
| **Tarikh** | 30 September 2026 |
| **Status** | Cadangan untuk pertimbangan AJK |

---

## RINGKASAN EKSEKUTIF

Sistem aplikasi web Pemuda Surau Al-Abqori telah siap dibangunkan dan diuji, dan kini sedia
untuk dilaksanakan secara rasmi. Sistem ini merekod kehadiran solat berjemaah, aktiviti
Al-Quran (tilawah dan hafazan) serta amal kebajikan (merit) secara automatik menggunakan
pengesahan wajah dan lokasi (geofencing).

**Perkara utama untuk keputusan AJK:**

| Perkara | Ringkasan |
|---|---|
| **Tujuan** | Meningkatkan penyertaan anak remaja dalam solat berjemaah, Al-Quran dan amal kebajikan melalui penjejakan yang telus dan automatik. |
| **Kos Infrastruktur** | **RM 64.86 sebulan** — bersamaan **RM 778.32 setahun**. |
| **Kos Hadiah** | **RM 3,400.00 setahun** (hadiah bulanan RM 2,400.00 + hadiah mega tahunan RM 1,000.00). |
| **Jumlah Peruntukan** | **RM 4,178.32 setahun** (infrastruktur + hadiah). |
| **Kos Sehari** | Lebih kurang **RM 2.16 sehari** untuk infrastruktur teknologi. |
| **Faedah Utama** | Pengiktirafan telus, penjimatan masa AJK, data masa nyata dan peningkatan kehadiran anak remaja. |
| **Risiko Utama** | Privasi wajah (hanya kod matematik disimpan, bukan gambar) dan sambungan internet (mitigasi disediakan). |

**Keputusan yang dipohon:** Meluluskan perlaksanaan sistem, peruntukan infrastruktur
**RM 778.32 setahun**, hadiah bulanan **RM 200.00 sebulan**, hadiah mega tahunan
**RM 1,000.00**.

---

## 1.0 PENGENALAN

Surau Al-Abqori mempunyai program pembangunan anak remaja yang bertujuan menggalakkan penyertaan
golongan muda dalam solat berjemaah, pembacaan Al-Quran dan amal kebajikan. Pada masa ini,
kehadiran dan penyertaan ahli direkodkan secara manual, yang menyukarkan pemantauan,
penilaian dan pemberian penghargaan secara konsisten.

Sehubungan itu, satu sistem aplikasi web telah dibangunkan secara dalaman (*in-house*) untuk
mengautomasikan proses ini. Sistem ini telah melalui fasa pembangunan dan ujian, dan kini
sedia untuk dilaksanakan secara rasmi.

Aplikasi ini beroperasi melalui telefon pintar ahli, menggunakan **pengesahan wajah** untuk
merekod kehadiran solat, serta **pengesahan lokasi (geofencing)** bagi memastikan rekod
dibuat di dalam kawasan surau.

---

## 2.0 OBJEKTIF

### 2.1 Objektif Umum

Meningkatkan penyertaan golongan anak remaja dalam aktiviti ibadah dan kebajikan di Surau Al-Abqori
melalui sistem penjejakan yang telus, automatik dan menarik.

### 2.2 Objektif Khusus

1. **Merekod kehadiran solat berjemaah** — Subuh, Zuhur, Asar, Maghrib dan Isyak — secara
   automatik dengan pengesahan wajah dan lokasi.
2. **Merekod aktiviti Al-Quran** — bacaan (tilawah) dan hafazan — oleh ahli sendiri atau
   oleh guru secara terus.
3. **Merekod amal kebajikan (merit)** — sumbangan dan tingkah laku baik yang diiktiraf oleh AJK.
4. **Menyediakan papan pendahulu (leaderboard)** yang telus sebagai asas pemberian hadiah.
5. **Memudahkan pengurusan AJK** — statistik kehadiran, pengurusan ahli dan program.
6. **Menggalakkan penyertaan keluarga** — ibu bapa boleh mendaftarkan anak di bawah umur
   yang belum memiliki telefon sendiri.

---

## 3.0 CADANGAN PERLAKSANAAN

### 3.1 Gambaran Keseluruhan Sistem

| Komponen | Keterangan |
|---|---|
| **Aplikasi Web** | Boleh diakses melalui pelayar telefon pintar. Tiada pemasangan aplikasi diperlukan. |
| **Log Masuk** | Menggunakan nombor telefon dan kod pengesahan (OTP) melalui **Telegram** — **percuma**, tanpa kos SMS. |
| **Pengesahan Wajah** | Dijalankan dalam pelayar telefon. Hanya **kod matematik wajah (128 nilai)** disimpan — **gambar wajah tidak disimpan**. |
| **Pengesahan Lokasi** | Rekod hanya diterima dalam radius **150 meter** dari surau. |
| **Tetingkap Solat** | Rekod dibuka **15 minit sebelum azan** hingga **60 minit selepas azan**. Bagi **Isyak**, rekod dibuka **tepat pada waktu azan** (kerana waktunya sangat hampir dengan Maghrib). |
| **Akaun Keluarga** | Ibu bapa boleh mendaftar anak sebagai tanggungan dan mendaftarkan wajah anak. |

### 3.2 Fasa Perlaksanaan

| Fasa | Aktiviti | Tempoh | Tanggungjawab |
|---|---|---|---|
| **Fasa 1** | Pendaftaran AJK dan guru sebagai pentadbir sistem | Minggu 1 | AJK |
| **Fasa 2** | Pendaftaran ahli teras dan pendaftaran wajah | Minggu 2–3 | AJK / Guru |
| **Fasa 3** | Taklimat penggunaan kepada ahli dan ibu bapa | Minggu 4 | AJK |
| **Fasa 4** | Pelancaran rasmi dan permulaan penjejakan | Minggu 5 | AJK |
| **Fasa 5** | Penilaian prestasi bulan pertama dan penambahbaikan | Minggu 8 | AJK |

### 3.3 Kaedah Pengiraan Mata

Mata keseluruhan (*overall*) dikira berdasarkan jumlah:

```
Mata Keseluruhan = Kehadiran Solat + Bacaan Al-Quran + Hafazan Al-Quran + Merit
```

| Kategori | Unit | Mata |
|---|---|---|
| Kehadiran Solat | Setiap solat berjemaah | 5 mata, kecuali Subuh 10 mata |
| Bacaan Al-Quran (Tilawah) | Setiap sesi direkod | 5 mata |
| Hafazan Al-Quran | Setiap sesi direkod | 5 mata |
| Merit / Amal Kebajikan | Mengikut nilai yang diberi AJK | 1–10 mata |

> **Nota:** Papan pendahulu turut menyediakan kategori berasingan bagi setiap bidang
> (Kehadiran, Tilawah, Hafazan, Merit) supaya ahli yang cemerlang dalam bidang tertentu
> tetap diiktiraf.

### 3.4 Keperluan Teknikal

| Perkara | Keperluan |
|---|---|
| Peranti Ahli | Telefon pintar dengan kamera dan GPS |
| Sambungan Internet | Data mudah alih atau Wi-Fi |
| Pelayar | Chrome, Safari atau Edge (versi terkini) |
| Kebenaran | Akses kamera dan lokasi perlu dibenarkan |

---

## 4.0 KOS BULANAN DAN UNJURAN KOS TAHUNAN

### 4.1 Andaian Pengiraan

- Kadar pertukaran: **USD 1.00 = RM 4.70** (anggaran; tertakluk kepada perubahan)
- Kos pelayan berdasarkan harga DigitalOcean bagi wilayah Singapura (latensi terendah ke Malaysia)
- **Tiada kos SMS** — log masuk menggunakan Telegram (percuma)
- **Tiada kos sijil SSL** — menggunakan Cloudflare Tunnel (percuma)
- **Tiada kos lesen perisian** — keseluruhan sistem menggunakan perisian sumber terbuka

### 4.2 Kos Bulanan

| Item | Butiran | Kos (USD) | Kos (RM) |
|---|---|---|---|
| Pelayan (Droplet) | 1 vCPU, 2 GB RAM — menjalankan pangkalan data, API, laman web dan terowong | $13.80 | RM 64.86 |
| Log Masuk OTP | Telegram Bot API | $0.00 | RM 0.00 |
| Sijil SSL / HTTPS | Cloudflare Tunnel | $0.00 | RM 0.00 |
| Sandaran Luar Tapak | Cloudflare R2 (10 GB percuma) | $0.00 | RM 0.00 |
| Lesen Perisian | Sumber terbuka | $0.00 | RM 0.00 |
| **JUMLAH KOS BULANAN** | | **$13.80** | **RM 64.86** |
### 4.3 Unjuran Kos Tahunan

| Item | Kos Bulanan (RM) | Kos Tahunan (RM) |
|---|---|---|
| Kos Infrastruktur | RM 64.86 | RM 778.32 |
| Hadiah Bulanan (7 pemenang × 12 bulan) | RM 200.00 | RM 2,400.00 |
| Hadiah Mega Tahunan (3 pemenang) | — | RM 1,000.00 |
| **JUMLAH KESELURUHAN** | | **RM 4,178.32** |

### 4.4 Ringkasan Kos

| Kategori | Kos Tahunan (RM) | Peratusan |
|---|---|---|
| Infrastruktur Teknologi | RM 778.32 | 18.6% |
| Hadiah dan Insentif | RM 3,400.00 | 81.4% |
| **JUMLAH** | **RM 4,178.32** | **100%** |

> **Perhatian:** Kos infrastruktur teknologi hanyalah **RM 64.86 sebulan** bersamaan **lebih kurang RM 2.16 sehari**. Ini merupakan pelaburan yang sangat
> berbaloi berbanding faedah jangka panjang dalam pembangunan anak remaja surau.

---

## 5.0 CADANGAN HADIAH DAN INSENTIF

### 5.1 Hadiah Bulanan — 7 Pemenang Teratas

Dicadangkan pemberian hadiah pada setiap bulan bagi menggalakkan penyertaan berterusan:

| Kedudukan | Cadangan Hadiah | Nilai (RM) |
|---|---|---|
| **Johan (1)** | Baucar / wang tunai | RM 50.00 |
| **Naib Johan (2)** | Baucar / wang tunai | RM 40.00 |
| **Ketiga (3)** | Baucar / wang tunai | RM 30.00 |
| **Keempat (4)** | Baucar / wang tunai | RM 20.00 |
| **Kelima (5)** | Baucar / wang tunai | RM 20.00 |
| **Keenam (6)** | Baucar / wang tunai | RM 20.00 |
| **Ketujuh (7)** | Baucar / wang tunai | RM 20.00 |
| | **JUMLAH SEBULAN** | **RM 200.00** |
| | **JUMLAH SETAHUN (× 12)** | **RM 2,400.00** |

> **Cadangan tambahan:** Sijil penghargaan boleh diberikan kepada 7 pemenang setiap bulan
> sebagai pengiktirafan rasmi tanpa kos tambahan yang besar.

### 5.2 Hadiah Mega Tahunan — 3 Pemenang Teratas

Dicadangkan hadiah utama pada majlis tahunan surau bagi menghargai pencapaian sepanjang tahun:

| Kedudukan | Cadangan Hadiah | Nilai (RM) |
|---|---|---|
| **Johan Keseluruhan** | Wang tunai + piala + sijil | RM 500.00 |
| **Naib Johan Keseluruhan** | Wang tunai + piala + sijil | RM 300.00 |
| **Ketiga Keseluruhan** | Wang tunai + piala + sijil | RM 200.00 |
| | **JUMLAH** | **RM 1,000.00** |

### 5.3 Cadangan Hadiah Kategori Khas (Pilihan)

Bagi menggalakkan penyertaan menyeluruh, AJK boleh mempertimbangkan hadiah kategori khas
yang lebih kecil:

| Kategori | Cadangan | Nilai (RM) |
|---|---|---|
| Kehadiran Solat Terbaik | Sijil + baucar | RM 50.00 |
| Tilawah Al-Quran Terbaik | Sijil + baucar | RM 50.00 |
| Hafazan Al-Quran Terbaik | Sijil + baucar | RM 50.00 |
| Merit / Amal Kebajikan Terbaik | Sijil + baucar | RM 50.00 |
| **JUMLAH** | | **RM 200.00** |

> Kategori khas ini adalah **pilihan** dan boleh dilaksanakan sekiranya peruntukan
> kewangan mengizinkan.

### 5.4 Ringkasan Kos Hadiah

| Item | Kos Tahunan (RM) |
|---|---|
| Hadiah Bulanan (7 pemenang × 12 bulan) | RM 2,400.00 |
| Hadiah Mega Tahunan (3 pemenang) | RM 1,000.00 |
| **JUMLAH ASAS** | **RM 3,400.00** |
| Kategori Khas (pilihan) | RM 200.00 |
| **JUMLAH DENGAN KATEGORI KHAS** | **RM 3,600.00** |

---

## 6.0 FAEDAH DAN IMPAK DIJANGKA

### 6.1 Faedah kepada Ahli

- Pengiktirafan yang telus dan adil berdasarkan data sebenar
- Motivasi untuk hadir solat berjemaah secara konsisten
- Galakan membaca dan menghafaz Al-Quran
- Semangat persaingan sihat dalam kalangan rakan sebaya

### 6.2 Faedah kepada AJK

- Data kehadiran dan penyertaan yang tepat dan masa nyata
- Penjimatan masa dalam proses merekod dan pengiraan
- Asas objektif untuk pemberian hadiah dan pengiktirafan
- Kemudahan pemantauan prestasi program anak remaja

### 6.3 Faedah kepada Surau

- Peningkatan kehadiran solat berjemaah dalam kalangan anak remaja
- Pengukuhan peranan surau sebagai pusat pembangunan anak remaja
- Data statistik untuk perancangan program masa hadapan

---

## 7.0 RISIKO DAN LANGKAH MITIGASI

| Risiko | Langkah Mitigasi |
|---|---|
| Ahli tidak memiliki telefon pintar | Akaun keluarga membolehkan ibu bapa mendaftar anak; rekod manual oleh guru turut disediakan |
| Ahli tidak biasa dengan teknologi | Taklimat penggunaan dan bimbingan AJK pada fasa permulaan |
| Kebimbangan privasi wajah | Hanya kod matematik wajah disimpan, **bukan gambar**; data disimpan pada pelayan terkawal |
| Gangguan sambungan internet | Rekod boleh dibuat apabila sambungan pulih dalam tetingkap solat |
| Penyalahgunaan sistem | Pengesahan lokasi (150 m) dan pengesahan wajah menghalang rekod palsu |

---

## 8.0 CADANGAN KEPUTUSAN

AJK Surau Al-Abqori dipohon mempertimbangkan dan memutuskan perkara berikut:

1. **MELULUSKAN** perlaksanaan sistem aplikasi web Pemuda Surau Al-Abqori.
2. **MELULUSKAN** peruntukan kos infrastruktur sebanyak **RM 778.32 setahun**
   (RM 64.86 sebulan).
3. **MELULUSKAN** peruntukan hadiah bulanan sebanyak **RM 200.00 sebulan**
   (RM 2,400.00 setahun) bagi 7 pemenang teratas.
4. **MELULUSKAN** peruntukan hadiah mega tahunan sebanyak **RM 1,000.00** bagi
   3 pemenang teratas.
5. **MELANTIK** seorang penyelaras program daripada AJK untuk menguruskan sistem
   dan pemberian hadiah.
6. **MENETAPKAN** tarikh pelancaran rasmi dan majlis penyampaian hadiah tahunan.

**Jumlah peruntukan keseluruhan yang dicadangkan: RM 4,178.32 setahun.**

---

## 9.0 PENUTUP

Sistem aplikasi web Pemuda Surau Al-Abqori merupakan satu inisiatif yang mampu
mentransformasi cara surau mengiktiraf dan menggalakkan penyertaan golongan anak remaja. Dengan
kos infrastruktur yang sangat rendah — **lebih kurang RM 2 sehari** — sistem ini
menawarkan pulangan yang besar dalam bentuk peningkatan kehadiran solat berjemaah,
pembacaan Al-Quran dan amal kebajikan.

Adalah diharapkan cadangan ini mendapat pertimbangan yang positif daripada AJK Surau
Al-Abqori demi kebaikan bersama.

Sekian, terima kasih.


**Disediakan oleh:**

Nama: Muhd Imran bin Muhd Fadhil


Jawatan: Wakil Pemuda


Tarikh: 20 September 2026







---

*Dokumen ini adalah cadangan dan tertakluk kepada pertimbangan serta kelulusan AJK Surau
Al-Abqori. Anggaran kos adalah berdasarkan harga semasa dan boleh berubah mengikut kadar
pertukaran mata wang dan harga penyedia perkhidmatan.*
