import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateChampionStats, getStatPointBreakpoints} from '../optimizador-data.js';

const data = {
  pool: [{
    name: 'Mega Aggron',
    hpBase: 70, atkBase: 140, defBase: 230,
    spaBase: 60, spdBase: 80, speBase: 50
  }],
  reference: {
    natures: {
      adamant: {plus: 'atk', minus: 'spa'}
    }
  }
};

test('Mega Aggron Adamant reproduces the 9-to-10 PC Attack jump', () => {
  assert.equal(calculateChampionStats(data, 'Mega Aggron', [0,9,0,0,0,0], 'adamant')[1], 185);
  assert.equal(calculateChampionStats(data, 'Mega Aggron', [0,10,0,0,0,0], 'adamant')[1], 187);
});

test('stat breakpoints report the exact PC value and actual rounded stat gain', () => {
  const points = getStatPointBreakpoints(data, 'Mega Aggron', 'adamant', 1);
  const threshold = points.find(entry => entry.points === 10);
  assert.deepEqual(threshold, {points:10, value:187, previousValue:185, gain:2});
  assert.deepEqual(points.find(entry => entry.points === 9),
    {points:9, value:185, previousValue:184, gain:1});
});

test('HP breakpoints reflect one point per PC except for Shedinja', () => {
  assert.deepEqual(
    getStatPointBreakpoints(data, 'Mega Aggron', 'adamant', 0).slice(0,3).map(entry => entry.points),
    [1,2,3]
  );
  const shedinja = {...data, pool:[{...data.pool[0],name:'Shedinja',hpBase:1}]};
  assert.deepEqual(getStatPointBreakpoints(shedinja, 'Shedinja', 'adamant', 0), []);
});

test('rejects an invalid stat index', () => {
  assert.throws(() => getStatPointBreakpoints(data, 'Mega Aggron', 'adamant', 6), /índice/);
});
