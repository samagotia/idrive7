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

// Native GPU drawing uses direct poses. Replacing a Ramses19 animation on
// every reading rebuilds its shared animation system; this path never does it.
const expected = (x, values) => x.w.signal === 'rpm'
    ? sprite.rpmAngle(x.w.curve, values.rpm, false) : sprite.angle(x.w.curve, values[x.w.signal]);
for (const [backend, environment] of [['ramses-test', {}], ['bench', {}],
    ['ramses-test', { M4_PREVIEW_ONLY: '1' }]]) for (const light of ['day', 'night']) {
    const f = fixture(backend, environment, light);
    f.reset(); f.sample(100, changed);
    assert(f.timers.size > 0, 'moving resident needles schedule short pose interpolation');
    f.advance(117); f.companions();
    const rpm = f.runtime.f82Needles.find((x) => x.w.id === 'rpm_needle');
    const before = f.client.layers.get(rpm.ref).opts.rotate;
    assert(before > expected(rpm, initial) && before < expected(rpm, changed), 'first frame moves toward the measured target');
    f.feed(120, reversed); f.advance(134); f.companions();
    const turning = f.client.layers.get(rpm.ref).opts.rotate;
    assert(turning >= before && turning <= expected(rpm, changed), 'retarget starts at the current angle without jumping');
    f.advance(151); f.companions();
    const after = f.client.layers.get(rpm.ref).opts.rotate;
    assert(after < turning && after >= expected(rpm, reversed), 'reversal follows the newest reading without overshoot');
    f.advance(400); f.companions();
    for (const x of f.runtime.f82Needles) {
        const layer = f.client.layers.get(x.ref);
        assert.equal(layer.anims.size, 0, 'no native animation replacement or accumulating animation IDs');
        if (shown(x.w, light)) near(layer.opts.rotate, expected(x, reversed), 'all dials settle to real targets');
    }
    assert(f.messages().every((m) => m.op === 'set'), 'motion sends only pose commands, never pixels or animations');
    assert.equal(f.timers.size, 0, 'settled interpolation stops scheduling frames');
    f.reset(); f.sample(500, reversed); f.advance(600);
    assert.equal(f.frames.length, 0, 'stationary readings send no commands');
    f.sample(700, { speed: null, rpm: null, fuel: null, oil: null });
    assert.equal(f.timers.size, 0, 'invalid data immediately stops motion');
    for (const layer of f.client.layers.values()) assert.equal(layer.opts.visible, false);
    f.sample(800, initial); f.companions();
    for (const x of f.runtime.f82Needles) if (shown(x.w, light)) {
        near(f.client.layers.get(x.ref).opts.rotate, expected(x, initial), 'fresh recovery snaps without stale catch-up');
    }
}

for (const blockBeforeCallback of [false, true]) {
    const f = fixture('ramses-test', {}, 'day');
    f.runtime._wireClientEvents(f.client, 0);
    f.reset();
    if (blockBeforeCallback) f.feed(100, changed);
    f.client.blocked = true;
    if (blockBeforeCallback) f.advance(100);
    for (let i = 0; i < 20; i++) f.feed(200 + i * 50, i % 2 ? reversed : changed);
    assert.equal(f.frames.length, 0, 'blocked socket receives no needle work');
    assert.equal(f.timers.size, 0, 'blocked motion schedules no interpolation work');
    assert.equal(f.client.pendingSets.size, 0, 'no stale intermediate poses queue while blocked');
    f.client.blocked = false; f.client.emit('drained'); f.advance(f.now());
    for (const x of f.runtime.f82Needles) {
        near(f.client.layers.get(x.ref).opts.rotate, expected(x, reversed), 'drain draws the newest value without catch-up');
    }
    assert.equal(f.timers.size, 0, 'recovery to the latest value creates no old animation work');
    f.companions();
}

// Exercise the real socket callback, including a pump that fills the socket again.
{
    const net = require('net'), { EventEmitter } = require('events');
    const originalConnect = net.connect;
    const socket = new EventEmitter();
    let accept = false, drains = 0;
    socket.write = () => accept; socket.destroy = () => {};
    const client = new ClusterRender('drain-test', '/tmp/no-car');
    const ref = client.image({ target: 'panel', w: 8, h: 8 });
    client.closed = false;
    try { net.connect = () => socket; client._open(); } finally { net.connect = originalConnect; }
    client.ready = client.connected = true; client.blocked = true;
    client.on('drained', () => drains++);
    client.set(ref, { rotate: 10 }); socket.emit('drain');
    assert.equal(drains, 0, 'a pump that blocks again must not announce capacity');
    assert.equal(client.blocked, true);
    accept = true; socket.emit('drain');
    assert.equal(drains, 1, 'actual socket capacity event reaches the runtime immediately');
    client.sock = {}; socket.emit('drain');
    assert.equal(drains, 1, 'late drain from an obsolete socket is ignored');
}
console.log('F8X GPU motion: resident poses, coherent companions, short continuous reversals, idle silence, invalid recovery, zero animation rebuilds/pixel uploads and real drain/backpressure recovery passed.');
