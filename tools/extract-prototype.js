// แตก "ตัวอย่าง index/index.html" (Claude Design bundle) → "ตัวอย่าง index/extracted/"
// ใช้: node tools/extract-prototype.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const dir = path.join(__dirname, '..', 'ตัวอย่าง index');
const out = path.join(dir, 'extracted');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const block = t => {
  const open = `<script type="__bundler/${t}">`, a = html.indexOf(open);
  return JSON.parse(html.slice(a + open.length, html.indexOf('</script>', a)));
};
const manifest = block('manifest'), template = block('template');
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

const ext = { 'text/javascript': '.js', 'text/css': '.css', 'text/html': '.html', 'application/json': '.json',
  'image/svg+xml': '.svg', 'image/png': '.png', 'image/jpeg': '.jpg', 'font/woff2': '.woff2' };
const index = [];
for (const [uuid, a] of Object.entries(manifest)) {
  let buf = Buffer.from(a.data, 'base64');
  if (a.compressed) buf = zlib.gunzipSync(buf);
  const name = uuid + (ext[a.mime] || '.bin');
  fs.writeFileSync(path.join(out, 'assets', name), buf);
  index.push({ uuid, mime: a.mime, bytes: buf.length, file: 'assets/' + name });
}
fs.writeFileSync(path.join(out, 'assets.json'), JSON.stringify(index, null, 2));
fs.writeFileSync(path.join(out, 'template.html'), template);

// แยก <script> / <style> ใน template ออกเป็นไฟล์ให้อ่านง่าย
let n = 0;
template.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (_, attrs, body) => {
  if (body.trim()) fs.writeFileSync(path.join(out, `template-script-${++n}.js`), `// attrs: ${attrs}\n` + body);
});
n = 0;
template.replace(/<style[^>]*>([\s\S]*?)<\/style>/g, (_, body) => {
  if (!/@font-face/.test(body)) fs.writeFileSync(path.join(out, `template-style-${++n}.css`), body);
});
console.log(index.map(i => `${i.mime}\t${i.bytes}\t${i.file}`).join('\n'));

// markup อย่างเดียว (ตัด @font-face / script) + จัดบรรทัดให้อ่านง่าย
const markup = template
  .replace(/<style[^>]*>[^<]*@font-face[\s\S]*?<\/style>/g, '')
  .replace(/<script([^>]*)>[\s\S]*?<\/script>/g, '<script$1>…</script>')
  .replace(/>\s*</g, '>\n<');
fs.writeFileSync(path.join(out, 'markup.html'), markup);

// ข้อความภาษาไทยทั้งหมด (markup + logic) ไม่ซ้ำ
const logic = fs.readFileSync(path.join(out, 'template-script-1.js'), 'utf8');
const th = new Set();
for (const src of [markup, logic]) for (const m of src.matchAll(/[^<>{}'"`\n]*[฀-๿][^<>{}'"`\n]*/g)) th.add(m[0].trim());
fs.writeFileSync(path.join(out, 'ui-text-th.txt'), [...th].filter(Boolean).join('\n'));

// โครงหน้าจอแบบไม่มี style="" (อ่านโครงสร้าง/ข้อความง่ายขึ้น)
const body = markup.slice(markup.indexOf('</helmet>'));
fs.writeFileSync(path.join(out, 'markup-skeleton.html'), body.replace(/\s+style="[^"]*"/g, ''));
