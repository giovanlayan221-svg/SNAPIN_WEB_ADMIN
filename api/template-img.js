import { readTemplates, readBlob, cors } from '../lib/store.js';

// Menyajikan gambar template dengan header CORS (dipakai di kanvas aplikasi).
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const id = String((req.query && req.query.id) || '');
    const { templates } = await readTemplates();
    const t = templates.find((x) => x.id === id);
    if (!t) return res.status(404).send('Tidak ditemukan');
    const { buffer } = await readBlob(t.blobUrl);
    res.setHeader('Content-Type', t.contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return res.status(200).send(buffer);
  } catch (e) {
    return res.status(500).send('Error');
  }
}
