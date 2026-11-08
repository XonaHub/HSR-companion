import test from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers.mjs';

const ev = loadScripts('status.js');
const J = v => JSON.stringify(v);
const call = (fn, ...args) => ev(`${fn}(...${J(args)})`);
const NOW = Date.parse('2026-11-08T12:00:00Z');
const MIN = 60000, H = 60 * MIN, D = 24 * H;

test('ago_parts', () => {
  assert.equal(call('agoParts', null, NOW), null);
  assert.deepEqual(call('agoParts', NOW - 30000, NOW), ['ago_now', 0]);
  assert.deepEqual(call('agoParts', NOW + 5 * MIN, NOW), ['ago_now', 0]);   // horloge en avance : pas de durée négative
  assert.deepEqual(call('agoParts', NOW - 5 * MIN, NOW), ['ago_min', 5]);
  assert.deepEqual(call('agoParts', NOW - 3 * H - 10 * MIN, NOW), ['ago_h', 3]);
  assert.deepEqual(call('agoParts', NOW - 2 * D - H, NOW), ['ago_d', 2]);
});

test('game_data_alert', () => {
  const start = NOW - H;
  assert.equal(call('gameDataAlert', null, NOW, start), null);
  assert.equal(call('gameDataAlert', { downloaded: false, checkedAt: NOW - 2 * H }, NOW, start), null);
  // échec récent, mais vérifié il y a moins de 24 h : pas d'alerte
  assert.equal(call('gameDataAlert', { checkedAt: NOW - 10 * H, failedAt: NOW - MIN }, NOW, start), null);
  // échec et dernière réussite trop ancienne, ou jamais réussie
  assert.equal(call('gameDataAlert', { checkedAt: NOW - 2 * D, failedAt: NOW - MIN }, NOW, start), 'failing');
  assert.equal(call('gameDataAlert', { failedAt: NOW - MIN }, NOW, start), 'failing');
  // ancienne vérification mais pas d'échec noté (pas encore relancée) : pas d'alerte
  assert.equal(call('gameDataAlert', { checkedAt: NOW - 3 * D }, NOW, start), null);
  // échec plus ancien que la dernière réussite : effacé
  assert.equal(call('gameDataAlert', { checkedAt: NOW - 2 * D, failedAt: NOW - 3 * D }, NOW, start), null);
  // données téléchargées après le lancement : relancer
  assert.equal(call('gameDataAlert', { downloaded: true, updatedAt: NOW - MIN, checkedAt: NOW - MIN }, NOW, start), 'pending');
  assert.equal(call('gameDataAlert', { downloaded: true, updatedAt: NOW - 2 * H, checkedAt: NOW - 2 * H }, NOW, start), null);
});

test('prydwen_summary', () => {
  assert.deepEqual(call('prydwenSummary', []), { n: 0, errors: 0, fetchedAt: null, stale: false });
  assert.deepEqual(call('prydwenSummary', [{ fetchedAt: 5, stale: false }, 'error', { fetchedAt: 9, stale: true }]),
    { n: 2, errors: 1, fetchedAt: 9, stale: true });
});

test('is_offline', () => {
  assert.equal(call('isOffline', {}), false);
  assert.equal(call('isOffline', { game: 'ok', news: 'ok' }), false);
  assert.equal(call('isOffline', { game: 'ok', news: 'offline' }), true);
});
