import { readFrames, cors } from '../lib/store.js';

// Menyajikan gambar bingkai dengan header CORS supaya bisa dipakai di canvas aplikasi
// tanpa membuat canvas "tainted" (hasil foto tetap bisa disimpan/dibagikan).
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const id = String((req.query && req.query.id) || '');
    const { frames } = await readFrames();
    const f = frames.find((x) => x.id === id);
    if (!f) return res.status(404).send('Tidak ditemukan');
    const r = await fetch(f.blobUrl);
    if (!r.ok) return res.status(502).send('Gambar tidak tersedia');
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', f.contentType || 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).send('Error');
  }
}
