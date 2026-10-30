import { readFrames, cors, baseUrl } from '../lib/store.js';

// Dipakai aplikasi Snapin: daftar bingkai bergambar (PNG/WebP/GIF dengan lubang foto).
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const { frames } = await readFrames();
    const base = baseUrl(req);
    const out = frames
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((f) => ({
        id: f.id,
        label: f.label,
        photoCount: f.photoCount,
        canvasWidth: f.canvasWidth,
        canvasHeight: f.canvasHeight,
        photoAreas: f.photoAreas,
        ratio: f.ratio || 'any',      // 1:1, 3:4, 4:3, 9:16, 16:9, any
        kind: f.kind || 'photo',      // photo | video
        theme: f.theme || '',
        animated: !!f.animated,
        rev: f.createdAt || 0,
        frameImageUrl: base + '/api/img?id=' + encodeURIComponent(f.id),
        previewUrl: base + '/api/img?preview=1&id=' + encodeURIComponent(f.id),
        isPremium: !!f.isPremium,
        price: f.price || '',
        priceIdr: f.priceIdr || 0,
      }));
    // daftar tidak boleh nyangkut di cache lama: bingkai baru harus cepat muncul
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json([]);
  }
}
