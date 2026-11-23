const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');

const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/);
assert.ok(core, '页面需要包含可独立检查的核心函数');
const analyze = runInNewContext(`${core[1]}\nanalyze`, {}, { timeout: 1000 });
const at = (time, day = '2026-11-24') => `${day} ${time}`;
const line = (service, start, end) => [service, start, end].join('\t');
const window = (start, end, service = '示例网关') => line(service, at(start), at(end));
const check = (...rows) => analyze(rows.join('\r\n'));

test('同一服务相交 30 分钟并保留原行号', () => {
  const { conflicts } = check(window('09:00', '10:30'), '', window('10:00', '11:00', ' 示例网关 '));
  assert.equal(conflicts.length, 1);
  const [c] = conflicts;
  assert.deepEqual([c.a.line, c.b.line, c.minutes], [1, 3, 30]);
});

test('相接端点和不同服务均不算重叠', () => {
  const r = check(window('09:00', '10:00'), window('10:00', '11:00'), window('09:30', '10:30', '示例索引'));
  assert.equal(r.valid.length, 3);
  assert.equal(r.conflicts.length, 0);
});

test('跨日窗口正常比较', () => {
  const r = check(line('示例', at('23:45'), at('00:30', '2026-11-25')), line('示例', at('00:00', '2026-11-25'), at('00:45', '2026-11-25')));
  assert.equal(r.conflicts[0].minutes, 30);
});

test('闰日、早期公历年份和非法日期逐行校验', () => {
  const r = check(...['2024-02-29', '2026-02-29', '0001-01-01', '0000-01-01'].map(day => line('示例', at('00:00', day), at('01:00', day))));
  assert.deepEqual(Array.from(r.valid, x => x.line), [1, 3]);
  assert.deepEqual(Array.from(r.errors, x => x.line), [2, 4]);
});

test('非法时分、空服务、错列和无效区间全部报告', () => {
  const r = check(window('24:00', '25:00'), window('10:60', '11:00'), window('11:00', '10:00'), window('11:00', '11:00'), window('10:00', '11:00', ''), '列数不对', window('11:00', '12:00'));
  assert.deepEqual(Array.from(r.errors, x => x.line), [1, 2, 3, 4, 5, 6]);
  assert.equal(r.valid[0].line, 7);
});

test('三个相交窗口得到三个不同配对', () => {
  const r = check(window('09:00', '12:00'), window('10:00', '11:00'), window('10:30', '13:00'));
  assert.deepEqual(Array.from(r.conflicts, x => `${x.a.line}:${x.b.line}:${x.minutes}`), ['1:2:60', '1:3:90', '2:3:30']);
});

test('空输入、上限整 300 行及超限', () => {
  const empty = check('', '\t ', ' ');
  assert.equal(empty.errors.length + empty.valid.length + empty.conflicts.length, 0);
  assert.equal(check(...Array.from({length: 300}, (_, i) => window('10:00', '11:00', `示例${i}`))).valid.length, 300);
  const rejected = check(...Array(301).fill(window('10:00', '11:00')));
  assert.equal(rejected.valid.length + rejected.conflicts.length, 0);
  assert.equal(rejected.errors.length, 1);
  assert.match(rejected.errors[0].msg, /超过上限 300 行/);
});
