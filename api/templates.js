import { readTemplates, cors, baseUrl } from '../lib/store.js';

// Dipakai aplikasi Snapin: daftar template wallpaper dan kolase dari admin.
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const { templates } = await readTemplates();
    const base = baseUrl(req);
    const out = templates
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        rev: t.updatedAt || t.createdAt || 0,
        w: t.w,
        h: t.h,
        slots: t.slots,
        imageUrl: base + '/api/template-img?id=' + encodeURIComponent(t.id),
      }));
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json([]);
  }
}
