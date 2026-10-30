import { readFrames, readBlob, cors, tokenOk } from '../lib/store.js';

// Menyajikan gambar bingkai dengan header CORS.
// Bingkai berbayar: gambar penuh hanya untuk perangkat yang sudah redeem kode (d + t),
// selain itu yang keluar hanya pratinjau kecil.
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const q = req.query || {};
    const id = String(q.id || '');
    const { frames } = await readFrames();
    const f = frames.find((x) => x.id === id);
    if (!f) return res.status(404).send('Tidak ditemukan');
    const wantPreview = String(q.preview || '') === '1';
    const unlocked = !f.isPremium || tokenOk(String(q.d || ''), f.id, String(q.t || ''));
    let url = f.blobUrl, type = f.contentType;
    if (wantPreview || !unlocked) {
      if (!f.previewUrl) {
        if (!unlocked) return res.status(403).send('Bingkai berbayar');
      } else { url = f.previewUrl; type = 'image/webp'; }
    }
    const { buffer: buf } = await readBlob(url);
    res.setHeader('Content-Type', type || 'image/webp');
    // gambar penuh berbayar jangan di-cache publik
    res.setHeader('Cache-Control', f.isPremium && unlocked && !wantPreview
      ? 'private, max-age=31536000, immutable'
      : 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).send('Error');
  }
}
