import crypto from 'node:crypto';
import {
  readFrames, writeFrames, isAdmin, putAuto, deleteBlob, friendlyError, readCodes, writeCodes, listPrefix, readBlob,
  readDoc, writeDoc, readSettings, PACKS_PREFIX, SALES_PREFIX, SETTINGS_PREFIX, FEATURES,
  readStickers, writeStickers, STICKER_CATS, readThemes, writeThemes, THEME_TYPES,
} from '../lib/store.js';
import { payCreate } from '../lib/punyakios.js';

const MAX_STICKER_BYTES = 1500000; // stiker kecil (PNG/WebP transparan), dikirim sebagai base64
const MAX_IMAGE_BYTES = 3400000; // batas isi request Vercel sekitar 4.5 MB (base64)
const RATIOS = ['any', '1:1', '3:4', '4:3', '9:16', '16:9'];
const KINDS = ['photo', 'video'];
const MIME = { 'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif' };
// Bingkai video: dikirim per potongan (batas isi request Vercel sekitar 4.5 MB), disusun ulang di server.
// Batas ukuran akhir mengikuti batas respons fungsi Vercel (sekitar 4.5 MB) karena aplikasi mengunduh lewat /api/img.
const VIDEO_MIME = { 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MAX_VIDEO_BYTES = 4300000;
const MAX_CHUNK_B64 = 3600000;
const MAX_CHUNKS = 6;
const UPLOAD_ID_RE = /^[a-z0-9]{8,40}$/;

// Terima link https atau nomor WhatsApp biasa (0812..., +62812..., 812...) lalu jadikan link wa.me
function normalizeBuyLink(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (/^https:\/\//i.test(v)) return v.slice(0, 300);
  const d = v.replace(/[^\d+]/g, '');
  if (/^\+?\d{8,15}$/.test(d)) {
    let n = d.replace(/^\+/, '');
    if (n.startsWith('0')) n = '62' + n.slice(1);
    else if (n.startsWith('8')) n = '62' + n;
    return 'https://wa.me/' + n;
  }
  return '';
}

function looksLikeVideo(buf, type) {
  if (type === 'video/mp4') return buf.length > 12 && buf.slice(4, 8).toString('latin1') === 'ftyp';
  if (type === 'video/webm') return buf.length > 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  return false;
}

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
    mediaType: f.mediaType === 'video' ? 'video' : 'image',
    duration: f.duration || 0,
    holeRadius: f.holeRadius || 0,
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


function cleanPat(p) {
  p = p || {};
  const col = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : d);
  const num = (v, d) => { const n = Number(v); return n >= 1 && n <= 3 ? n : d; };
  return { type: THEME_TYPES.includes(p.type) ? p.type : 'solid', c1: col(p.c1, '#FFD3E4'), c2: col(p.c2, '#FFFFFF'), border: col(p.border, '#FFFFFF'), size: num(p.size, 2), line: num(p.line, 2) };
}
function publicSticker(s) {
  return { id: s.id, label: s.label, cat: s.cat, createdAt: s.createdAt, url: '/api/sticker-img?id=' + encodeURIComponent(s.id) };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Password salah' });

  const action = String((req.query && req.query.action) || '');
  try {
    if (req.method === 'GET' && action === 'list') {
      const { frames } = await readFrames();
      const out = frames.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(publicFrame);
      return res.status(200).json({ frames: out });
    }

    // potongan unggahan video (maks 6 potongan, masing-masing sekitar 1 MB)
    if (req.method === 'POST' && action === 'chunk') {
      const b = req.body || {};
      const uid = String(b.uploadId || '');
      const index = Number(b.index);
      const data = String(b.data || '');
      if (!UPLOAD_ID_RE.test(uid)) return res.status(400).json({ error: 'ID unggahan tidak valid' });
      if (!Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS) return res.status(400).json({ error: 'Potongan tidak valid' });
      if (!data || data.length > MAX_CHUNK_B64) return res.status(413).json({ error: 'Potongan terlalu besar' });
      const buf = Buffer.from(data, 'base64');
      if (!buf.length) return res.status(400).json({ error: 'Potongan kosong' });
      await putAuto('snapin/tmp/' + uid + '/' + index + '.part', buf, { contentType: 'application/octet-stream', addRandomSuffix: true });
      return res.status(200).json({ ok: true });
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
      const isVideoFrame = !!b.videoUploadId;
      let mType = '', buf = null, tmpParts = [];
      if (isVideoFrame) {
        const uid = String(b.videoUploadId);
        mType = String(b.videoType || '');
        const nChunks = Number(b.videoChunks);
        if (!UPLOAD_ID_RE.test(uid) || !VIDEO_MIME[mType] || !Number.isInteger(nChunks) || nChunks < 1 || nChunks > MAX_CHUNKS) {
          return res.status(400).json({ error: 'Data video tidak valid (gunakan MP4 atau WebM)' });
        }
        const all = await listPrefix('snapin/tmp/' + uid + '/');
        const latest = {};
        all.forEach((blobItem) => {
          const mm = /\/(\d+)(?:-[^/]*)?\.part$/.exec(blobItem.pathname || '');
          if (!mm) return;
          const i = Number(mm[1]);
          if (!latest[i] || new Date(blobItem.uploadedAt) > new Date(latest[i].uploadedAt)) latest[i] = blobItem;
        });
        tmpParts = all;
        const cleanTmp = async () => { for (const t of all) { try { await deleteBlob(t.url); } catch (e) { /* abaikan */ } } };
        const bufs = [];
        for (let i = 0; i < nChunks; i++) {
          if (!latest[i]) return res.status(400).json({ error: 'Potongan video ke-' + (i + 1) + ' belum terunggah, ulangi unggahan' });
          bufs.push((await readBlob(latest[i].url)).buffer);
        }
        buf = Buffer.concat(bufs);
        if (!buf.length || buf.length > MAX_VIDEO_BYTES) {
          await cleanTmp();
          return res.status(413).json({ error: 'Video terlalu besar (maks sekitar 4.2 MB). Kecilkan di editor admin atau di Canva.' });
        }
        if (!looksLikeVideo(buf, mType)) { await cleanTmp(); return res.status(400).json({ error: 'Berkas video tidak dikenali sebagai ' + mType }); }
        if (!/^data:image\/webp;base64,/.test(String(b.preview || ''))) {
          await cleanTmp();
          return res.status(400).json({ error: 'Pratinjau video wajib ada' });
        }
      } else {
        const m = /^data:(image\/(?:webp|png|gif));base64,(.+)$/.exec(String(b.image || ''));
        if (!m) return res.status(400).json({ error: 'Gambar harus PNG, WebP, atau GIF' });
        mType = m[1];
        buf = Buffer.from(m[2], 'base64');
        if (!buf.length || buf.length > MAX_IMAGE_BYTES) {
          return res.status(413).json({ error: 'Gambar terlalu besar (maks sekitar 3.4 MB)' });
        }
      }
      const meta = cleanMeta(b, null);
      if (isVideoFrame) meta.kind = 'video';
      if (meta.kind === 'video' && cleanAreas.length !== 1) {
        return res.status(400).json({ error: 'Bingkai video harus punya tepat 1 lubang' });
      }

      const id = crypto.randomBytes(6).toString('hex');
      const blob = await putAuto('snapin/frames/' + id + '.' + (isVideoFrame ? VIDEO_MIME[mType] : MIME[mType]), buf, {
        contentType: mType,
        addRandomSuffix: false,
      });
      for (const t of tmpParts) { try { await deleteBlob(t.url); } catch (e) { /* abaikan */ } }
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
        contentType: mType,
        animated: isVideoFrame ? true : !!b.animated,
        mediaType: isVideoFrame ? 'video' : 'image',
        duration: isVideoFrame ? (num(b.duration, 0.5, 600) || 0) : 0,
        holeRadius: num(b.holeRadius, 0, 3000) || 0,
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
      if (f.mediaType === 'video') f.kind = 'video';
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

    // ---- stiker bawaan dari admin ----
    if (req.method === 'GET' && action === 'sticker-list') {
      const { stickers } = await readStickers();
      return res.status(200).json({ cats: STICKER_CATS, stickers: stickers.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).map(publicSticker) });
    }
    if (req.method === 'POST' && action === 'sticker-save') {
      const b = req.body || {};
      const label = String(b.label || '').trim().slice(0, 40) || 'Stiker';
      const cat = STICKER_CATS.includes(b.cat) ? b.cat : 'doodle';
      const m = /^data:(image\/(?:webp|png));base64,(.+)$/.exec(String(b.image || ''));
      if (!m) return res.status(400).json({ error: 'Stiker harus PNG atau WebP (transparan)' });
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > MAX_STICKER_BYTES) return res.status(413).json({ error: 'Stiker terlalu besar (maks sekitar 1,1 MB). Kecilkan ukurannya.' });
      const id = crypto.randomBytes(6).toString('hex');
      const blob = await putAuto('snapin/stickers/' + id + '.' + MIME[m[1]], buf, { contentType: m[1], addRandomSuffix: false });
      const { stickers, blobs } = await readStickers();
      const rec = { id, label, cat, blobUrl: blob.url, contentType: m[1], createdAt: Date.now() };
      stickers.push(rec);
      await writeStickers(stickers, blobs);
      return res.status(200).json({ ok: true, sticker: publicSticker(rec) });
    }
    if (req.method === 'POST' && action === 'sticker-update') {
      const b = req.body || {};
      const { stickers, blobs } = await readStickers();
      const s = stickers.find((x) => x.id === String(b.id || ''));
      if (!s) return res.status(404).json({ error: 'Stiker tidak ditemukan' });
      if (b.label !== undefined) s.label = String(b.label || '').trim().slice(0, 40) || s.label;
      if (b.cat !== undefined && STICKER_CATS.includes(b.cat)) s.cat = b.cat;
      await writeStickers(stickers, blobs);
      return res.status(200).json({ ok: true, sticker: publicSticker(s) });
    }
    if (req.method === 'POST' && action === 'sticker-delete') {
      const id = String((req.body && req.body.id) || '');
      const { stickers, blobs } = await readStickers();
      const s = stickers.find((x) => x.id === id);
      if (!s) return res.status(404).json({ error: 'Stiker tidak ditemukan' });
      try { await deleteBlob(s.blobUrl); } catch (e) { /* abaikan */ }
      await writeStickers(stickers.filter((x) => x.id !== id), blobs);
      return res.status(200).json({ ok: true });
    }

    // ---- tema buatan admin ----
    if (req.method === 'GET' && action === 'theme-list') {
      const { themes } = await readThemes();
      return res.status(200).json({ types: THEME_TYPES, themes: themes.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) });
    }
    if (req.method === 'POST' && action === 'theme-save') {
      const b = req.body || {};
      const { themes, blobs } = await readThemes();
      if (themes.length >= 60) return res.status(400).json({ error: 'Maksimal 60 tema' });
      const rec = { id: crypto.randomBytes(6).toString('hex'), name: String(b.name || '').trim().slice(0, 30) || 'Tema', pat: cleanPat(b.pat), createdAt: Date.now() };
      themes.push(rec);
      await writeThemes(themes, blobs);
      return res.status(200).json({ ok: true, theme: rec });
    }
    if (req.method === 'POST' && action === 'theme-update') {
      const b = req.body || {};
      const { themes, blobs } = await readThemes();
      const t = themes.find((x) => x.id === String(b.id || ''));
      if (!t) return res.status(404).json({ error: 'Tema tidak ditemukan' });
      if (b.name !== undefined) t.name = String(b.name || '').trim().slice(0, 30) || t.name;
      if (b.pat !== undefined) t.pat = cleanPat(b.pat);
      t.updatedAt = Date.now();
      await writeThemes(themes, blobs);
      return res.status(200).json({ ok: true, theme: t });
    }
    if (req.method === 'POST' && action === 'theme-delete') {
      const id = String((req.body && req.body.id) || '');
      const { themes, blobs } = await readThemes();
      if (!themes.some((x) => x.id === id)) return res.status(404).json({ error: 'Tema tidak ditemukan' });
      await writeThemes(themes.filter((x) => x.id !== id), blobs);
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
      const buyLink = normalizeBuyLink(b.buyLink);
      const shopName = String(b.shopName || 'Snapin').trim().slice(0, 40) || 'Snapin';
      const { blobs } = await readSettings();
      await writeDoc(SETTINGS_PREFIX, { gates, buyLink, shopName }, blobs);
      return res.status(200).json({ ok: true, buyLink });
    }
    // Tes pembuatan QRIS (hanya admin): menampilkan jawaban PunyaKios yang sudah disamarkan, untuk mencari sebab QRIS gagal dibuat
    if (req.method === 'POST' && action === 'qris-test') {
      const amount = Math.max(1000, Math.min(50000, Math.round(Number((req.body || {}).amount) || 1000)));
      const ext = 'SNQTEST' + crypto.randomBytes(5).toString('hex').toUpperCase();
      try {
        const r = await payCreate(ext, amount, 'Tes Snapin');
        const dd = (r.data && r.data.data) || {};
        const qr = [dd.qris_string, dd.qr_string, dd.qris, dd.qr_code].find((v) => typeof v === 'string' && v.length > 20) || '';
        const tot = Number(dd.total_amount != null ? dd.total_amount : dd.amount);
        return res.status(200).json({
          ok: true, http: r.http, apiOk: r.ok, amount, total: Number.isFinite(tot) ? tot : null, feeAmount: dd.fee_amount != null ? dd.fee_amount : null,
          hasQr: !!qr, fields: Object.keys(dd), message: String((r.data && (r.data.message || r.data.error || dd.message)) || '').slice(0, 160),
          expiresAt: dd.expires_at || null,
        });
      } catch (e) {
        return res.status(200).json({ ok: false, code: (e && e.code) || 'ERR', error: String((e && e.message) || 'gagal').slice(0, 160) });
      }
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
