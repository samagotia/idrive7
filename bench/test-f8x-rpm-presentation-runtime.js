'use strict';
// Real F8X runtime and protocol client. Only input providers, clock and socket
// are simulated; this does not establish physical display FPS or car latency.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sprite = require('../shared/f82_sprite');
const motion = require('../shared/f8x_motion');
const presentation = require('../shared/f8x_rpm_presentation');
const { ClusterRender } = require('../shared/cluster_render_client');
const wire = require('./renderer-wire');
const layout = require('../apps/samagotia_clusters/cluster/layouts/our_m4.json');
const front = layout.widgets.find((w) => w.signal === 'rpm');
const track = layout.widgets.find((w) => w.shiftTrack);
const angle = (rpm) => Math.round(sprite.rpmAngle(front.curve, rpm, true) * 100) / 100;

function fixture(mode = 'smooth', start = 1000) {
    let now = 0, nextTimer = 0, fresh = true, pedal = 75, limit = 7200;
    let values = Object.freeze({ rpm: start, speed: 54, stage: 'D', gear: 2,
        gearGuessed: false, program: 'M', oil: 100, condition: 10, demo: false });
    const timers = new Map(), writes = [];
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/f8x_runtime.js'), 'utf8'), {
        module, Buffer, Date: { now: () => now }, process: { env: {}, uptime: () => now / 1000 },
        setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimeout(id) { timers.delete(id); },
        require(name) {
            if (name === './f82_sprite') return sprite;
            if (name === './f8x_motion') return motion;
            if (name === './f8x_rpm_presentation') return presentation;
            return {};
        },
    });
    const client = new ClusterRender('rpm-presentation-runtime', '/tmp/no-car');
    client.ready = client.connected = true; client.backend = 'ramses-test';
    client.sock = { write(bytes) { writes.push(Buffer.from(bytes)); return true; } };
    const settings = { f8xRpmNeedleMode: mode, shiftBefore: 300, f82ShowGearInD: true };
    const runtime = Object.assign(Object.create(module.exports.prototype), {
        ctx: {}, client, clients: [client], stopped: false, f82Light: 'day',
        f82Needles: [], widgets: new Map(), f82Motion: new Map(), f82NextFrameAt: null,
        f82Timer: null, f82RpmMoving: false, rpmPresentation: new presentation.RpmPresentation(),
        car: { data: () => values, missingCriticalSignal: () => fresh ? null : 'rpm' },
        setting: (name) => settings[name], _f82PedalPercent: () => pedal,
        _f82ShiftLimit: () => limit, _testRpm: () => null, _guard: (_, fn) => fn(),
        _effectiveFormat: () => 'metric', program: 'M',
    });
    for (const w of [front, sprite.shadowOf(front)]) {
        const asset = require('../apps/samagotia_clusters/cluster/f82/' + w.asset + '.json');
        const ref = client.image({ target: 'panel', x: w.x, y: w.y, w: w.w, h: w.h,
            iw: asset.w, ih: asset.h, px: w.pivot[0] * w.w / asset.w, py: w.pivot[1] * w.h / asset.h });
        const x = { w, ref, c: client, last: null };
        runtime.f82Needles.push(x); runtime.widgets.set(w.id, x);
    }
    writes.length = 0;
    function source(rpm, at, changes) {
        now = at; values = Object.freeze(Object.assign({}, values, changes, { rpm }));
        // This is the same pre-frame observation the real onSample hook uses.
        runtime._rpmNeedleValue(rpm, now, front.curve);
    }
    function draw(at) {
        now = at;
        const before = Object.assign({}, values);
        client.batchPoses(() => runtime.f82Needles.forEach((x) => runtime._updateF82(x, now, false, now)));
        assert.deepEqual(values, before, 'visual presentation must not rewrite the car sample');
        return client.layers.get(runtime.f82Needles[0].ref).opts;
    }
    function advance(at) {
        let count = 0;
        while (timers.size) {
            const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
            if (timer.at > at) break;
            assert(++count < 1000); now = timer.at; timers.delete(id); timer.fn();
        }
        now = at;
    }
    return { runtime, client, settings, timers, writes, source, draw, advance,
        values: () => values, setFresh: (value) => { fresh = value; }, setPedal: (value) => { pedal = value; },
        setLimit: (value) => { limit = value; }, setNow: (value) => { now = value; } };
}
function prime(f, base = 1000) {
    for (const [at, rpm] of [[0, base], [50, base + 100], [100, base + 200]]) {
        f.source(rpm, at);
        assert.equal(f.draw(at).rotate, angle(rpm), 'each observed actual value wins immediately');
    }
}

for (const mode of [undefined, 'measured']) {
    const f = fixture(); f.settings.f8xRpmNeedleMode = mode; prime(f);
    assert.equal(f.draw(117).rotate, angle(1200)); assert(!f.runtime.f82RpmMoving);
}
{
    const f = fixture(); prime(f);
    const pose = f.draw(117), shown = f.runtime._rpmNeedleValue(1200, 117, front.curve);
    assert(shown > 1200 && shown <= 1300);
    assert(pose.rotate > angle(1200) && pose.rotate - angle(1200) <= 1 + 1e-8);
    const shadow = f.client.layers.get(f.runtime.f82Needles[1].ref).opts;
    assert.equal(shadow.rotate, pose.rotate, 'blade and shadow use the identical presentation');
    const commands = wire.frames(f.writes).map((b) => {
        assert.equal(b[4], 0x4a, 'optional smoothing never uploads a moving bitmap');
        return JSON.parse(b.slice(5));
    });
    assert(commands.every((m) => m.op === 'set'));
    assert.equal(f.runtime._token('f82Speed'), '54', 'digital speed uses actual vehicle data');
    assert.equal(f.runtime._token('stage'), '2', 'gear readout uses actual vehicle data');
    assert.equal(f.values().rpm, 1200); assert.equal(f.runtime._f82ShiftLimit(), 7200);
    f.source(1250, 150); assert.equal(f.draw(150).rotate, angle(1250), 'a newer actual reading is never eased from the old estimate');
    f.source(1100, 200); assert.equal(f.draw(200).rotate, angle(1100), 'a measured reversal wins immediately');
    assert.equal(f.draw(217).rotate, angle(1100));
}
// The one-degree bound must also hold across a printed-curve segment boundary.
{
    const f = fixture('smooth', 1790); prime(f, 1790);
    assert(f.draw(125).rotate - angle(1990) <= 1 + 1e-8, 'lead is at most one actual dial degree even when crossing 2000 RPM');
}
for (const change of [{ stage: 'P' }, { stage: 'N' }, { stage: 'R' }, { gear: 3 }]) {
    const f = fixture(); prime(f); assert(f.draw(117).rotate > angle(1200));
    f.source(1200, 125, change);
    assert.equal(f.draw(125).rotate, angle(1200)); assert(!f.runtime.f82RpmMoving);
}
{
    const f = fixture(); prime(f); assert(f.draw(117).rotate > angle(1200));
    f.setPedal(0); assert.equal(f.draw(125).rotate, angle(1200)); assert(!f.runtime.f82RpmMoving);
    f.setPedal(75); assert.equal(f.draw(130).rotate, angle(1200), 'pedal recovery cannot revive the old slope');
}
{
    const f = fixture(); prime(f); f.setFresh(false);
    assert.equal(f.draw(125).visible, false, 'provider/staleness failure hides the estimate');
    assert.equal(f.runtime.rpmPresentation.measured, null);
    f.setFresh(true); f.source(1300, 150);
    assert.equal(f.draw(150).rotate, angle(1300));
    f.source(null, 200); assert.equal(f.draw(200).visible, false);
    f.source(1400, 250); assert.equal(f.draw(250).rotate, angle(1400));
}
for (const blockedBeforeQueue of [true, false]) {
    const f = fixture(); prime(f); f.draw(117);
    if (blockedBeforeQueue) f.client.blocked = true;
    f.setNow(118); f.runtime._queueF82();
    if (!blockedBeforeQueue) f.client.blocked = true;
    f.advance(150);
    assert.equal(f.runtime.rpmPresentation.measured, null, 'both pre-queue and queued backpressure discard presentation history');
    assert.equal(f.runtime.f82RpmMoving, false);
    f.client.blocked = false; f.source(1300, 160);
    assert.equal(f.draw(160).rotate, angle(1300), 'drain recovers from actual RPM, not a queued estimate');
}
{
    const f = fixture('smooth', 6990); prime(f, 6990);
    assert(f.runtime._rpmNeedleValue(7190, 125, front.curve) <= 7200, 'visual lead cannot cross the configured/live shift limit');
}
{
    const f = fixture('smooth', 6690); f.setPedal(100); prime(f, 6690);
    assert(f.runtime._rpmNeedleValue(6890, 125, front.curve) > 6900, 'fixture estimate crosses the shift point');
    assert.equal(f.values().rpm, 6890);
    const state = f.runtime._shiftFrame({ shiftTrack: track.shiftTrack, curve: front.curve }, 125);
    assert.equal(state.flashAt, null, 'current shift-light path uses actual RPM below the shift point');
    const ref = f.client.effect({ target: 'panel', w: track.w, h: track.h, fs: 'void main(){}' });
    const x = { ref, c: f.client, w: { shiftTrack: track.shiftTrack, curve: front.curve }, last: null };
    f.runtime._updateF82Shift(x, 125, true);
    assert.equal(x.shiftFlashAt, null, 'legacy shader path also uses actual RPM');
    f.source(6901, 150);
    assert.equal(f.runtime._shiftFrame({ shiftTrack: track.shiftTrack, curve: front.curve }, 150).flashAt, 150,
        'actual RPM crossing the shift point enables the indication');
}
console.log('Runtime RPM presentation: measured default, real immediate values, bounded optional lead, paired native poses, untouched data/readouts/shift logic, and shift/lift/provider/backpressure recovery passed.');
