import { readStickers, readBlob, cors } from '../lib/store.js';

// Menyajikan gambar stiker dengan header CORS (supaya bisa dipakai di kanvas aplikasi).
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const id = String((req.query && req.query.id) || '');
    const { stickers } = await readStickers();
    const s = stickers.find((x) => x.id === id);
    if (!s) return res.status(404).send('Tidak ditemukan');
    const { buffer } = await readBlob(s.blobUrl);
    res.setHeader('Content-Type', s.contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(500).send('Error');
  }
}
