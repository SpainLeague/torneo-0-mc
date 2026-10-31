import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Mega Starmie has corrected Attack values in both pool sources', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const htmlEntries = [...html.matchAll(/\\{[^{}]*"name":"Mega Starmie"[^{}]*\\}/g)];
  assert.equal(htmlEntries.length, 1, 'There must be exactly one Mega Starmie entry in index.html');

  const pool = JSON.parse(readFileSync(new URL('../pool-data.json', import.meta.url), 'utf8'));
  const poolEntries = pool.filter(entry => entry.name === 'Mega Starmie');
  assert.equal(poolEntries.length, 1, 'There must be exactly one Mega Starmie entry in pool-data.json');

  for (const entry of [JSON.parse(htmlEntries[0][0]), poolEntries[0]]) {
    assert.equal(entry.atkBase, 100);
    assert.equal(entry.atk50, 120);
  }
  assert.equal(pool.find(entry => entry.name === 'Starmie')?.atkBase, 75,
    'The base Starmie entry must not be modified by the Mega correction');
});
