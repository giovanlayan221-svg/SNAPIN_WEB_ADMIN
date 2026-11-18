import { readStickers, cors, baseUrl } from '../lib/store.js';

// Dipakai aplikasi Snapin: daftar stiker tambahan dari admin.
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const { stickers } = await readStickers();
    const base = baseUrl(req);
    const out = stickers
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((s) => ({
        id: s.id,
        label: s.label,
        cat: s.cat,
        rev: s.createdAt || 0,
        imageUrl: base + '/api/sticker-img?id=' + encodeURIComponent(s.id),
      }));
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json([]);
  }
}
