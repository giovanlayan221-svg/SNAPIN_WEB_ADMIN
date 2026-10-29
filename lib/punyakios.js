// Klien PunyaKios (QRIS dinamis) — hanya dipakai di server. Sama seperti yang dipakai GVSUPERZSTORE.
// Variabel di Vercel: PUNYAKIOS_API_KEY, PUNYAKIOS_API_SECRET, (opsional) PUNYAKIOS_BASE_URL
import crypto from 'node:crypto';

const DEF_BASE = 'https://punyakios.id/api/v1/partner';
const TIMEOUT_MS = 15000;

function cfg() {
  const key = process.env.PUNYAKIOS_API_KEY, secret = process.env.PUNYAKIOS_API_SECRET;
  const base = String(process.env.PUNYAKIOS_BASE_URL || DEF_BASE).trim().replace(/\/+$/, '');
  if (!key || !secret) { const e = new Error('PunyaKios belum diatur di server (PUNYAKIOS_API_KEY / PUNYAKIOS_API_SECRET)'); e.code = 'NOCFG'; throw e; }
  if (!/^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(base)) { const e = new Error('PUNYAKIOS_BASE_URL harus diawali https://'); e.code = 'NOCFG'; throw e; }
  return { key, secret, base };
}

function scrub(v, ks) {
  let t = JSON.stringify(v === undefined ? null : v);
  for (const k of ks) if (k && String(k).length >= 4) t = t.split(String(k)).join('***');
  return JSON.parse(t);
}

async function call(path, body) {
  const { key, secret, base } = cfg();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let r, text;
  try {
    r = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-API-KEY': key, 'X-API-SECRET': secret },
      body: JSON.stringify(body || {}),
      signal: ctl.signal,
    });
    text = await r.text();
  } catch (e) {
    const err = new Error(e && e.name === 'AbortError' ? 'PunyaKios tidak merespons' : 'Gagal menghubungi PunyaKios');
    err.code = e && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK';
    throw err;
  } finally { clearTimeout(timer); }
  let data;
  try { data = JSON.parse(text); } catch (e) { const err = new Error('Respons PunyaKios bukan JSON (HTTP ' + r.status + ')'); err.code = 'BADRESP'; throw err; }
  return { ok: r.ok, http: r.status, data: scrub(data, [key, secret]) };
}

// Biaya QRIS ditanggung pembeli (fee_charge_to: user), sama seperti GVSUPERZSTORE.
export const payCreate = (extId, amount, description) => call('/payment-request', {
  external_id: extId, amount, description: String(description || '').slice(0, 200), payment_method: 'qris', fee_charge_to: 'user',
});
export const payStatus = (extId) => call('/check-status', { external_id: extId });

function webhookString(b) {
  b = b || {};
  if (String(b.event || '') === 'product_update') return 'product_update.' + (b.action == null ? '' : b.action) + '.' + (b.count == null ? 0 : b.count) + '.' + (b.timestamp == null ? '' : b.timestamp);
  const ref = b.ref_id != null ? b.ref_id : (b.external_id != null ? b.external_id : '');
  return ref + '.' + (b.status == null ? '' : b.status) + '.' + (b.amount == null ? '' : b.amount);
}
export function verifyWebhook(sigHeader, body) {
  const secret = process.env.PUNYAKIOS_API_SECRET;
  if (!secret || !sigHeader) return false;
  const exp = Buffer.from(crypto.createHmac('sha256', secret).update(webhookString(body)).digest('hex'));
  const got = Buffer.from(String(sigHeader).trim().toLowerCase());
  return exp.length === got.length && crypto.timingSafeEqual(exp, got);
}
