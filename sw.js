// Service Worker — เปิดแอปได้ตอนไม่มีเน็ต
// แก้ index.html แล้วอยากให้เครื่องผู้ใช้ได้ไฟล์ใหม่ทันที → เปลี่ยนเลขเวอร์ชันนี้
const CACHE = 'tree-v1';
const APP = ['./', './index.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js',
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Sarabun:wght@400;500;600;700;800&display=swap'];

self.addEventListener('install', e => {
  // allSettled: CDN ตัวไหนโหลดไม่ได้ก็ไม่ทำให้ติดตั้งล้ม
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(APP.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res.ok || res.type === 'opaque') caches.open(CACHE).then(c => c.put(req, res.clone())); return res; };
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // ตัวแอป: เอาใหม่จากเน็ตก่อน ไม่มีเน็ตค่อยใช้ของในเครื่อง
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => put('./index.html', r)).catch(() => caches.match('./index.html')));
    return;
  }
  // รูปจาก Storage: signed URL เปลี่ยน token ทุกครั้ง → จับคู่โดยไม่สนใจ query
  if (url.pathname.includes('/storage/v1/object/sign/')) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(r => put(req, r))));
    return;
  }
  // Supabase API / realtime: ไม่ cache (แอปจัดการออฟไลน์เองด้วย IndexedDB)
  if (url.hostname.endsWith('supabase.co')) return;
  // library, ฟอนต์, tile แผนที่: ใช้ของในเครื่องก่อน ไม่มีค่อยโหลดแล้วเก็บไว้
  // ponytail: tile ที่เก็บได้คือเฉพาะที่เคยเปิดดูตอนมีเน็ต และไม่จำกัดขนาด cache (เบราว์เซอร์ล้างเองเมื่อพื้นที่ใกล้เต็ม)
  if (/unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|tile\.openstreetmap\.org|arcgisonline\.com/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => put(req, r))));
  }
});
