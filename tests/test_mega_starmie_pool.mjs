import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Mega Starmie has corrected Attack values in both pool sources', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const nameToken = '"name":"Mega Starmie"';
  const nameIndex = html.indexOf(nameToken);
  assert.notEqual(nameIndex, -1, 'Mega Starmie must exist in index.html');
  assert.equal(html.indexOf(nameToken, nameIndex + nameToken.length), -1,
    'There must be exactly one Mega Starmie entry in index.html');
  const entryStart = html.lastIndexOf('{', nameIndex);
  const entryEnd = html.indexOf('}', nameIndex);
  const htmlEntry = JSON.parse(html.slice(entryStart, entryEnd + 1));

  const pool = JSON.parse(readFileSync(new URL('../pool-data.json', import.meta.url), 'utf8'));
  const poolEntries = pool.filter(entry => entry.name === 'Mega Starmie');
  assert.equal(poolEntries.length, 1, 'There must be exactly one Mega Starmie entry in pool-data.json');

  for (const entry of [htmlEntry, poolEntries[0]]) {
    assert.equal(entry.atkBase, 100);
    assert.equal(entry.atk50, 120);
  }
  assert.equal(pool.find(entry => entry.name === 'Starmie')?.atkBase, 75,
    'The base Starmie entry must not be modified by the Mega correction');
});
