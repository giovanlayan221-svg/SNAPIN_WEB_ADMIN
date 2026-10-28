import { put, del } from '@vercel/blob';
import crypto from 'node:crypto';
import { readFrames, writeFrames, isAdmin } from '../lib/store.js';

const MAX_IMAGE_BYTES = 3400000; // batas Vercel untuk isi request sekitar 4.5 MB (base64)

function num(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function publicFrame(f) {
  return {
    id: f.id,
    label: f.label,
    photoCount: f.photoCount,
    canvasWidth: f.canvasWidth,
    canvasHeight: f.canvasHeight,
    photoAreas: f.photoAreas,
    createdAt: f.createdAt,
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Password salah' });

  const action = String((req.query && req.query.action) || '');
  try {
    if (req.method === 'GET' && action === 'list') {
      const { frames } = await readFrames();
      const out = frames
        .slice()
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(publicFrame);
      return res.status(200).json({ frames: out });
    }

    if (req.method === 'POST' && action === 'save') {
      const b = req.body || {};
      const label = String(b.label || '').trim().slice(0, 60) || 'Bingkai';
      const w = num(b.canvasWidth, 100, 6000);
      const h = num(b.canvasHeight, 100, 8000);
      const areas = Array.isArray(b.photoAreas) ? b.photoAreas : [];
      if (!w || !h) return res.status(400).json({ error: 'Ukuran gambar tidak valid' });
      if (areas.length < 1 || areas.length > 6) {
        return res.status(400).json({ error: 'Jumlah lubang foto harus 1 sampai 6' });
      }
      const cleanAreas = [];
      for (const a of areas) {
        const x = num(a && a.x, 0, w);
        const y = num(a && a.y, 0, h);
        const aw = num(a && a.width, 1, w);
        const ah = num(a && a.height, 1, h);
        if (x === null || y === null || !aw || !ah) {
          return res.status(400).json({ error: 'Area foto tidak valid' });
        }
        cleanAreas.push({ x: Math.round(x), y: Math.round(y), width: Math.round(aw), height: Math.round(ah) });
      }
      const m = /^data:(image\/(?:webp|png));base64,(.+)$/.exec(String(b.image || ''));
      if (!m) return res.status(400).json({ error: 'Gambar harus PNG atau WebP' });
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > MAX_IMAGE_BYTES) {
        return res.status(413).json({ error: 'Gambar terlalu besar (maks sekitar 3.4 MB)' });
      }

      const id = crypto.randomBytes(6).toString('hex');
      const ext = m[1] === 'image/png' ? 'png' : 'webp';
      const blob = await put('snapin/frames/' + id + '.' + ext, buf, {
        access: 'public',
        contentType: m[1],
        addRandomSuffix: false,
      });

      const { frames, blobs } = await readFrames();
      const frame = {
        id,
        label,
        photoCount: cleanAreas.length,
        canvasWidth: Math.round(w),
        canvasHeight: Math.round(h),
        photoAreas: cleanAreas,
        blobUrl: blob.url,
        contentType: m[1],
        createdAt: Date.now(),
      };
      frames.push(frame);
      await writeFrames(frames, blobs);
      return res.status(200).json({ ok: true, frame: publicFrame(frame) });
    }

    if (req.method === 'POST' && action === 'delete') {
      const id = String((req.body && req.body.id) || '');
      const { frames, blobs } = await readFrames();
      const f = frames.find((x) => x.id === id);
      if (!f) return res.status(404).json({ error: 'Bingkai tidak ditemukan' });
      try { await del(f.blobUrl); } catch (e) { /* abaikan */ }
      await writeFrames(frames.filter((x) => x.id !== id), blobs);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Aksi tidak dikenal' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
