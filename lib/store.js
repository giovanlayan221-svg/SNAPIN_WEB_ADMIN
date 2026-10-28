import { put, del, list, get } from '@vercel/blob';
import crypto from 'node:crypto';

// Daftar bingkai disimpan sebagai satu file JSON di Vercel Blob.
// Setiap simpan membuat file baru (nama unik) lalu menghapus yang lama,
// jadi tidak ada masalah cache dan tidak butuh fitur "overwrite".
const DATA_PREFIX = 'snapin/data-';

// Autentikasi: di Vercel, SDK memakai OIDC + BLOB_STORE_ID otomatis (tanpa token).
// Kalau project masih memakai token lama, variabel *_READ_WRITE_TOKEN dipakai.
export function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find((k) => k.endsWith('_READ_WRITE_TOKEN') && process.env[k]);
  return key ? process.env[key] : undefined;
}

function opts(extra) {
  const token = blobToken();
  return token ? { ...extra, token } : { ...extra };
}

export function friendlyError(e) {
  const m = String((e && e.message) || e || '');
  if (/No token found|credential|OIDC|store id/i.test(m)) {
    return 'Server belum bisa mengakses Vercel Blob. Di Vercel: Storage > Blob lu > Projects, pastikan store terhubung ke project ini, lalu Redeploy. (' + m.slice(0, 120) + ')';
  }
  return m;
}

// Store Blob bisa "public" atau "private" (dipilih saat dibuat, tidak bisa diubah).
// Kode ini mendeteksi sendiri mana yang dipakai.
let storeAccess = null;

export async function putAuto(pathname, body, extra) {
  const order = storeAccess ? [storeAccess] : ['public', 'private'];
  let firstError = null;
  for (const access of order) {
    try {
      const res = await put(pathname, body, opts({ ...extra, access }));
      storeAccess = String(res.url).includes('.private.') ? 'private' : 'public';
      return res;
    } catch (e) {
      if (!firstError) firstError = e;
    }
  }
  throw firstError;
}

// Baca isi blob (cocok untuk store public maupun private)
export async function readBlob(url) {
  if (String(url).includes('.private.')) {
    const result = await get(url, opts({ access: 'private' }));
    if (!result || result.statusCode !== 200) throw new Error('Blob tidak ditemukan');
    const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
    return { buffer, contentType: result.blob && result.blob.contentType };
  }
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Blob tidak ditemukan');
  return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') };
}

export async function deleteBlob(url) {
  await del(url, opts({}));
}

export async function readFrames() {
  const { blobs } = await list(opts({ prefix: DATA_PREFIX }));
  if (!blobs || !blobs.length) return { frames: [], blobs: [] };
  const sorted = blobs.slice().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  try {
    const { buffer } = await readBlob(sorted[0].url);
    const json = JSON.parse(buffer.toString('utf8'));
    return { frames: Array.isArray(json.frames) ? json.frames : [], blobs: sorted };
  } catch (e) {
    return { frames: [], blobs: sorted, readError: e };
  }
}

export async function writeFrames(frames, oldBlobs) {
  const body = JSON.stringify({ version: 1, frames });
  await putAuto(DATA_PREFIX + Date.now() + '.json', body, {
    contentType: 'application/json',
    addRandomSuffix: true,
  });
  for (const b of oldBlobs || []) {
    try { await deleteBlob(b.url); } catch (e) { /* abaikan */ }
  }
}

export function isAdmin(req) {
  const pw = process.env.ADMIN_PASSWORD || '';
  const given = String(req.headers['x-admin-password'] || '');
  if (!pw || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(pw);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return 'https://' + host;
}
