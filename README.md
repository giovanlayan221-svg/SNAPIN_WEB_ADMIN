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
3. Di project Vercel: tab Storage > Create > Blob > Create, lalu hubungkan ke project ini.
   Variabel `BLOB_READ_WRITE_TOKEN` otomatis ditambahkan.
4. Settings > Environment Variables: tambah `ADMIN_PASSWORD` (pilih password yang kuat).
5. Deployments > Redeploy (supaya variabel terbaca).
6. Buka `https://NAMA-PROJECT.vercel.app/admin`, masuk dengan password, lalu upload bingkai.

## Aturan bingkai
- Lubang foto: bagian transparan, atau satu warna polos (hijau, magenta, cyan, kuning).
- Maksimal 6 lubang. Bingkai tampil saat pengguna memilih jumlah foto yang sama dengan jumlah lubang.
- Urutan foto: atas ke bawah, kiri ke kanan.
