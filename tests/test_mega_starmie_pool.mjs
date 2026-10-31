import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Mega Starmie pool entry uses the corrected Champions base and level-50 Attack', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const entries = [...html.matchAll(/\{[^{}]*"name":"Mega Starmie"[^{}]*\}/g)];
  assert.equal(entries.length, 1, 'There must be exactly one Mega Starmie pool entry');
  const entry = entries[0][0];
  assert.match(entry, /"atkBase":100/);
  assert.match(entry, /"atk50":120/);
  assert.doesNotMatch(entry, /"atkBase":140|"atk50":160/);
});
