'use strict';
// Independent source-level comparison. This models commands and ideal rendering,
// not the car's transport, scene flush cadence, GPU time or physical display FPS.
// Run from a checkout retaining the published baseline commit:
//   node bench/profile-f8x-motion.js [report.json]
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const wire = require('./renderer-wire');
const root = path.resolve(__dirname, '..');
const BASELINE = process.env.F8X_PROFILE_BASELINE || '5ab163dd3962fd767236a50e49d1345f43f39d00';
const baseline = (file) => execFileSync('git', ['show', BASELINE + ':' + file], { cwd: root, encoding: 'utf8' });
const current = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sourceModule = (source) => {
    const module = { exports: {} };
    vm.runInNewContext(source, { module, process, require, Buffer });
    return module.exports;
};
const sprite = require('../shared/f82_sprite');
const { ClusterRender } = require('../shared/cluster_render_client');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const fronts = layout.widgets.filter((w) => w.signal && w.shadow);
const widgets = fronts.concat(fronts.map(sprite.shadowOf), fronts.filter((w) => w.glass).map(sprite.glassOf));
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

function fixture(readSource, light = 'day') {
    let now = 0, timerId = 0, socketWrites = 0;
    const values = { speed: 0, rpm: 1000, fuel: 0.5, oil: 90 };
    const timers = new Map(), messages = [], rendered = new Map();
    const motion = sourceModule(readSource('shared/f8x_motion.js'));
    const module = { exports: {} };
    vm.runInNewContext(readSource('shared/f8x_runtime.js'), {
        module, Buffer, process: { env: {}, uptime: () => now / 1000 }, Date: { now: () => now },
        setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + Math.max(0, ms || 0) }); return id; },
        clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); },
        require(name) { return name === './f82_sprite' ? sprite : name === './f8x_motion' ? motion : {}; },
    });
    const client = new ClusterRender('motion-profile', '/tmp/no-car');
    client.backend = 'ramses-test';
    client.ready = client.connected = true;
    const angleAt = (ref) => {
        const r = rendered.get(ref);
        if (!r || r.visible === false) return null;
        if (!r.animation) return r.rotate;
        const keys = r.animation.keys, t = now - r.animation.at;
        let index = 0;
        while (index + 1 < keys.length && t >= keys[index + 1][0]) index++;
        if (index + 1 === keys.length) return keys[index][1];
        const a = keys[index], b = keys[index + 1];
        return a[1] + (b[1] - a[1]) * Math.max(0, (t - a[0]) / (b[0] - a[0]));
    };
    client.sock = { write(bytes) {
        socketWrites++;
        wire.frames([bytes]).forEach((bytes) => {
        assert.equal(bytes[4], 0x4a, 'motion never uploads a bitmap or mesh');
        const m = JSON.parse(bytes.subarray(5));
        messages.push({ at: now, bytes: bytes.length, ...m });
        if (m.op === 'layer') rendered.set(m.ref, { rotate: m.rotate || 0, visible: m.visible !== 0 });
        const r = rendered.get(m.ref);
        if (r && m.op === 'set') {
            if (m.rotate !== undefined) r.rotate = m.rotate;
            if (m.visible !== undefined) r.visible = !!m.visible;
        }
        if (r && m.op === 'animate') r.animation = {
            at: now, id: m.anim, keys: m.keys.split(' ').map((key) => key.split(':').map(Number)),
        };
        if (r && m.op === 'stop' && r.animation && (!m.anim || r.animation.id === m.anim)) {
            r.rotate = angleAt(m.ref); r.animation = null;
        }
        });
        return true;
    } };
    const runtime = Object.assign(Object.create(module.exports.prototype), {
        f82Light: light, f82Needles: [], f82Motion: new Map(), f82NextFrameAt: null,
        f82Timer: null, f82SentAt: 0, client, stopped: false,
        log: { info() {}, warn() {} }, _guard: (label, fn) => fn(), _testRpm: () => null,
        _raw: (signal) => values[signal], car: { data: () => Object.assign({ condition: 2 }, values) },
    });
    for (const w of widgets) {
        const asset = require('../apps/samagotia_clusters/cluster/f82/' + w.asset + '.json');
        const ref = client.image({ target: 'panel', x: w.x, y: w.y, w: w.w, h: w.h,
            iw: asset.w, ih: asset.h, px: w.pivot[0], py: w.pivot[1] });
        const x = { w, ref, c: client, last: null };
        runtime.f82Needles.push(x); runtime._updateF82(x, now, true, now);
    }
    runtime.widgets = new Map(runtime.f82Needles.map((x) => [x.w.id, x]));
    messages.length = 0;
    socketWrites = 0;
    const advance = (at) => {
        let iterations = 0;
        while (timers.size) {
            const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (timer.at > at + 1e-7) break;
            assert(++iterations < 2000, 'frame timer remains bounded');
            now = timer.at; timers.delete(id); timer.fn();
        }
        now = at;
    };
    const rpmFront = runtime.f82Needles.find((x) => x.w.signal === 'rpm' && !x.w.needleId);
    const rpmAt = (angle) => {
        if (angle === null) return null;
        const c = rpmFront.w.curve;
        for (let i = 1; i < c.length; i++) if (angle <= c[i][1]) {
            return c[i - 1][0] + (angle - c[i - 1][1]) * (c[i][0] - c[i - 1][0]) / (c[i][1] - c[i - 1][1]);
        }
        return c[c.length - 1][0];
    };
    const feed = (next) => { Object.assign(values, next); runtime._queueF82(); };
    const stallTo = (at) => {
        now = at;
        const overdue = [...timers].filter((entry) => entry[1].at <= at).sort((a, b) => a[1].at - b[1].at);
        for (const [id, timer] of overdue) if (timers.delete(id)) timer.fn();
    };
    return { advance, stallTo, feed, values, runtime, client, messages, timers, angleAt,
        rpm: () => rpmAt(angleAt(rpmFront.ref)), now: () => now,
        tick: () => runtime._queueF82(), socketWrites: () => socketWrites };
}

const percentile = (values, q) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)];
const rounded = (v) => +v.toFixed(2);
function ramp(readSource, readPeriod, sourcePeriod = readPeriod) {
    const f = fixture(readSource), error = [];
    for (let at = 0; at <= 3000; at++) {
        f.advance(at);
        if (at % readPeriod === 0) f.feed({ rpm: 1000 + 2 * Math.floor(at / sourcePeriod) * sourcePeriod });
        if (at % 50 === 0) f.tick();
        f.advance(at);
        assert(f.rpm() <= f.values.rpm + 1, 'a rising dial never invents future RPM');
        if (at >= 500 && at <= 2500) error.push((1000 + 2 * at - f.rpm()) / 2);
    }
    const messages = f.messages;
    const poseTimes = [...new Set(messages.filter((m) => m.op === 'set' && m.rotate !== undefined).map((m) => m.at))];
    const intervals = poseTimes.slice(1).map((at, i) => at - poseTimes[i]);
    return {
        readPeriodMs: readPeriod, sourcePeriodMs: sourcePeriod,
        meanTrackingLagMs: rounded(error.reduce((a, b) => a + b, 0) / error.length),
        p95TrackingLagMs: rounded(percentile(error, 0.95)), maxTrackingLagMs: rounded(Math.max(...error)),
        commandsPerSecond: rounded(messages.length / 3), KiBPerSecond: rounded(messages.reduce((n, m) => n + m.bytes, 0) / 1024 / 3),
        socketWritesPerSecond: rounded(f.socketWrites() / 3),
        animateCommands: messages.filter((m) => m.op === 'animate').length,
        stopCommands: messages.filter((m) => m.op === 'stop').length,
        poseCommandCadence: { batchesPerSecond: rounded(poseTimes.length / 3),
            minIntervalMs: rounded(Math.min(...intervals)), medianIntervalMs: rounded(percentile(intervals, 0.5)),
            p95IntervalMs: rounded(percentile(intervals, 0.95)) },
    };
}

function functional(readSource) {
    const f = fixture(readSource);
    for (let at = 0; at <= 1600; at++) {
        f.advance(at);
        if (at < 800 && at % 50 === 0) f.feed({ rpm: 1000 + at * 4 });
        if (at === 800) f.feed({ rpm: 1500 });
        if (at % 50 === 0) f.tick();
        f.advance(at);
        const rpm = f.rpm();
        if (at >= 800) assert(rpm >= 1499 && rpm <= 4001, 'reversal remains bounded by received data');
        if (at > 1000) assert(Math.abs(rpm - 1500) < 1, 'withheld source settles to its last actual sample');
    }
    const quietCount = f.messages.length;
    f.advance(2000); f.tick(); f.advance(2050);
    assert.equal(f.messages.length, quietCount, 'a stationary dial sends no pose refreshes');
    f.feed({ rpm: null }); f.advance(2100);
    assert.equal(f.rpm(), null, 'invalid RPM hides the blade');
    f.feed({ rpm: 2300 }); f.advance(2300);
    assert(Math.abs(f.rpm() - 2300) < 4, 'fresh recovery snaps within the baseline 0.1-degree quantization');
    return { reversalBounded: true, withheldSampleHoldsLastValue: true, settledSilence: true,
        invalidHidden: true, recoveryUsesFreshValue: true, noBitmapOrMeshWrites: true };
}

function backpressure(readSource) {
    const f = fixture(readSource);
    f.feed({ rpm: 2000 }); f.advance(40);
    f.client.blocked = true;
    const before = f.messages.length;
    for (let at = 50; at <= 400; at += 50) { f.advance(at); f.feed({ rpm: 2000 + at }); f.tick(); }
    f.advance(450);
    const during = f.messages.length - before;
    f.client.blocked = false;
    f.client.emit('drained'); f.tick(); f.advance(650);
    assert(Math.abs(f.rpm() - f.values.rpm) < 4, 'unblocked dial recovers to the newest reading');
    return { blockedDurationMs: 410, socketMessagesWhileBlocked: during, recoveredLatestValue: true };
}

function eventLoopStall(readSource) {
    const f = fixture(readSource);
    f.advance(50); f.feed({ rpm: 2000 }); f.advance(60);
    const count = f.messages.length;
    f.values.rpm = 3000;
    f.stallTo(550);
    // A resumed provider/sample callback (or the housekeeping tick) queues
    // the fresh value. Settled direct poses intentionally have no idle timer.
    f.tick(); f.advance(550);
    const resumed = f.messages.slice(count);
    assert(resumed.length <= 2, 'a stalled RPM pair resumes one frame, not a backlog of missed frames');
    assert(resumed.every((m) => m.at === 550), 'expired frame work uses the resumed clock');
    assert(f.timers.size <= 1, 'event-loop stall cannot build a timer backlog');
    for (let at = 551; at <= 700; at++) {
        f.advance(at);
        assert(f.rpm() >= 999 && f.rpm() <= 3001, 'resumption never predicts beyond the last received RPM');
    }
    assert(Math.abs(f.rpm() - 3000) < 1, 'the latest target settles after an event-loop stall');
    return { durationMs: 490, commandsOnResume: resumed.length, missedFrameBacklog: false,
        timerCountBound: 1, recoveredLatestValue: true };
}

const old20 = ramp(baseline, 50), old500 = ramp(baseline, 500), updated = ramp(current, 50);
const hypothetical40 = ramp(current, 25), cached40 = ramp(current, 25, 50);
const report = {
    scope: 'Deterministic actual-runtime command simulation with ideal renderer; not a car FPS/latency measurement.',
    baselineCommit: BASELINE,
    currentSources: Object.fromEntries(['shared/f8x_runtime.js', 'shared/f8x_motion.js', 'shared/f8x_vehicle.js',
        'shared/f82_sprite.js', 'shared/cluster_render_client.js']
        .map((file) => [file, hash(current(file))])),
    assumptions: ['Ramp rises at 2000 RPM/s; observations use milliseconds 500–2500.',
        'All commands/animations are rendered ideally at arrival; real transport and flush delays are excluded.',
        'Source cadence is supplied, not measured. 500ms models getter-only baseline; notifications could already be faster.',
        'The 25ms source case assumes a genuinely new source value each read. The cached case repeats values between 50ms source updates.',
        'A 50ms runtime housekeeping tick remains active; only the Day RPM needle and shadow change in this trace.',
        'Pose command batches per second are software output cadence, not physical display FPS.'],
    baseline20HzSource: old20, baselineGetterOnly2HzSource: old500, candidate20HzSource: updated,
    hypotheticalCandidate40HzSource: hypothetical40, candidate40HzReadsWith20HzCachedSource: cached40,
    candidate100HzSource: ramp(current, 10), candidate100HzReadsWith20HzCachedSource: ramp(current, 10, 50),
    meanLagReductionWithSameSourcePercent: rounded(100 * (1 - updated.meanTrackingLagMs / old20.meanTrackingLagMs)),
    baselineFunctional: functional(baseline), candidateFunctional: functional(current),
    candidateBackpressure: backpressure(current),
    candidateEventLoopStall: eventLoopStall(current),
};
assert(updated.meanTrackingLagMs < old20.meanTrackingLagMs * 0.6, 'same-source modeled lag falls substantially');
assert.equal(updated.animateCommands, 0, 'moving needles never restart native animations');
assert.equal(updated.stopCommands, 0, 'moving needles never recreate native animation systems');
assert(updated.commandsPerSecond < 140, 'RPM front plus shadow stay within the 60Hz pose budget');
assert(hypothetical40.commandsPerSecond < 140, '40Hz fresh readings still respect the 60Hz pose budget');
assert(hypothetical40.meanTrackingLagMs < updated.meanTrackingLagMs,
    'genuinely fresher source samples can reduce tracking delay further');
assert.equal(report.candidateBackpressure.socketMessagesWhileBlocked, 0, 'a blocked socket pauses pose production');
if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
