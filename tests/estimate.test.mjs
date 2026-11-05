import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('data.js', 'estimate.js');
// Version 4.6 : 44 jours, 2 compensations de 300 jades, un événement à 500 jades, un autre à 10 passes
const V46 = {
  start: '2026-09-28T06:00:00+08:00', end: '2026-11-11T06:00:00+08:00',
  rewards: [{ label: 'Compensation', jades: 600, passes: 0 }],
  events: [{ name: 'Souhaissence', jades: 500, passes: 0 }, { name: 'Cadeau de l’odyssée', jades: 0, passes: 10 }],
};
const run = (v, opts) => ev(`estimateVersionPulls(${JSON.stringify(v)}, ${JSON.stringify(opts)})`);
const line = (r, key) => r.lines.find(l => l.key === key);

test('days_from_version_dates', () => {
  assert.equal(run(V46, { express: false }).days, 44);
});

test('daily_and_express_lines', () => {
  const I = ev('PULL_INCOME');
  assert.equal(I.dailyJades, 60);
  assert.equal(I.expressJades, 90);
  const without = run(V46, { express: false });
  assert.equal(line(without, 'daily').jades, 44 * 60);
  assert.equal(line(without, 'express'), undefined);
  assert.equal(line(run(V46, { express: true }), 'express').jades, 44 * 90);
});

test('explicit_amounts_from_patch_note', () => {
  const r = run(V46, { express: false });
  assert.equal(line(r, 'rewards').jades, 600);
  assert.equal(line(r, 'events').jades, 500);
  assert.equal(line(r, 'events').passes, 10);
});

test('embers_passes_counted_as_pulls', () => {
  const I = ev('PULL_INCOME');
  const r = run(V46, { express: false });
  assert.equal(line(r, 'embers').passes, 2 * I.embersPassesPerMonth); // 44 jours : 2 mois commencés
});

test('totals_and_pulls', () => {
  const r = run(V46, { express: true });
  assert.equal(r.jades, r.lines.reduce((a, l) => a + l.jades, 0));
  assert.equal(r.passes, r.lines.reduce((a, l) => a + l.passes, 0));
  assert.equal(r.pulls, Math.floor(r.jades / 160) + r.passes);
});

test('null_without_dates', () => {
  assert.equal(run({ ...V46, end: null }, { express: false }), null);
  assert.equal(run({ events: [] }, { express: false }), null);
});
