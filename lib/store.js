import { put, del, list } from '@vercel/blob';
import crypto from 'node:crypto';

// Daftar bingkai disimpan sebagai satu file JSON di Vercel Blob.
// Setiap simpan membuat file baru (nama unik) lalu menghapus yang lama,
// jadi tidak ada masalah cache dan tidak butuh fitur "overwrite".
const DATA_PREFIX = 'snapin/data-';

export async function readFrames() {
  const { blobs } = await list({ prefix: DATA_PREFIX });
  if (!blobs || !blobs.length) return { frames: [], blobs: [] };
  const sorted = blobs.slice().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const r = await fetch(sorted[0].url, { cache: 'no-store' });
  if (!r.ok) return { frames: [], blobs: sorted };
  const json = await r.json();
  return { frames: Array.isArray(json.frames) ? json.frames : [], blobs: sorted };
}

export async function writeFrames(frames, oldBlobs) {
  const body = JSON.stringify({ version: 1, frames });
  await put(DATA_PREFIX + Date.now() + '.json', body, {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: true,
  });
  for (const b of oldBlobs || []) {
    try { await del(b.url); } catch (e) { /* abaikan */ }
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
