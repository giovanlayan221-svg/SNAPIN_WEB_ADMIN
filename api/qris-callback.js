import { verifyWebhook } from '../lib/punyakios.js';

// Webhook PunyaKios (opsional). Aplikasi Snapin mengecek status pembayaran sendiri, jadi webhook ini
// hanya mengiyakan ping/uji koneksi supaya dashboard PunyaKios menganggap URL-nya sehat.
// Catatan: PunyaKios hanya punya SATU URL webhook per akun. Kalau akun yang sama dipakai GVSUPERZSTORE,
// biarkan webhook di sana; pembayaran Snapin tetap terkonfirmasi lewat pengecekan dari aplikasi.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Method not allowed' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  if (!process.env.PUNYAKIOS_API_SECRET) return res.status(500).json({ status: false, message: 'PUNYAKIOS_API_SECRET belum diisi' });
  if (String(b.event || '') === 'test_ping') return res.status(200).json({ status: 'ok', message: 'Ping connection verified' });
  if (!verifyWebhook(req.headers['x-punyakios-signature'], b)) return res.status(401).json({ status: false, message: 'Invalid signature' });
  return res.status(200).json({ status: 'ok', message: 'Received' });
}
