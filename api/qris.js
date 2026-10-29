import crypto from 'node:crypto';
import {
  readFrames, readDoc, writeDoc, readSettings, signOrder, verifyOrder, unlockToken, cors,
  PACKS_PREFIX, SALES_PREFIX, FEATURES,
} from '../lib/store.js';
import { payCreate, payStatus } from '../lib/punyakios.js';

// Pembayaran QRIS dinamis (PunyaKios) tanpa login — sama alurnya dengan GVSUPERZSTORE:
//  create -> QR tampil di aplikasi -> pembeli bayar -> check (status resmi PunyaKios "paid") -> kunci dibuka di HP.
// Tidak ada akun: server tidak menyimpan pesanan. Pesanan dibawa sebagai token bertanda tangan (HMAC),
// hak buka (unlock) berupa token yang terikat ke ID perangkat dan dikirim balik setelah PunyaKios memastikan "paid".
const PAID = new Set(['paid', 'success', 'settlement', 'completed', 'berhasil']);
const WINDOW_MS = 24 * 3600e3;
const MIN_IDR = 1000, MAX_IDR = 5000000;

const rp = (n) => 'Rp' + Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
function pubPack(p) {
  return { id: p.id, label: p.label, priceIdr: p.priceIdr, price: rp(p.priceIdr), all: !!p.all, frameCount: p.all ? 0 : (p.frameIds || []).length, features: p.features || [], note: p.note || '' };
}
function extId() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.randomBytes(14);
  let s = 'SNQ';
  for (let i = 0; i < 14; i++) s += a[b[i] % a.length];
  return s;
}

async function recordSale(p, total) {
  try {
    const { data, blobs } = await readDoc(SALES_PREFIX, { sales: [] });
    const sales = Array.isArray(data.sales) ? data.sales : [];
    if (sales.some((x) => x.ext === p.ext)) return;
    sales.push({ ext: p.ext, at: Date.now(), label: p.label, type: p.type, base: p.base, total, dev: String(p.dev).slice(0, 8) });
    await writeDoc(SALES_PREFIX, { sales: sales.slice(-1000) }, blobs);
  } catch (e) { /* catatan penjualan hanya pelengkap */ }
}

export default async function handler(req, res) {
  cors(res);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'no-store');
  try {
    const b = (req.method === 'POST' ? req.body : req.query) || {};
    const action = String(b.action || (req.query && req.query.action) || 'catalog');

    if (action === 'catalog') {
      const { frames } = await readFrames();
      const { data } = await readDoc(PACKS_PREFIX, { packs: [] });
      const { settings } = await readSettings();
      return res.status(200).json({
        ok: true,
        qrisReady: !!(process.env.PUNYAKIOS_API_KEY && process.env.PUNYAKIOS_API_SECRET),
        shopName: settings.shopName,
        buyLink: settings.buyLink,
        gates: settings.gates,
        features: FEATURES,
        frames: frames.filter((f) => f.isPremium && f.priceIdr >= MIN_IDR).map((f) => ({ id: f.id, label: f.label, priceIdr: f.priceIdr, price: rp(f.priceIdr) })),
        packs: (data.packs || []).filter((p) => p.active !== false && p.priceIdr >= MIN_IDR).map(pubPack),
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Metode salah' });

    if (action === 'create') {
      const dev = String(b.deviceId || '').slice(0, 64);
      const type = b.type === 'pack' ? 'pack' : 'frame';
      const id = String(b.id || '');
      if (dev.length < 8 || !id) return res.status(400).json({ error: 'Data tidak lengkap' });
      let item;
      if (type === 'frame') {
        const { frames } = await readFrames();
        const f = frames.find((x) => x.id === id);
        if (!f || !f.isPremium || !(f.priceIdr >= MIN_IDR)) return res.status(404).json({ error: 'Bingkai ini tidak dijual lewat QRIS' });
        item = { label: f.label, base: f.priceIdr, grant: { ids: [f.id] } };
      } else {
        const { data } = await readDoc(PACKS_PREFIX, { packs: [] });
        const p = (data.packs || []).find((x) => x.id === id && x.active !== false);
        if (!p || !(p.priceIdr >= MIN_IDR)) return res.status(404).json({ error: 'Paket tidak ditemukan' });
        item = { label: p.label, base: p.priceIdr, grant: { all: !!p.all, ids: p.all ? [] : (p.frameIds || []).slice(0, 100), features: p.features || [] } };
      }
      const base = Math.round(item.base);
      if (base < MIN_IDR || base > MAX_IDR) return res.status(400).json({ error: 'Harga tidak valid' });
      const ext = extId(), now = Date.now();
      let r;
      try { r = await payCreate(ext, base, 'Snapin ' + item.label); }
      catch (e) { return res.status(502).json({ error: e.code === 'NOCFG' ? 'Pembayaran QRIS belum diaktifkan di server.' : 'Pembayaran belum bisa dibuat sekarang. Coba lagi sebentar.' }); }
      const dd = (r.data && r.data.data) || {};
      const qr = [dd.qris_string, dd.qr_string, dd.qris, dd.qr_code].find((v) => typeof v === 'string' && v.length > 20) || '';
      const tot = Number(dd.total_amount != null ? dd.total_amount : dd.amount);
      const fee = dd.fee_amount != null && Number.isFinite(Number(dd.fee_amount)) ? Number(dd.fee_amount) : tot - base;
      // batas wajar: tarif QRIS sekitar 0,7% + Rp200
      const sane = r.ok && qr && Number.isFinite(tot) && tot >= base && fee >= 0 && tot - base === fee && fee <= Math.round(base * 0.03) + 300;
      if (!sane) {
        console.warn('qris create ditolak: HTTP', r.http, Object.keys(dd).join(','));
        return res.status(502).json({ error: 'Pembayaran belum bisa dibuat sekarang. Coba lagi sebentar.' });
      }
      const pe = Date.parse(dd.expires_at);
      const expiresAt = Number.isFinite(pe) && pe > now ? Math.min(pe, now + WINDOW_MS) : now + WINDOW_MS;
      const payload = { v: 1, ext, dev, type, id, label: item.label, base, exp: expiresAt, cr: now, grant: item.grant };
      return res.status(200).json({ ok: true, orderToken: signOrder(payload), qris: qr, base, payFee: fee, total: tot, expiresAt, label: item.label });
    }

    if (action === 'check') {
      const p = verifyOrder(b.orderToken);
      if (!p || !/^SNQ[A-Z0-9]{10,30}$/.test(String(p.ext || ''))) return res.status(400).json({ error: 'Pesanan tidak valid' });
      const now = Date.now();
      let r;
      try { r = await payStatus(p.ext); }
      catch (e) { return res.status(200).json({ ok: true, status: now > p.exp ? 'kadaluarsa' : 'menunggu' }); }
      const dd = (r.data && r.data.data) || {};
      const st = String(dd.status || '').toLowerCase();
      if (!r.ok || !PAID.has(st)) return res.status(200).json({ ok: true, status: now > p.exp ? 'kadaluarsa' : 'menunggu' });
      const amt = Number(dd.total_amount != null ? dd.total_amount : dd.amount);
      const maxPay = p.base + Math.max(10000, Math.round(p.base * 0.05));
      if (!(Number.isFinite(amt) && amt >= p.base && amt <= maxPay)) return res.status(200).json({ ok: true, status: 'selisih' });
      // pembayaran sah: keluarkan hak buka yang terikat ke perangkat ini
      const g = p.grant || {};
      const tokens = { all: null, ids: {}, features: {} };
      if (g.all) tokens.all = unlockToken(p.dev, 'all');
      (g.ids || []).forEach((id) => { tokens.ids[id] = unlockToken(p.dev, id); });
      (g.features || []).forEach((k) => { tokens.features[k] = unlockToken(p.dev, 'feature:' + k); });
      recordSale(p, amt);
      return res.status(200).json({ ok: true, status: 'selesai', label: p.label, tokens });
    }

    return res.status(400).json({ error: 'Aksi tidak dikenal' });
  } catch (e) {
    console.error('qris', e && e.message);
    return res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
}
