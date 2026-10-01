// self-check ของ parseDesc ใน index.html — ใช้: node tools/test-parse-desc.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const parseDesc = new Function(src.match(/function parseDesc[\s\S]*?\n}\n/)[0] + 'return parseDesc;')();

const eq = (raw, want) => assert.deepStrictEqual(parseDesc(raw), want, raw);
eq('แรงดัน: MV (22-33 kV.)\nสำรวจจัดทำแผน: 18 ต้น - เบาบาง (10-40 ต้น/กม.)\nสำรวจราคากลาง:  ต้น -',
  { voltage: 'MV (22-33 kV.)', plan_trees: 18, density_label: 'เบาบาง', density_range: '10-40 ต้น/กม.', price_trees: null });
eq('แรงดัน: MV (22-33 kV.)\nสำรวจจัดทำแผน: 2 ต้น - ที่โล่ง\nสำรวจราคากลาง:  ต้น -',
  { voltage: 'MV (22-33 kV.)', plan_trees: 2, density_label: 'ที่โล่ง', density_range: null, price_trees: null });
eq('แรงดัน: LV<br>สำรวจจัดทำแผน:  ต้น -<br/>สำรวจราคากลาง: 15 ต้น - ปานกลาง (41-80 ต้น/กม.)',
  { voltage: 'LV', plan_trees: null, density_label: null, density_range: null, price_trees: 15 });
eq('', { voltage: null, plan_trees: null, density_label: null, density_range: null, price_trees: null });
console.log('parseDesc ok');
