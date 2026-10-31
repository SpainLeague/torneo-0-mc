import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

function readEmbeddedPoolEntry(html, name) {
  const token = '"name":"' + name + '"';
  const nameIndex = html.indexOf(token);
  assert.notEqual(nameIndex, -1, name + ' must exist in index.html');
  assert.equal(html.indexOf(token, nameIndex + token.length), -1,
    'There must be exactly one ' + name + ' entry in index.html');
  const entryStart = html.lastIndexOf('{', nameIndex);
  const entryEnd = html.indexOf('}', nameIndex);
  return JSON.parse(html.slice(entryStart, entryEnd + 1));
}

test('Mega Starmie has corrected Attack values without changing base Starmie', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const megaHtml = readEmbeddedPoolEntry(html, 'Mega Starmie');
  const baseHtml = readEmbeddedPoolEntry(html, 'Starmie');

  const pool = JSON.parse(readFileSync(new URL('../pool-data.json', import.meta.url), 'utf8'));
  const megaPool = pool.filter(entry => entry.name === 'Mega Starmie');
  const basePool = pool.filter(entry => entry.name === 'Starmie');
  assert.equal(megaPool.length, 1);
  assert.equal(basePool.length, 1);

  for (const entry of [megaHtml, megaPool[0]]) {
    assert.equal(entry.atkBase, 100);
    assert.equal(entry.atk50, 120);
  }
  for (const entry of [baseHtml, basePool[0]]) {
    assert.equal(entry.atkBase, 75);
    assert.equal(entry.atk50, 95);
  }
});
