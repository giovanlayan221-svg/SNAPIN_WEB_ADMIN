import { cors } from '../lib/store.js';

// Filter dari admin: belum dipakai, aplikasi cukup menerima daftar kosong.
export default function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'public, s-maxage=60');
  return res.status(200).json([]);
}
