import { readFrames, cors, baseUrl } from '../lib/store.js';

// Dipakai aplikasi Snapin: daftar bingkai bergambar (PNG/WebP dengan lubang foto).
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
        frameImageUrl: base + '/api/img?id=' + encodeURIComponent(f.id),
        isPremium: false,
      }));
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=120');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json([]);
  }
}
