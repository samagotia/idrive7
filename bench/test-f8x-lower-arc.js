'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprite = require('../shared/f82_sprite');
const shaders = require('../shared/f8x_shaders');
const root = path.resolve(__dirname, '..');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/layouts/our_m4.json')));
const read = (id) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/f82', id + '.json')));
const arc = sprite.lowerArcOf(layout, read);
assert.equal(arc.x + arc.arcCenter[0], 1294);
assert.equal(arc.y + arc.arcCenter[1], 351);
assert.deepEqual(arc.arcRadii, [258.5, 258.5]);
assert.equal(arc.arcThickness, 8);
assert(arc.y > 530 && arc.y + arc.h < 625, 'arc clears gear and leaves bottom row space');
assert.equal(sprite.lowerArcOf({ widgets: [] }, read), null);
const scaled = JSON.parse(JSON.stringify(layout));
for (const w of scaled.widgets) {
    w.x = w.x * 0.8 + 50; w.y *= 0.8; w.w *= 0.8; w.h *= 0.8;
}
const small = sprite.lowerArcOf(scaled, read);
assert(Math.abs(small.x + small.arcCenter[0] - (1294 * 0.8 + 50)) < 1e-9);
assert(Math.abs(small.y + small.arcCenter[1] - 351 * 0.8) < 1e-9);
assert(Math.abs(small.arcRadii[0] - 258.5 * 0.8) < 1e-9);
assert(Math.abs(small.arcThickness - 6.4) < 1e-9);
const runtimeModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer, require: (name) => name === './f8x_shaders' ? shaders : {},
});
const Runtime = runtimeModule.exports;
const uniforms = [];
let effects = 0;
const transport = {
    effect(opts) { effects++; assert.equal(opts.fs, shaders.f8xarc); return 7; },
    image() { throw new Error('The arc must not allocate a bitmap'); },
    pixels() { throw new Error('The arc must not upload pixels'); },
    uniform(ref, name, value) { assert.equal(ref, 7); uniforms.push([name, value]); },
};
const state = { _clientAt: () => transport, _connOf: () => 0, widgets: new Map(),
    f82Light: 'day', theme: {}, _update: Runtime.prototype._update };
Runtime.prototype._create.call(state, arc);
assert.equal(effects, 1);
assert.equal(uniforms.length, 6, 'geometry and colour initialized once');
const x = state.widgets.get(arc.id);
for (let i = 0; i < 100; i++) state._update(x, i, false);
assert.equal(uniforms.length, 6, 'stationary arc sends no repeated commands');
state.f82Light = 'night'; state._update(x, 101, false);
assert.equal(uniforms.length, 7);
assert.equal(uniforms.at(-1)[0], 'u_color');
assert.deepEqual(Array.from(uniforms.at(-1)[1]), arc.nightColor.map((v) => v / 255));
console.log('F8X lower arc: tachometer alignment, scaled placements, gear clearance, native effect without image memory, cached lighting and no idle updates passed.');
