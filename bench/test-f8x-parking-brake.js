'use strict';
// Focused host checks. They validate decoder/rendering behaviour, not field availability on a car.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

function loadBrake(time) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_brake.js'), 'utf8'), {
        module, process: { uptime: () => time.ms / 1000 },
    }, { filename: 'f8x_brake.js' });
    return module.exports;
}
function fixture(Brake, deferred) {
    const f = { shutdowns: 0, sub: { available: true } };
    f.sub.shutdown = () => { f.shutdowns++; };
    f.sub.onAvailability = (listener) => { f.availabilityListener = listener; };
    f.available = (value) => { f.sub.available = value; if (f.availabilityListener) f.availabilityListener(value); };
    const ctx = { log: { info() {} }, signals: { watch(iface, instance, handlers, log, options) {
        assert.equal(iface, 'de.bmw.infotainment.vehicle.CDS');
        assert.equal(instance, '1');
        assert.equal(options.pollMs, 1000);
        assert.equal(options.pollFields.join(','), 'statusHandBrake');
        f.receive = handlers.statusHandBrake;
        return deferred ? new Promise((resolve) => { f.resolve = resolve; }) : Promise.resolve(f.sub);
    } } };
    f.brake = new Brake(ctx);
    return f;
}
const microtasks = async () => { await Promise.resolve(); await Promise.resolve(); };

async function main() {
    const time = { ms: 10000 };
    const { ParkingBrake, decode, MAX_AGE_MS } = loadBrake(time);
    [2, 'HANDBREMSE_ANGEZOGEN'].forEach((value) => assert.equal(decode({ statusContactHandBrake: value }), 'applied'));
    [1, 'HANDBREMSE_GELOEST'].forEach((value) => assert.equal(decode({ statusContactHandBrake: value }), 'released'));
    [undefined, null, 0, 3, 255, true, '2', '1', 'INVALID'].forEach((value) => assert.equal(decode({ statusContactHandBrake: value }), 'unknown'));
    assert.equal(decode(null), 'unknown');
    assert.equal(decode({}), 'unknown');

    const f = fixture(ParkingBrake);
    assert.equal(f.brake.value(), 'unknown');
    await microtasks();
    assert.equal(f.brake.value(), 'unknown');
    f.receive({ statusContactHandBrake: 2 });
    assert.equal(f.brake.value(), 'applied');
    time.ms += MAX_AGE_MS;
    assert.equal(f.brake.value(), 'applied');
    time.ms++;
    assert.equal(f.brake.value(), 'unknown', 'stale samples must hide the warning');
    f.receive({ statusContactHandBrake: 1 });
    assert.equal(f.brake.value(), 'released');
    f.receive({ statusContactHandBrake: 255 });
    assert.equal(f.brake.value(), 'unknown');
    f.receive({ statusContactHandBrake: 2 });
    f.available(false);
    assert.equal(f.brake.value(), 'unknown', 'provider loss must hide the warning');
    f.available(true);
    const recoveredWithoutSample = f.brake.value();
    f.receive({ statusContactHandBrake: 2 });
    f.available(false); f.available(true);
    assert.equal(f.brake.value(), 'unknown', 'a brief loss between render ticks must also invalidate the sample');
    f.receive({ statusContactHandBrake: 1 });
    assert.equal(f.brake.value(), 'released', 'fresh provider recovery must work');
    f.brake.stop();
    assert.equal(f.shutdowns, 1);
    f.receive({ statusContactHandBrake: 2 });
    assert.equal(f.brake.value(), 'unknown', 'late sample after stop must be ignored');

    const late = fixture(ParkingBrake, true);
    late.brake.stop();
    late.resolve(late.sub);
    await microtasks();
    assert.equal(late.shutdowns, 1, 'subscription resolving after stop must shut down');
    late.receive({ statusContactHandBrake: 2 });
    assert.equal(late.brake.value(), 'unknown');

    // Exercise the actual runtime warning branch without vehicle or renderer transport.
    const runtimeModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
        module: runtimeModule, require: () => ({}), Buffer,
    }, { filename: 'f8x_runtime.js' });
    const update = runtimeModule.exports.prototype._update;
    let state = 'unknown';
    const poses = [];
    const runtime = { parkingBrake: { value: () => state } };
    const widget = { w: { warning: 'parkingBrake' }, ref: 1, last: null,
        c: { set(ref, pose) { assert.equal(ref, 1); poses.push(JSON.parse(JSON.stringify(pose))); } } };
    update.call(runtime, widget, 0, true);
    state = 'applied'; update.call(runtime, widget, 1, false);
    update.call(runtime, widget, 2, false);
    state = 'released'; update.call(runtime, widget, 3, false);
    state = 'unknown'; update.call(runtime, widget, 4, false);
    assert.deepEqual(poses, [{ visible: false, opacity: 1 }, { visible: true, opacity: 1 },
        { visible: false, opacity: 1 }, { visible: false, opacity: 1 }]);
    const pixels = require('../shared/f8x_icons').paintIcon('parkingBrake', 42, 42, [255, 36, 30, 255]);
    assert.equal(pixels.length, 42 * 42 * 4);
    assert(pixels.some((value, index) => index % 4 === 3 && value > 0), 'parking brake artwork is nonempty');
    assert.equal(recoveredWithoutSample, 'unknown', 'recovery requires a fresh sample, not the cached applied state');
    console.log('F8X parking brake: decoder, freshness, provider lifecycle and applied-only rendering passed.');
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
