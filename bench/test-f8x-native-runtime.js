'use strict';
// Actual runtime + renderer client, with only the clock/socket/providers simulated.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const motion = require('../shared/f8x_motion');
const sprite = require('../shared/f82_sprite');
const { ClusterRender } = require('../shared/cluster_render_client');
const root = path.resolve(__dirname, '..');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const fronts = layout.widgets.filter((w) => w.signal && w.shadow);
const widgets = fronts.concat(fronts.map(sprite.shadowOf), fronts.filter((w) => w.glass).map(sprite.glassOf));
const initial = { speed: 0, rpm: 1000, fuel: 0.5, oil: 120 };
const changed = { speed: 150, rpm: 6500, fuel: 0.9, oil: 160 };
const reversed = { speed: 30, rpm: 2000, fuel: 0.2, oil: 85 };
const shown = (w, light) => !(light === 'night' && w.shadowOnly && ['speed', 'rpm'].includes(w.signal));
const near = (actual, expected, reason) => assert(Math.abs(actual - expected) <= 0.011,
    reason + ': ' + actual + ' versus ' + expected);

function fixture(backend, environment, light) {
    let now = 0, nextTimer = 1, values = Object.assign({}, initial);
    const timers = new Map(), frames = [], warnings = [];
    const runtimeModule = { exports: {} };
    const delay = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, at: now + ms }); return id; };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
        module: runtimeModule, Buffer, Date: { now: () => now },
        process: { env: environment, uptime: () => now / 1000 },
        setTimeout: delay, clearTimeout: (id) => timers.delete(id),
        require: (name) => name === './f82_sprite' ? sprite : name === './f8x_motion' ? motion : {},
    }, { filename: 'f8x_runtime.js' });
    const Runtime = runtimeModule.exports;
    const client = new ClusterRender('native-runtime-test', '/tmp/no-car');
    client.connected = client.ready = true;
    client.backend = backend;
    client.sock = { write(bytes) { frames.push(Buffer.from(bytes)); return true; } };
    const runtime = Object.assign(Object.create(Runtime.prototype), {
        f82Light: light, f82Needles: [], f82Motion: new Map(), f82NextFrameAt: null,
        f82Timer: null, f82SentAt: 0, client, stopped: false,
        log: { info() {}, warn(message) { warnings.push(message); } },
        _guard: (label, fn) => fn(), _testRpm: () => null,
        _raw: (signal) => values[signal], car: { data: () => Object.assign({ condition: 2 }, values) },
    });
    for (const w of widgets) {
        const asset = JSON.parse(fs.readFileSync(path.join(root,
            'apps/samagotia_clusters/cluster/f82', w.asset + '.json'), 'utf8'));
        const ref = client.image({ target: 'panel', x: w.x, y: w.y, w: w.w, h: w.h,
            iw: asset.w, ih: asset.h, px: w.pivot[0] * w.w / asset.w, py: w.pivot[1] * w.h / asset.h });
        assert(ref);
        const x = { w, ref, c: client, last: null };
        runtime.f82Needles.push(x);
        runtime._updateF82(x, now, true, now);
    }
    runtime.widgets = new Map(runtime.f82Needles.map((x) => [x.w.id, x]));
    const messages = () => frames.map((b) => {
        assert.equal(b[4], 0x4a, 'needle updates never upload pixels or geometry');
        assert.equal(b.readUInt32LE(0), b.length - 4);
        return JSON.parse(b.subarray(5));
    });
    function advance(until) {
        let guard = 0;
        while (timers.size) {
            const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (timer.at > until) break;
            assert(++guard < 1000, 'frame scheduler must remain bounded');
            now = timer.at; timers.delete(id); timer.fn();
        }
        now = until;
    }
    function feed(at, next) {
        now = at; values = Object.assign({}, next); runtime._queueF82();
    }
    function sample(at, next) {
        feed(at, next);
        const due = Math.min(...[...timers.values()].map((t) => t.at));
        assert(Number.isFinite(due)); advance(due);
        return now;
    }
    function companions() {
        const byId = new Map(runtime.f82Needles.map((x) => [x.w.id, x]));
        for (const x of runtime.f82Needles.filter((x) => x.w.needleId)) {
            const front = byId.get(x.w.needleId);
            const own = client.layers.get(x.ref), main = client.layers.get(front.ref);
            if (!shown(x.w, light)) {
                assert.equal(own.opts.visible, false, 'Night main-dial shadows remain hidden');
                assert.equal(own.anims.size, 0);
                continue;
            }
            assert.equal(own.opts.visible, main.opts.visible, 'companions share visibility');
            near(own.opts.rotate, main.opts.rotate, 'companions share direct angle');
            if (own.anims.size) {
                assert.equal(own.anims.size, 1);
                assert.equal([...own.anims.values()][0].keys, [...main.anims.values()][0].keys,
                    'front, shadow and glass have identical native rotation keys');
            }
        }
    }
    return { runtime, client, frames, timers, warnings, feed, sample, advance, messages, companions,
        now: () => now, reset: () => { frames.length = 0; } };
}

for (const light of ['day', 'night']) {
    const f = fixture('ramses-test', {}, light);
    const animatedCount = widgets.filter((w) => shown(w, light)).length;
    assert(f.runtime._nativeF82Motion());
    for (const x of f.runtime.f82Needles) {
        if (!shown(x.w, light)) {
            assert.equal(f.client.layers.get(x.ref).opts.visible, false);
            continue;
        }
        const angle = x.w.signal === 'rpm' ? sprite.rpmAngle(x.w.curve, initial.rpm, false)
            : sprite.angle(x.w.curve, initial[x.w.signal]);
        near(f.client.layers.get(x.ref).opts.rotate, angle, 'initial sample snaps ' + light + ' ' + x.w.id);
        assert.equal(f.client.layers.get(x.ref).anims.size, 0);
    }
    f.reset();
    const firstAt = f.sample(140, changed);
    assert.equal(f.timers.size, 0, 'native interpolation schedules no JS follow-up frame');
    let anims = f.messages().filter((m) => m.op === 'animate');
    assert.equal(anims.length, animatedCount);
    f.companions();
    const original = new Map(anims.map((m) => [m.ref, m]));
    f.reset();
    const reversedAt = f.sample(190, reversed);
    assert.equal(reversedAt - firstAt, 100, 'new native targets are capped at 10 Hz');
    anims = f.messages().filter((m) => m.op === 'animate');
    assert.equal(anims.length, animatedCount);
    for (const m of anims) {
        const previous = original.get(m.ref), keys = previous.keys.split(' ').map((k) => k.split(':').map(Number));
        assert(reversedAt - firstAt < keys[1][0], 'the retarget occurs before the preceding segment ends');
        const expected = keys[0][1] + (keys[1][1] - keys[0][1]) * (reversedAt - firstAt) / keys[1][0];
        near(Number(m.keys.split(' ')[0].split(':')[1]), expected, 'mid-motion reversal is continuous');
        assert.equal(m.anim, previous.anim, 'retargeting reuses the layer-local animation ID');
    }
    f.companions();
    f.reset(); f.sample(f.now() + 100, reversed);
    assert.equal(f.frames.length, 0, 'settled repeated targets send no commands');
    assert.equal(f.timers.size, 0);
    for (let i = 0; i < 40; i++) {
        f.sample(f.now() + 100, i % 2 ? changed : reversed);
        for (const layer of f.client.layers.values()) assert(layer.anims.size <= 1, 'animation cache stays bounded');
    }
    f.companions();
    f.reset(); f.sample(f.now() + 100, { speed: null, rpm: null, fuel: null, oil: null });
    const invalid = f.messages();
    assert.equal(invalid.filter((m) => m.op === 'stop').length, animatedCount);
    for (const layer of f.client.layers.values()) {
        assert.equal(layer.opts.visible, false, 'invalid input hides the needle and companions');
        assert.equal(layer.anims.size, 0, 'invalid input cancels native movement');
    }
    f.reset(); f.sample(f.now() + 100, initial);
    assert(!f.messages().some((m) => m.op === 'animate'), 'fresh recovery snaps without catch-up animation');
    for (const x of f.runtime.f82Needles) {
        if (!shown(x.w, light)) {
            assert.equal(f.client.layers.get(x.ref).opts.visible, false);
            continue;
        }
        const angle = x.w.signal === 'rpm' ? sprite.rpmAngle(x.w.curve, initial.rpm, false)
            : sprite.angle(x.w.curve, initial[x.w.signal]);
        assert.equal(f.client.layers.get(x.ref).opts.visible, true);
        near(f.client.layers.get(x.ref).opts.rotate, angle, 'recovery snaps to the fresh angle');
    }
    f.companions();
    f.reset(); f.sample(f.now() + 100, Object.assign({}, initial, { speed: 0.01 }));
    assert.equal(f.frames.length, 0, 'sub-0.1-degree target jitter does not restart native movement');
}

{
    const f = fixture('ramses-test', {}, 'day');
    f.sample(140, changed);
    f.runtime._statusSoon = () => {}; // status UI scheduling is unrelated to animation refusal
    f.runtime._wireClientEvents(f.client, 0);
    f.reset();
    f.client.emit('refused', 'animate', f.runtime.f82Needles[0].ref, 'animation unsupported');
    assert.equal(f.runtime._nativeF82Motion(), false, 'asynchronous refusal disables native motion for this connection');
    assert(f.warnings.some((message) => /native needle animation refused/.test(message)));
    for (const x of f.runtime.f82Needles) {
        const expected = x.w.signal === 'rpm' ? sprite.rpmAngle(x.w.curve, changed.rpm, false)
            : sprite.angle(x.w.curve, changed[x.w.signal]);
        const layer = f.client.layers.get(x.ref);
        assert.equal(layer.anims.size, 0, 'refusal cancels every native track');
        near(layer.opts.rotate, expected, 'refused movement snaps to the latest target, never its old FROM angle');
    }
    f.reset(); f.sample(240, reversed); f.advance(450);
    assert(f.messages().every((m) => m.op === 'set'), 'subsequent direct motion does not retry refused animations');
    for (const x of f.runtime.f82Needles) {
        const expected = x.w.signal === 'rpm' ? sprite.rpmAngle(x.w.curve, reversed.rpm, false)
            : sprite.angle(x.w.curve, reversed[x.w.signal]);
        near(f.client.layers.get(x.ref).opts.rotate, expected, 'direct fallback follows subsequent fresh data');
    }
    f.companions();
}

for (const blockBeforeCallback of [false, true]) {
    const f = fixture('ramses-test', {}, 'day');
    f.reset();
    if (blockBeforeCallback) f.feed(100, changed);
    f.client.blocked = true;
    if (blockBeforeCallback) f.advance(100);
    for (let i = 0; i < 20; i++) f.feed(200 + i * 50, i % 2 ? reversed : changed);
    assert.equal(f.frames.length, 0, 'a blocked native socket receives no pose/animation messages');
    assert.equal(f.timers.size, 0, 'blocked targets schedule no interpolation work');
    assert.equal(f.client.pendingSets.size, 0, 'blocked updates leave no stale intermediate pose queue');
    f.client.blocked = false;
    f.runtime._queueF82(); f.advance(f.now());
    const anims = f.messages().filter((m) => m.op === 'animate');
    assert.equal(anims.length, widgets.length, 'unblocking draws the latest available target');
    for (const m of anims) {
        const x = f.runtime.f82Needles.find((x) => x.ref === m.ref);
        const value = x.w.signal === 'rpm' ? sprite.rpmAngle(x.w.curve, reversed.rpm, false)
            : sprite.angle(x.w.curve, reversed[x.w.signal]);
        const start = x.w.signal === 'rpm' ? sprite.rpmAngle(x.w.curve, initial.rpm, false)
            : sprite.angle(x.w.curve, initial[x.w.signal]);
        const keys = m.keys.split(' ').map((k) => k.split(':').map(Number));
        near(keys[0][1], start, 'unblocking starts from the last actually drawn target');
        near(keys[1][1], Math.round(value * 10) / 10, 'unblocking uses the newest raw target, not an intermediate sample');
        assert(keys[1][0] >= motion.NATIVE_MIN_MS && keys[1][0] <= motion.NATIVE_MAX_MS,
            'unblocked native segment remains bounded');
    }
    assert.equal(f.timers.size, 0, 'unblocked interpolation stays native');
    f.companions();
}

for (const [backend, env] of [['bench', {}], ['ramses-test', { M4_PREVIEW_ONLY: '1' }]]) {
    const f = fixture(backend, env, 'day');
    assert.equal(f.runtime._nativeF82Motion(), false, 'bench/preview remains on its own interpolation path');
    f.reset(); f.sample(100, changed);
    assert(f.timers.size > 0, 'preview still schedules JS interpolation');
    f.advance(350); f.companions();
    assert(f.messages().every((m) => m.op === 'set'), 'preview never emits native animation messages');
    assert.equal(f.timers.size, 0, 'settled preview motion becomes idle');
}
console.log('F8X native runtime: actual layout/client, coherent companion animations, continuous reversals, bounded IDs, no interpolation timers/pixel uploads, invalid recovery, asynchronous-refusal fallback, backpressure recovery and preview isolation passed.');
