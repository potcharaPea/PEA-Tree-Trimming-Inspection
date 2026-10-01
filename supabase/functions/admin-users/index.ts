// Edge Function: จัดการผู้ใช้ — เรียกได้เฉพาะผู้ดูแลระบบ (profiles.is_admin)
// คำสั่ง (POST JSON { action, ... }): list · create · set_password · set_active · delete
// service_role key อยู่ในตัวแปรของ Supabase เท่านั้น ไม่อยู่ในโค้ดฝั่งแอป
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const bad = (error: string) => json({ error }, 400);
const BAN_FOREVER = '876000h';   // ~100 ปี = ปิดบัญชี

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    // ตรวจผู้เรียก: token ต้องถูกต้อง และเป็นผู้ดูแลระบบ
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
    const { data: me } = await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
    if (!me?.is_admin) return json({ error: 'เฉพาะผู้ดูแลระบบ' }, 403);

    const b = await req.json();
    const pw = String(b.password || '');

    if (b.action === 'list') {
      const { data: profiles, error } = await admin.from('profiles').select('*').order('office_id').order('role').order('username');
      if (error) throw error;
      const auth: Record<string, { banned_until?: string; last_sign_in_at?: string }> = {};
      for (let page = 1; ; page++) {
        const { data, error: e } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        if (e) throw e;
        data.users.forEach(u => { auth[u.id] = u as never; });
        if (data.users.length < 1000) break;
      }
      const now = Date.now();
      return json({ users: profiles.map(p => ({ ...p,
        active: !(auth[p.id]?.banned_until && Date.parse(auth[p.id].banned_until!) > now),
        last_sign_in_at: auth[p.id]?.last_sign_in_at || null })) });
    }

    if (b.action === 'create') {
      const username = String(b.username || '').trim().toLowerCase(), office = String(b.office_id || '');
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) return bad('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–32 ตัว');
      if (!['inspector', 'contractor'].includes(b.role)) return bad('บทบาทไม่ถูกต้อง');
      if (pw.length < 6) return bad('รหัสผ่านอย่างน้อย 6 ตัว');
      if (b.role === 'contractor' && !String(b.company || '').trim()) return bad('กรุณากรอกชื่อบริษัท/หจก. ของผู้รับจ้าง');
      const { data: off } = await admin.from('offices').select('id').eq('id', office).maybeSingle();
      if (!off) return bad('ไม่พบการไฟฟ้านี้');
      const { data: c, error: e1 } = await admin.auth.admin.createUser({ email: `${username}@${office}.local`, password: pw, email_confirm: true });
      if (e1) return bad(/already|exists|registered/i.test(e1.message) ? 'ชื่อผู้ใช้นี้มีอยู่แล้วในการไฟฟ้านี้' : e1.message);
      const { error: e2 } = await admin.from('profiles').insert({ id: c.user!.id, office_id: office, username, role: b.role,
        full_name: String(b.full_name || '').trim(), company: b.role === 'contractor' ? String(b.company).trim() : null });
      if (e2) { await admin.auth.admin.deleteUser(c.user!.id); throw e2; }   // ไม่ทิ้งบัญชีที่ไม่มีโปรไฟล์
      return json({ ok: true });
    }

    if (b.action === 'set_password') {
      if (pw.length < 6) return bad('รหัสผ่านอย่างน้อย 6 ตัว');
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: pw });
      if (error) throw error;
      return json({ ok: true });
    }

    if (b.action === 'set_active' || b.action === 'delete') {
      if (b.user_id === user.id) return bad('ปิดหรือลบบัญชีของตัวเองไม่ได้');
      if (b.action === 'delete') {
        // ลบจริงได้เฉพาะบัญชีที่ยังไม่มีประวัติ — ถ้ามีประวัติ (FK) ให้ปิดบัญชีแทน ประวัติการตรวจจะไม่พัง
        const { error } = await admin.auth.admin.deleteUser(b.user_id);
        if (!error) return json({ ok: true, deleted: true });
        const { error: e } = await admin.auth.admin.updateUserById(b.user_id, { ban_duration: BAN_FOREVER });
        if (e) throw e;
        return json({ ok: true, deleted: false });
      }
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { ban_duration: b.active ? 'none' : BAN_FOREVER });
      if (error) throw error;
      return json({ ok: true });
    }

    return bad('คำสั่งไม่ถูกต้อง');
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
