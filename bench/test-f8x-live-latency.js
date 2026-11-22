'use strict';
// Actual runtime/client with deterministic source and clock; not a car FPS test.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprite = require('../shared/f82_sprite');
const motion = require('../shared/f8x_motion');
const { ClusterRender } = require('../shared/cluster_render_client');
const wire = require('./renderer-wire');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
let now = 0, timerId = 0;
const timers = new Map(), writes = [], values = { speed: 0, rpm: 1000 };
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/f8x_runtime.js'), 'utf8'), {
    module: moduleStub, Buffer, Date: { now: () => now }, process: { env: {}, uptime: () => now / 1000 },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) { return name === './f82_sprite' ? sprite : name === './f8x_motion' ? motion : {}; },
});
const client = new ClusterRender('live-latency-test', '/tmp/no-car');
client.ready = client.connected = true;
client.sock = { write(bytes) { writes.push({ at: now, bytes: Buffer.from(bytes) }); return true; } };
const runtime = Object.assign(Object.create(moduleStub.exports.prototype), {
    f82Light: 'day', f82Needles: [], f82Motion: new Map(), f82NextFrameAt: null,
    f82Timer: null, client, stopped: false, _guard: (_, fn) => fn(),
    _testRpm: () => null, _raw: (key) => values[key], car: { data: () => values },
});
const fronts = layout.widgets.filter((w) => w.signal === 'speed' || w.signal === 'rpm');
for (const w of fronts.concat(fronts.map(sprite.shadowOf))) {
    const ref = client.image({ target: 'panel', x: w.x, y: w.y, w: w.w, h: w.h, iw: 2, ih: 2 });
    const x = { ref, c: client, w, last: null };
    runtime.f82Needles.push(x); runtime._updateF82(x, now, true, now);
}
writes.length = 0;
function advance(until) {
    let count = 0;
    while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (timer.at > until) break;
        assert(++count < 1000); now = timer.at; timers.delete(id); timer.fn();
    }
    now = until;
}
const rpm = runtime.f82Needles.find((x) => x.w.id === 'rpm_needle');
const angle = (rpmValue) => Math.round(sprite.rpmAngle(rpm.w.curve, rpmValue, false) * 100) / 100;
values.rpm = 5000; runtime._queueF82(); advance(0);
assert.equal(client.layers.get(rpm.ref).opts.rotate, angle(5000), 'first eligible frame uses latest RPM, without 36ms easing');
assert.equal(writes.length, 1, 'RPM blade and shadow use a single stream write');
assert.equal(wire.frames([writes[0].bytes]).length, 2);
assert.equal(timers.size, 0, 'fast needles add no follow-up interpolation timer');
values.rpm = 1500; now = 1; runtime._queueF82(); advance(17);
assert.equal(client.layers.get(rpm.ref).opts.rotate, angle(1500), 'reversal follows the newest sample by the next60Hz frame');
assert(writes[1].at <= 17, 'frame gate adds at most one display interval');

// Multiple 100Hz samples before a frame replace the target rather than queueing history.
writes.length = 0;
for (let at = 20; at <= 1020; at += 10) {
    advance(at); values.rpm = 1500 + at; values.speed = at / 10; runtime._queueF82(); advance(at);
}
advance(1040);
assert(writes.length <= 62, '100Hz source cannot create more than a60Hz pose stream');
assert.equal(client.layers.get(rpm.ref).opts.rotate, angle(values.rpm));
for (const write of writes) {
    const commands = wire.frames([write.bytes]).map((b) => {
        assert.equal(b[4], 0x4a, 'no bitmap or mesh upload while needles move');
        return JSON.parse(b.slice(5));
    });
    assert(commands.every((m) => m.op === 'set'));
    assert.equal(new Set(commands.map((m) => m.ref)).size, commands.length, 'one pose per layer per frame');
    const pair = commands.filter((m) => m.ref === rpm.ref || m.ref === runtime.f82Needles.find((x) => x.w.needleId === 'rpm_needle').ref);
    if (pair.length === 2) assert.equal(pair[0].rotate, pair[1].rotate, 'shadow and blade share a delivered frame');
}
const count = writes.length;
runtime._queueF82(); advance(1100);
assert.equal(writes.length, count, 'unchanged values create no further socket writes');
assert.equal(timers.size, 0);
values.rpm = null; runtime._queueF82(); advance(1120);
assert.equal(client.layers.get(rpm.ref).opts.visible, false, 'invalid RPM is hidden without easing');
values.rpm = 2000; runtime._queueF82(); advance(1140);
assert.equal(client.layers.get(rpm.ref).opts.rotate, angle(2000), 'valid recovery uses current reading');
console.log('F8X live latency: no extra RPM/speed easing, one coherent wire write per frame, newest-value60Hz cap, bounded reversal, idle silence and invalid recovery passed.');
