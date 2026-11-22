'use strict';
// Native animation protocol and deterministic motion checks, not a car FPS measurement.
const assert = require('assert').strict;
const { NativeNeedleMotion, applyNativeRotation } = require('../shared/f8x_motion');
const { ClusterRender } = require('../shared/cluster_render_client');
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, a + ' differs from ' + b);

const motion = new NativeNeedleMotion();
assert.equal(motion.segment, null);
assert.equal(motion.sample(-120, 0), -120);
assert.equal(motion.segment.snap, true);
const initial = motion.change;
assert.equal(motion.sample(-120, 20), -120);
assert.equal(motion.change, initial, 'unchanged targets do not restart native animations');
assert.equal(motion.sample(-100, 40), -120);
assert.equal(motion.duration, 50, 'small sample gaps are bounded');
close(motion.sample(-100, 65), -110);
const beforeReverse = motion.valueAt(70);
close(motion.sample(-130, 70), beforeReverse);
assert.equal(motion.segment.from, beforeReverse, 'a reversal begins at the current rendered angle');
for (let now = 70; now <= 120; now++) {
    const value = motion.sample(-130, now);
    assert(value <= beforeReverse && value >= -130, 'no overshoot on reversal');
}
assert.equal(motion.sample(-130, 120), -130);
assert.equal(motion.moving(120), false);
motion.sample(100, 1000);
assert.equal(motion.duration, 120, 'a long sample gap does not create excessive lag');
assert.equal(motion.sample(null, 1001), null);
assert.equal(motion.segment, null);
assert.equal(motion.sample(42, 1002), 42, 'fresh data after invalidity snaps instead of replaying stale motion');
motion.sample(60, 1050);
assert.equal(motion.sample(10, 900), 10, 'a backwards clock resets to the fresh reading');
assert.equal(motion.segment.snap, true);
motion.sample(20, 900);
assert.equal(motion.duration, 80, 'a zero sample interval uses the bounded default');
assert.equal(motion.moving(899), false);

const client = new ClusterRender('native-motion-test');
const writes = [];
client.connected = true;
client.sock = { write(message) { writes.push(JSON.parse(message.subarray(5).toString())); return true; } };
const ref = client.image({ target: 'panel', x: 0, y: 0, w: 26, h: 283, iw: 26, ih: 283 });
let anim = 0;
for (let i = 0; i < 1000; i++) {
    const id = applyNativeRotation(client, ref, [[0, i / 10], [80, (i + 1) / 10]], anim);
    assert(id > 0); if (anim) assert.equal(id, anim);
    anim = id;
}
const layer = client.layers.get(ref);
assert.equal(layer.anims.size, 1, 'retiming keeps a single native rotation animation per layer');
assert.equal(layer.nextAnim, 2, 'a new animation ID is not allocated for every sample');
const rotations = writes.filter((message) => message.op === 'animate');
assert.equal(rotations.length, 1000);
assert(rotations.every((message) => message.anim === anim && message.property === 'rotate'
    && message.loop === 0 && message.interp === 'linear'));
assert.equal(layer.anims.get(anim).keys, '0:99.9 80:100', 'reconnect replay retains the latest segment');
assert.equal(applyNativeRotation(client, ref, '0:1 80:2', anim), anim);
assert.equal(layer.anims.get(anim).keys, '0:1 80:2');

for (const keys of [[], [[0, 1]], [[0, 1], [0, 2]], [[0, 1], [10, NaN]], '0:1 10:2,3']) {
    assert.equal(applyNativeRotation(client, ref, keys, anim), 0);
}
assert.equal(layer.anims.size, 0, 'invalid replacement stops the obsolete animation before direct-pose fallback');
assert.equal(applyNativeRotation({}, ref, [[0, 1], [80, 2]], 0), 0);
assert.equal(applyNativeRotation(client, 9999, [[0, 1], [80, 2]], 0), 0);
assert.equal(applyNativeRotation({ layers: new Map([[1, { anims: new Map() }]]),
    animate() { throw new Error('local native animation unavailable'); } }, 1, [[0, 1], [80, 2]], 0), 0);

// Every companion gets the identical rotation keys. Glass opacity/scale are
// separate concerns: the image protocol has no animated opacity property.
const refs = [ref, client.image({ target: 'panel', w: 26, h: 283 }),
    client.image({ target: 'panel', w: 26, h: 283 })];
const keys = [[0, -90], [100, 10]];
refs.forEach((r) => assert(applyNativeRotation(client, r, keys, 0)));
assert.deepEqual(refs.map((r) => Array.from(client.layers.get(r).anims.values())[0].keys),
    ['0:-90 100:10', '0:-90 100:10', '0:-90 100:10']);

console.log('F8X native motion: continuity, bounded latency, invalid/recovery handling, bounded retiming, replay, synchronized companion keys and local fallback passed.');
