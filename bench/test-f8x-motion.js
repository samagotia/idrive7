'use strict';
// Deterministic renderer/socket exercise, not a measurement of the car's CPU/GPU.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const motion = require('../shared/f8x_motion');
const sprite = require('../shared/f82_sprite');
const { ClusterRender } = require('../shared/cluster_render_client');
const root = path.resolve(__dirname, '..');

const needle = new motion.NeedleMotion();
assert.equal(needle.sample(-120, 0), -120, 'startup snaps to the first real reading');
assert.equal(needle.sample(-110, 10), -120);
assert(needle.sample(-110, 28) > -120 && needle.sample(-110, 28) < -110);
assert.equal(needle.sample(-110, 46), -110, 'a small step settles in 36ms');
needle.sample(120, 50);
assert(needle.duration <= 100);
for (let now = 50; now <= 150; now++) {
    const angle = needle.sample(120, now);
    assert(angle >= -110 && angle <= 120, 'large step never overshoots');
}
assert.equal(needle.sample(120, 150), 120, 'a large step settles within 100ms');
needle.sample(-120, 160);
for (let now = 160; now <= 260; now++) assert(needle.sample(-120, now) >= -120);
assert.equal(needle.sample(null, 270), null, 'invalid data immediately clears motion');
assert.equal(needle.sample(42, 271), 42, 'recovery snaps to the fresh reading');
needle.sample(80, 280);
assert.equal(needle.sample(10, 200), 10, 'a backwards clock does not leave a stale transition');
assert.equal(motion.framePlan(0, 100000).delay, 0, 'a backwards clock does not stall the frame scheduler');

for (const outward of [-1, 1]) {
    let previous = -1;
    for (let step = 0; step <= 108; step++) {
        const degrees = outward * (step - 54), t = step / 108;
        const glass = sprite.glassPose(degrees, outward);
        assert(glass.opacity >= previous && glass.opacity <= 1, 'glass reveal is monotone across the full arc');
        assert.equal(glass.opacity, Math.min(1, (t + 0.3 * t * (1 - t)) * 1.25));
        assert.equal(glass.sx, (0.9 + 0.1 * t) * 1.10);
        assert.deepEqual(glass, sprite.glassPose(-degrees, -outward), 'glass remains mirrored');
        previous = glass.opacity;
    }
    assert.equal(sprite.glassPose(-54 * outward, outward).opacity, 0, 'translucent wall fades at the inward stop');
    assert(sprite.glassPose(-53 * outward, outward).opacity > 0, 'wall stays present just beyond the inward stop');
}

const layout = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster/layouts/our_m4.json'), 'utf8'));
const fronts = layout.widgets.filter((w) => w.signal && w.shadow);
const widgets = fronts.concat(fronts.map(sprite.shadowOf), fronts.filter((w) => w.glass).map(sprite.glassOf));

function exercise(fps, light) {
    let now = 0, wallOffset = 0, nextTimer = 1, values = { speed: 0, rpm: 1000, fuel: 0.5, oil: 120 };
    const timers = new Map(), writes = [], allPoses = new Map();
    const clear = (id) => timers.delete(id);
    const module = { exports: {} };
    const delay = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, at: now + ms }); return id; };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
        module, Buffer, Date: { now: () => now + wallOffset }, setTimeout: delay, clearTimeout: clear,
        clearInterval: clear, process: { env: {}, uptime: () => now / 1000 },
        require: (name) => name === './f82_sprite' ? sprite : name === './f8x_motion'
            ? { ...motion, framePlan: (at, nextAt) => motion.framePlan(at, nextAt, fps) } : {},
    }, { filename: 'f8x_runtime.js' });
    const Runtime = module.exports, client = new ClusterRender('motion-test', '/tmp/no-car');
    client.connected = client.ready = true;
    client.sock = { write(bytes) { writes.push(Buffer.from(bytes)); return true; } };
    const runtime = Object.assign(Object.create(Runtime.prototype), {
        f82Light: light, f82Needles: [], f82Motion: new Map(), f82NextFrameAt: null,
        f82Timer: null, f82SentAt: 0, client, stopped: false,
        _guard: (label, fn) => fn(), _testRpm: () => null,
        _raw: (signal) => values[signal], car: { data: () => ({ ...values, condition: 2 }) },
    });
    for (const w of widgets) {
        const ref = client.image({ target: 'panel', x: w.x, y: w.y, w: w.w, h: w.h, iw: 24, ih: 135 });
        const x = { w, ref, c: client, last: null };
        runtime.f82Needles.push(x); runtime._updateF82(x, now, true);
    }
    writes.length = 0;
    const cpuAt = process.cpuUsage();
    let sample = 0;
    function advance(until, moving) {
        while (true) {
            let selected = null;
            for (const [id, timer] of timers) if (!selected || timer.at < selected.timer.at) selected = { id, timer };
            const sampleAt = moving ? sample * 50 : Infinity;
            if ((!selected || selected.timer.at > until) && sampleAt > until) break;
            if (sampleAt <= (selected ? selected.timer.at : Infinity)) {
                now = sampleAt; sample++;
                if (now === 5000) wallOffset = -3600000; // user/NTP clock change must not stop motion
                const p = (Math.sin(now / 1500) + 1) / 2;
                values = { speed: p * 330, rpm: 1000 + p * 7000, fuel: p, oil: 70 + p * 100 };
                runtime._queueF82();
            } else {
                now = selected.timer.at; timers.delete(selected.id); selected.timer.fn();
                const poses = new Map(runtime.f82Needles.map((x) => [x.w.id, client.layers.get(x.ref).opts]));
                for (const x of runtime.f82Needles.filter((e) => e.w.needleId)) {
                    const own = poses.get(x.w.id), front = poses.get(x.w.needleId);
                    if (own.visible && front.visible) assert.equal(own.rotate, front.rotate, 'front/shadow/glass share one drawn angle');
                }
            }
        }
        now = until;
    }
    advance(10000, true);
    advance(10200, false); // finish the final settlement
    const cpu = process.cpuUsage(cpuAt);
    const count = writes.length, bytes = writes.reduce((sum, b) => sum + b.length, 0);
    assert(writes.every((b) => b[4] === 0x4a), 'movement sends no pixel frames or geometry');
    assert(writes.every((b) => JSON.parse(b.subarray(5)).op === 'set'), 'movement uses plain pose commands only');
    assert.equal(timers.size, 0, 'settled needles stop their frame timer');
    runtime._queueF82(); advance(10300, false);
    assert.equal(writes.length, count, 'a stationary sample sends no commands');
    // Invalid data hides immediately, then the next valid sample snaps without a catch-up sweep.
    now = 10400; values.rpm = null;
    runtime.f82Needles.filter((x) => x.w.signal === 'rpm').forEach((x) => runtime._updateF82(x, now, false));
    now = 10401; values.rpm = 1500;
    const rpm = runtime.f82Needles.find((x) => x.w.signal === 'rpm' && !x.w.shadowOnly);
    runtime._updateF82(rpm, now, false);
    assert.equal(client.layers.get(rpm.ref).opts.rotate, Math.round(sprite.rpmAngle(rpm.w.curve, 1500, false) * 100) / 100);
    runtime.layouts = {}; runtime.rpmLimit = runtime.cruise = { stop() {} };
    runtime.clients = []; runtime.atlases = new Map(); runtime.car.stop = () => {};
    runtime._queueF82(); assert(timers.size > 0);
    runtime.stop();
    assert.equal(timers.size, 0, 'stop cancels the frame timer');
    assert.equal(runtime.f82Motion.size, 0, 'stop clears all interpolation state');
    return { fps, light, commandsPerSecond: +(count / 10.2).toFixed(1), KiBPerSecond: +(bytes / 1024 / 10.2).toFixed(2),
        pixelWrites: 0, hostCpuMs: +((cpu.user + cpu.system) / 1000).toFixed(2) };
}

const results = [exercise(30, 'day'), exercise(60, 'day'), exercise(30, 'night'), exercise(60, 'night')];
assert(results[1].commandsPerSecond > results[0].commandsPerSecond);
assert(results[3].commandsPerSecond > results[2].commandsPerSecond);
assert(results.every((r) => r.KiBPerSecond < 60), 'four moving needles and companions stay within a modest pose payload');
results.forEach((result) => console.log(JSON.stringify(result)));
console.log('F8X motion: bounded settling, no overshoot, coherent companion layers, invalid recovery, stationary silence and pose-only 30/60Hz payload passed.');
