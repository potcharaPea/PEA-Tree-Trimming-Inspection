// Edge Function: ส่งแจ้งเตือนบนมือถือ (Web Push) — เรียกจาก trigger push_notify() ใน schema.sql เท่านั้น
// body: { table, type: INSERT|UPDATE, record } · ยืนยันผู้เรียกด้วย header x-push-secret = secret PUSH_SECRET
// secrets ที่ต้องตั้ง: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SECRET · deploy แบบ --no-verify-jwt
// ผู้รับ: งานของผู้รับจ้าง → ผู้ตรวจของการไฟฟ้านั้น · งานของผู้ตรวจ → ผู้รับจ้างของ Feeder · ไม่ส่งให้คนที่ทำเอง
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
webpush.setVapidDetails('https://potcharapea.github.io/PEA-Tree-Trimming-Inspection/', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

type Row = Record<string, any>;
const one = async (table: string, cols: string, id: string): Promise<Row> => (id && (await db.from(table).select(cols).eq('id', id).maybeSingle()).data) || {};
const inspectors = async (office: string) => ((await db.from('profiles').select('id').eq('office_id', office).eq('role', 'inspector')).data || []).map(p => p.id);
const contractors = async (fid: string) => ((await db.from('feeder_contractors').select('contractor_id').eq('feeder_id', fid)).data || []).map(x => x.contractor_id);
const nameOf = async (id: string) => { const p = await one('profiles', 'company,full_name', id); return p.company || p.full_name || ''; };
const day = (d: string) => { const [y, m, dd] = (d || '').split('-').map(Number); return y ? `${dd}/${m}/${y + 543}` : ''; };
const pad4 = (n: number) => 'D-' + String(n).padStart(4, '0');

// รายการใหม่ → { to: ผู้รับ, actor: คนทำ, title, body, nav: hash ที่แอปใช้เปิดหน้า } หรือ null = ไม่แจ้ง
async function build(table: string, type: string, r: Row) {
  // defect_events ไม่มี feeder_id/segment_id → หาผ่าน defects
  const d = table === 'defect_events' ? await one('defects', 'id,code_no,issue_type,segment_id,feeder_id', r.defect_id) : null;
  const f = await one('feeders', 'id,code,office_id', d ? d.feeder_id : r.feeder_id);
  const seq = (await one('segments', 'seq', d ? d.segment_id : table === 'segments' ? r.id : r.segment_id)).seq;
  if (!f.id) return null;
  const at = `${f.code} ช่วงที่ ${seq}`, segNav = `f=${f.id}&s=${seq}`;
  if (table === 'segment_works') {
    if (r.kind === 'progress') return null;
    return { to: await inspectors(f.office_id), actor: r.actor_id, nav: segNav,
      title: r.kind === 'started' ? 'ผู้รับจ้างเริ่มตัด' : 'ผู้รับจ้างแจ้งตัดเสร็จ · รอตรวจ', body: `${at} · ${await nameOf(r.actor_id)}` };
  }
  if (d) {
    const code = pad4(d.code_no);
    const title = ({ fix_submitted: 'ผู้รับจ้างส่งหลักฐานแก้ไข ' + code, created: 'พบจุดบกพร่องใหม่ ' + code, rejected: 'ไม่ผ่าน ส่งกลับแก้ไข ' + code, passed: code + ' ตรวจผ่านแล้ว' } as Row)[r.kind];
    if (!title) return null;
    return { to: r.kind === 'fix_submitted' ? await inspectors(f.office_id) : await contractors(f.id), actor: r.actor_id, nav: `f=${f.id}&d=${d.id}`,
      title, body: `${at} · ${d.issue_type}${r.note ? ' · ' + r.note : ''}` };
  }
  if (table === 'segments')
    return { to: await contractors(f.id), actor: r.passed_by, nav: segNav, title: `ช่วงที่ ${seq} ผ่านทั้งช่วง`, body: f.code };
  if (table === 'outage_requests') {
    if (type === 'INSERT') return { to: await inspectors(f.office_id), actor: r.actor_id, nav: segNav,
      title: 'ผู้รับจ้างขอดับไฟ', body: `${at} · วันที่ ${day(r.want_date)}${r.want_time ? ' ' + r.want_time : ''}` };
    if (r.status === 'confirmed') return { to: [r.actor_id], actor: r.decided_by, nav: segNav,
      title: 'นัดดับไฟแล้ว', body: `${at} · วันที่ ${day(r.ok_date)}${r.ok_time ? ' ' + r.ok_time : ''}` };
    if (r.status === 'rejected') return { to: [r.actor_id], actor: r.decided_by, nav: segNav,
      title: 'ไม่อนุมัติคำขอดับไฟ', body: `${at}${r.reply ? ' · ' + r.reply : ''}` };
  }
  return null;
}

Deno.serve(async req => {
  if (req.headers.get('x-push-secret') !== Deno.env.get('PUSH_SECRET')) return new Response('forbidden', { status: 403 });
  try {
    const { table, type, record } = await req.json();
    const m = await build(table, type, record);
    const to = m ? m.to.filter((id: string) => id && id !== m.actor) : [];
    if (!m || !to.length) return new Response('skip');
    const { data: subs } = await db.from('push_subs').select('*').in('user_id', to);
    const payload = JSON.stringify({ title: m.title, body: m.body, nav: m.nav });
    await Promise.all((subs || []).map(async s => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 }); }
      catch (e: any) {   // เครื่องที่ถอนสิทธิ์/ลบแอปแล้ว → ลบทิ้ง
        if (e.statusCode === 404 || e.statusCode === 410) await db.from('push_subs').delete().eq('endpoint', s.endpoint);
        else console.error('push', e.statusCode, e.body || e.message);
      }
    }));
    return new Response('sent ' + (subs || []).length);
  } catch (e: any) {
    console.error(e);
    return new Response(e.message, { status: 500 });
  }
});
