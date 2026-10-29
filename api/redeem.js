import { readCodes, writeCodes, readFrames, unlockToken, cors } from '../lib/store.js';

// Pengguna menukar kode (dibeli lewat chat/QRIS) untuk membuka bingkai berbayar.
// Tanpa login: kode terikat ke ID perangkat (dibuat otomatis oleh aplikasi).
export default async function handler(req, res) {
  cors(res);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metode salah' });
  try {
    const b = req.body || {};
    const code = String(b.code || '').trim().toUpperCase().replace(/\s+/g, '');
    const deviceId = String(b.deviceId || '').slice(0, 64);
    if (!code || deviceId.length < 8) return res.status(400).json({ error: 'Kode atau perangkat tidak valid' });
    const { codes, blobs } = await readCodes();
    const c = codes.find((x) => x.code === code);
    if (!c) return res.status(404).json({ error: 'Kode tidak ditemukan' });
    c.devices = c.devices || [];
    const already = c.devices.includes(deviceId);
    if (!already) {
      if (c.devices.length >= (c.maxDevices || 1)) return res.status(409).json({ error: 'Kode sudah dipakai di perangkat lain' });
      c.devices.push(deviceId);
      c.usedAt = Date.now();
      await writeCodes(codes, blobs);
    }
    const tokens = {};
    let ids = [];
    if (c.scope === 'all') {
      tokens.all = unlockToken(deviceId, 'all');
    } else {
      const { frames } = await readFrames();
      ids = (c.frameIds || []).filter((id) => frames.some((f) => f.id === id));
      ids.forEach((id) => { tokens[id] = unlockToken(deviceId, id); });
    }
    return res.status(200).json({ ok: true, scope: c.scope === 'all' ? 'all' : 'ids', tokens, label: c.label || '' });
  } catch (e) {
    return res.status(500).json({ error: 'Server error' });
  }
}
