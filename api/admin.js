import crypto from 'node:crypto';
import {
  readFrames, writeFrames, isAdmin, putAuto, deleteBlob, friendlyError, readCodes, writeCodes,
  readDoc, writeDoc, readSettings, PACKS_PREFIX, SALES_PREFIX, SETTINGS_PREFIX, FEATURES,
} from '../lib/store.js';

const MAX_IMAGE_BYTES = 3400000; // batas isi request Vercel sekitar 4.5 MB (base64)
const RATIOS = ['any', '1:1', '3:4', '4:3', '9:16', '16:9'];
const KINDS = ['photo', 'video'];
const MIME = { 'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif' };

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
    ratio: f.ratio || 'any',
    kind: f.kind || 'photo',
    theme: f.theme || '',
    animated: !!f.animated,
    isPremium: !!f.isPremium,
    price: f.price || '',
    priceIdr: f.priceIdr || 0,
    createdAt: f.createdAt,
  };
}

function cleanMeta(b, old) {
  const o = old || {};
  const ratio = RATIOS.includes(b.ratio) ? b.ratio : (o.ratio || 'any');
  const kind = KINDS.includes(b.kind) ? b.kind : (o.kind || 'photo');
  const theme = b.theme !== undefined ? String(b.theme || '').trim().slice(0, 40) : (o.theme || '');
  const isPremium = b.isPremium !== undefined ? !!b.isPremium : !!o.isPremium;
  let priceIdr = o.priceIdr || 0;
  if (b.priceIdr !== undefined) {
    const n = Math.round(Number(String(b.priceIdr).replace(/[^\d]/g, '')) || 0);
    priceIdr = n >= 1000 && n <= 5000000 ? n : 0;       // 0 = tidak dijual lewat QRIS (hanya kode redeem)
  }
  const price = priceIdr ? 'Rp' + String(priceIdr).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : (b.price !== undefined ? String(b.price || '').trim().slice(0, 30) : (o.price || ''));
  return { ratio, kind, theme, isPremium, price, priceIdr };
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += alphabet[bytes[i] % alphabet.length];
  return 'SNP-' + s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // aplikasi Snapin (Studio Bingkai) boleh mengirim bingkai langsung ke server dengan password admin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!isAdmin(req)) return res.status(401).json({ error: 'Password salah' });

  const action = String((req.query && req.query.action) || '');
  try {
    if (req.method === 'GET' && action === 'list') {
      const { frames } = await readFrames();
      const out = frames.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(publicFrame);
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
      const m = /^data:(image\/(?:webp|png|gif));base64,(.+)$/.exec(String(b.image || ''));
      if (!m) return res.status(400).json({ error: 'Gambar harus PNG, WebP, atau GIF' });
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > MAX_IMAGE_BYTES) {
        return res.status(413).json({ error: 'Gambar terlalu besar (maks sekitar 3.4 MB)' });
      }
      const meta = cleanMeta(b, null);
      if (meta.kind === 'video' && cleanAreas.length !== 1) {
        return res.status(400).json({ error: 'Bingkai video harus punya tepat 1 lubang' });
      }

      const id = crypto.randomBytes(6).toString('hex');
      const blob = await putAuto('snapin/frames/' + id + '.' + MIME[m[1]], buf, {
        contentType: m[1],
        addRandomSuffix: false,
      });
      // pratinjau kecil (dipakai daftar bingkai berbayar sebelum dibuka)
      let previewUrl = '';
      const pm = /^data:image\/webp;base64,(.+)$/.exec(String(b.preview || ''));
      if (pm) {
        const pbuf = Buffer.from(pm[1], 'base64');
        if (pbuf.length && pbuf.length < 400000) {
          const pb = await putAuto('snapin/frames/' + id + '-p.webp', pbuf, { contentType: 'image/webp', addRandomSuffix: false });
          previewUrl = pb.url;
        }
      }

      const { frames, blobs } = await readFrames();
      const frame = {
        id,
        label,
        photoCount: cleanAreas.length,
        canvasWidth: Math.round(w),
        canvasHeight: Math.round(h),
        photoAreas: cleanAreas,
        blobUrl: blob.url,
        previewUrl,
        contentType: m[1],
        animated: !!b.animated,
        ...meta,
        createdAt: Date.now(),
      };
      frames.push(frame);
      await writeFrames(frames, blobs);
      return res.status(200).json({ ok: true, frame: publicFrame(frame) });
    }

    // ubah info bingkai yang sudah ada (rasio, tema, berbayar, nama) tanpa upload ulang
    if (req.method === 'POST' && action === 'update') {
      const b = req.body || {};
      const id = String(b.id || '');
      const { frames, blobs } = await readFrames();
      const f = frames.find((x) => x.id === id);
      if (!f) return res.status(404).json({ error: 'Bingkai tidak ditemukan' });
      if (b.label !== undefined) f.label = String(b.label || '').trim().slice(0, 60) || f.label;
      Object.assign(f, cleanMeta(b, f));
      if (f.isPremium && !f.previewUrl) {
        return res.status(400).json({ error: 'Bingkai ini belum punya pratinjau. Upload ulang untuk menjadikannya berbayar.' });
      }
      f.createdAt = f.createdAt || Date.now();
      await writeFrames(frames, blobs);
      return res.status(200).json({ ok: true, frame: publicFrame(f) });
    }

    if (req.method === 'POST' && action === 'delete') {
      const id = String((req.body && req.body.id) || '');
      const { frames, blobs } = await readFrames();
      const f = frames.find((x) => x.id === id);
      if (!f) return res.status(404).json({ error: 'Bingkai tidak ditemukan' });
      try { await deleteBlob(f.blobUrl); } catch (e) { /* abaikan */ }
      if (f.previewUrl) { try { await deleteBlob(f.previewUrl); } catch (e) { /* abaikan */ } }
      await writeFrames(frames.filter((x) => x.id !== id), blobs);
      return res.status(200).json({ ok: true });
    }

    // ---- kode redeem ----
    if (req.method === 'GET' && action === 'codes') {
      const { codes } = await readCodes();
      return res.status(200).json({ codes: codes.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) });
    }

    if (req.method === 'POST' && action === 'code-create') {
      const b = req.body || {};
      const scope = b.scope === 'all' ? 'all' : 'ids';
      const frameIds = Array.isArray(b.frameIds) ? b.frameIds.map(String).slice(0, 100) : [];
      if (scope === 'ids' && !frameIds.length) return res.status(400).json({ error: 'Pilih minimal satu bingkai' });
      const qty = Math.max(1, Math.min(50, Number(b.qty) || 1));
      const maxDevices = Math.max(1, Math.min(10, Number(b.maxDevices) || 1));
      const label = String(b.label || '').trim().slice(0, 60);
      const { codes, blobs } = await readCodes();
      const made = [];
      for (let i = 0; i < qty; i++) {
        const c = { code: newCode(), scope, frameIds: scope === 'all' ? [] : frameIds, maxDevices, label, devices: [], createdAt: Date.now() };
        codes.push(c);
        made.push(c);
      }
      await writeCodes(codes, blobs);
      return res.status(200).json({ ok: true, codes: made });
    }

    if (req.method === 'POST' && action === 'code-delete') {
      const code = String((req.body && req.body.code) || '');
      const { codes, blobs } = await readCodes();
      await writeCodes(codes.filter((c) => c.code !== code), blobs);
      return res.status(200).json({ ok: true });
    }

    // ---- toko QRIS: paket, pengaturan, penjualan ----
    if (req.method === 'GET' && action === 'shop') {
      const { data } = await readDoc(PACKS_PREFIX, { packs: [] });
      const { settings } = await readSettings();
      return res.status(200).json({ packs: data.packs || [], settings, features: FEATURES, qrisReady: !!(process.env.PUNYAKIOS_API_KEY && process.env.PUNYAKIOS_API_SECRET) });
    }
    if (req.method === 'POST' && action === 'pack-save') {
      const b = req.body || {};
      const label = String(b.label || '').trim().slice(0, 60);
      const priceIdr = Math.round(Number(String(b.priceIdr).replace(/[^\d]/g, '')) || 0);
      if (!label) return res.status(400).json({ error: 'Nama paket wajib diisi' });
      if (priceIdr < 1000 || priceIdr > 5000000) return res.status(400).json({ error: 'Harga paket Rp1.000 sampai Rp5.000.000' });
      const all = !!b.all;
      const { frames } = await readFrames();
      const frameIds = all ? [] : (Array.isArray(b.frameIds) ? b.frameIds.map(String).filter((id) => frames.some((f) => f.id === id)).slice(0, 100) : []);
      const features = (Array.isArray(b.features) ? b.features : []).filter((k) => FEATURES.some((f) => f.key === k));
      if (!all && !frameIds.length && !features.length) return res.status(400).json({ error: 'Pilih bingkai atau fitur untuk paket ini' });
      const { data, blobs } = await readDoc(PACKS_PREFIX, { packs: [] });
      const packs = data.packs || [];
      const id = String(b.id || '') || crypto.randomBytes(5).toString('hex');
      const pack = { id, label, priceIdr, all, frameIds, features, note: String(b.note || '').slice(0, 120), active: b.active !== false };
      const i = packs.findIndex((x) => x.id === id);
      if (i >= 0) packs[i] = pack; else packs.push(pack);
      await writeDoc(PACKS_PREFIX, { packs }, blobs);
      return res.status(200).json({ ok: true, pack });
    }
    if (req.method === 'POST' && action === 'pack-delete') {
      const id = String((req.body && req.body.id) || '');
      const { data, blobs } = await readDoc(PACKS_PREFIX, { packs: [] });
      await writeDoc(PACKS_PREFIX, { packs: (data.packs || []).filter((x) => x.id !== id) }, blobs);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && action === 'settings') {
      const b = req.body || {};
      const gates = {};
      FEATURES.forEach((f) => { gates[f.key] = !!(b.gates && b.gates[f.key]); });
      const buyLink = /^https:\/\//i.test(String(b.buyLink || '')) ? String(b.buyLink).slice(0, 300) : '';
      const shopName = String(b.shopName || 'Snapin').trim().slice(0, 40) || 'Snapin';
      const { blobs } = await readSettings();
      await writeDoc(SETTINGS_PREFIX, { gates, buyLink, shopName }, blobs);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET' && action === 'sales') {
      const { data } = await readDoc(SALES_PREFIX, { sales: [] });
      const sales = (data.sales || []).slice().sort((a, b) => b.at - a.at).slice(0, 100);
      const total = (data.sales || []).reduce((n, x) => n + (x.base || 0), 0);
      return res.status(200).json({ sales, total, count: (data.sales || []).length });
    }

    return res.status(400).json({ error: 'Aksi tidak dikenal' });
  } catch (e) {
    return res.status(500).json({ error: friendlyError(e) });
  }
}
