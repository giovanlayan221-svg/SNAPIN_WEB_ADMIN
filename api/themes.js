import { readThemes, cors } from '../lib/store.js';

// Dipakai aplikasi Snapin: daftar tema buatan admin (pola + warna), disimpan offline di HP pengguna.
export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const { themes } = await readThemes();
    const out = themes
      .slice()
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
      .map((t) => ({ id: t.id, name: t.name, pat: t.pat, rev: t.updatedAt || t.createdAt || 0 }));
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=60');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json([]);
  }
}
