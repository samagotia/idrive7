'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { pivotOf } = require('../shared/f8x_gauge_geometry');
const sprites = require('../shared/f82_sprite');
const root = path.resolve(__dirname, '../apps/samagotia_clusters/cluster');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'layouts/our_m4.json'), 'utf8'));
const load = (id) => JSON.parse(fs.readFileSync(path.join(root, 'f82', id + '.json'), 'utf8'));
const snapshot = JSON.stringify(layout);
for (const [signal, expected] of [['speed', [610, 343]], ['rpm', [1310, 343]], ['fuel', [160, 520]], ['oil', [1760, 520]]]) {
    assert.deepEqual(pivotOf(layout, signal, load), { x: expected[0], y: expected[1] });
    const needle = layout.widgets.find((w) => w.signal === signal);
    const moved = Object.assign({}, needle, { x: needle.x - 17, y: needle.y + 23 });
    assert.deepEqual(pivotOf({ widgets: [moved] }, signal, load), { x: expected[0] - 17, y: expected[1] + 23 });
    const scaled = Object.assign({}, needle, { x: 40, y: 30, w: needle.w * 1.1, h: needle.h * 0.9 });
    const asset = load(needle.asset), pivot = pivotOf({ widgets: [scaled] }, signal, load);
    assert(Math.abs(pivot.x - (40 + needle.pivot[0] * scaled.w / asset.w)) < 1e-10);
    assert(Math.abs(pivot.y - (30 + needle.pivot[1] * scaled.h / asset.h)) < 1e-10);
    assert.deepEqual(pivotOf({ widgets: [sprites.shadowOf(needle), needle] }, signal, load), { x: expected[0], y: expected[1] }, 'cast shadows are not dial centres');
    if (needle.glass) assert.deepEqual(pivotOf({ widgets: [sprites.glassOf(needle), needle] }, signal, load), { x: expected[0], y: expected[1] });
}
assert.equal(JSON.stringify(layout), snapshot, 'geometry queries preserve the saved layout');
for (const input of [null, {}, { widgets: [] }]) assert.equal(pivotOf(input, 'rpm', load), null);
assert.equal(pivotOf(layout, 'missing', load), null);
assert.equal(pivotOf(layout, 'rpm', () => ({})), null);
assert.equal(pivotOf(layout, 'rpm', () => ({ w: 0, h: 1 })), null);
assert.equal(pivotOf({ widgets: [{ type: 'f82sprite', signal: 'rpm', pivot: [1, NaN] }] }, 'rpm', () => ({ w: 1, h: 1 })), null);
console.log('F8X gauge geometry: actual centres, saved translations/scales, companion exclusion and invalid inputs passed.');
