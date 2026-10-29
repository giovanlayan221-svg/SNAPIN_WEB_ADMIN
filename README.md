# Snapin Admin (server bingkai)

Server kecil untuk Vercel: halaman admin untuk mengunggah bingkai Canva (PNG/WebP),
dan API yang dibaca aplikasi Snapin. Penyimpanan memakai Vercel Blob (tanpa Firebase).

## Isi
- `admin.html`  halaman admin, dibuka di `/admin`
- `api/image-frames.js`  daftar bingkai untuk aplikasi (publik)
- `api/img.js`  gambar bingkai (publik, dengan CORS)
- `api/admin.js`  simpan / daftar / hapus (butuh password admin)
- `api/frames.js`, `api/filters.js`  disiapkan untuk nanti, sekarang mengembalikan daftar kosong

## Pasang di Vercel
1. Upload isi project ini ke repo GitHub (boleh Private).
2. Di Vercel: Add New > Project > pilih repo > Deploy.
3. Di project Vercel: tab Storage > Create > Blob (public atau private, dua-duanya didukung), lalu hubungkan ke project ini.
   Vercel menambahkan `BLOB_STORE_ID` dan login OIDC otomatis (tidak ada lagi BLOB_READ_WRITE_TOKEN, itu normal).
4. Settings > Environment Variables: tambah `ADMIN_PASSWORD` (pilih password yang kuat).
5. Deployments > Redeploy (supaya variabel terbaca).
6. Buka `https://NAMA-PROJECT.vercel.app/admin`, masuk dengan password, lalu upload bingkai.

## Aturan bingkai
- Lubang foto: bagian transparan, atau satu warna polos (hijau, magenta, cyan, kuning).
- Maksimal 6 lubang. Bingkai tampil saat pengguna memilih jumlah foto yang sama dengan jumlah lubang.
- Urutan foto: atas ke bawah, kiri ke kanan.


---

## Update v2: rasio, animasi, kode redeem, QRIS

### Perbaikan hijau berbekas
Kunci warna sekarang mencari warna hijau SEBENARNYA di gambar (mis. 44,218,40, bukan hijau murni), menghapusnya
hanya di area yang tersambung ke lubang foto (hijau di desain, misalnya dinosaurus, tetap aman), lalu menetralkan
sisa hijau di tepi. **Bingkai lama yang sudah terlanjur diupload perlu diupload ulang** supaya memakai hasil baru.

### Di dashboard admin
- Upload bingkai: pilih **rasio** (1:1, 4:3 tegak/landscape, 16:9 tegak/landscape), **untuk Foto atau Video** (video = 1 lubang),
  tema, berbayar + **Harga QRIS**. Rasio ditebak otomatis dari bentuk lubang.
- GIF / WebP animasi / APNG boleh diupload (harus lubang transparan, bukan hijau polos; maks sekitar 3 MB).
- Tombol **Ubah** di tiap bingkai: ganti rasio, tema, nama, harga tanpa upload ulang.
- **Kode redeem**: untuk dijual manual lewat chat.
- **Toko QRIS**: nama toko, link bantuan, kunci fitur premium, **Paket** (beberapa bingkai/fitur satu harga), dan daftar **Penjualan**.

### Pembayaran QRIS (sama alurnya dengan GVSUPERZSTORE, tanpa login)
Variabel Vercel yang dibutuhkan (boleh sama dengan milik GVSUPERZSTORE):
- `PUNYAKIOS_API_KEY`, `PUNYAKIOS_API_SECRET`
- `ADMIN_PASSWORD` (sudah ada). Opsional `ORDER_SECRET` (kunci tanda tangan pesanan, default memakai ADMIN_PASSWORD)

Alur: aplikasi minta QRIS (`/api/qris` create) -> QR tampil di aplikasi (biaya QRIS ditanggung pembeli) -> aplikasi mengecek
status ke PunyaKios (`check`, hanya status resmi "paid" yang dipercaya, nominal dicek) -> server mengirim **token buka** yang
terikat ke ID perangkat -> bingkai terbuka dan tersimpan di HP (offline).
Tidak ada akun dan server tidak menyimpan pesanan: pesanan dibawa sebagai token bertanda tangan HMAC, jadi harga tidak bisa
diubah dari aplikasi. Pembayaran yang tertunda dicek ulang saat aplikasi dibuka.

Webhook `https://DOMAIN/api/qris-callback` opsional (PunyaKios hanya punya SATU URL webhook per akun; kalau akun yang sama dipakai
GVSUPERZSTORE, biarkan di sana, pembayaran Snapin tetap terkonfirmasi lewat pengecekan dari aplikasi).

Batas yang perlu kamu tahu:
- Catatan **Penjualan** terisi saat aplikasi pembeli mengonfirmasi. Data resmi ada di dashboard PunyaKios.
- Kunci fitur premium (Studio, video berbingkai) dijaga di sisi aplikasi; yang dijaga ketat di server hanyalah **gambar bingkai berbayar**.
- Aplikasi memanggil `/api/admin?action=save` dari Studio Bingkai (tombol "Kirim ke server") memakai password admin yang diketik di aplikasi.
