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
function fixture(Brake, deferred, failElectronic) {
    const f = { shutdowns: 0, watches: {} };
    const ctx = { log: { info() {} }, signals: { watch(iface, instance, handlers, log, options) {
        const electronic = iface === 'de.bmw.infotainment.vehicle.Vehicle2';
        assert(electronic || iface === 'de.bmw.infotainment.vehicle.CDS');
        assert.equal(instance, '1');
        assert.equal(options.pollMs, 1000);
        const field = electronic ? 'statusStandstillFunctions' : 'statusHandBrake';
        assert.equal(options.pollFields.join(','), field);
        assert.equal(options.readTimeoutMs, 700);
        const state = { receive: handlers[field], sub: { available: true } };
        state.sub.shutdown = () => { f.shutdowns++; };
        state.sub.onAvailability = (listener) => { state.listener = listener; };
        state.available = (value) => { state.sub.available = value; if (state.listener) state.listener(value); };
        f.watches[electronic ? 'electronic' : 'handbrake'] = state;
        if (electronic && failElectronic) return Promise.reject(new Error('missing optional field'));
        return deferred ? new Promise((resolve) => { state.resolve = resolve; }) : Promise.resolve(state.sub);
    } } };
    f.brake = new Brake(ctx);
    return f;
}
const microtasks = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

async function main() {
    const time = { ms: 10000 };
    const { ParkingBrake, decode, decodeEpb, epbReason, MAX_AGE_MS } = loadBrake(time);
    [2, 'HANDBREMSE_ANGEZOGEN'].forEach((value) => assert.equal(decode({ statusContactHandBrake: value }), 'applied'));
    [1, 'HANDBREMSE_GELOEST'].forEach((value) => assert.equal(decode({ statusContactHandBrake: value }), 'released'));
    [undefined, null, 0, 3, 255, true, '2', '1', 'INVALID'].forEach((value) => assert.equal(decode({ statusContactHandBrake: value }), 'unknown'));
    assert.equal(decode(null), 'unknown'); assert.equal(decode({}), 'unknown');
    [1, 'PARKBREMSE_MECHANISCH_FESTGESTELLT'].forEach((value) => assert.equal(decodeEpb({ statusParkingBrake: value }), 'applied'));
    [0, 'PARKBREMSE_MECHANISCH_NICHT_FESTGESTELLT'].forEach((value) => assert.equal(decodeEpb({ statusParkingBrake: value }), 'released'));
    for (const value of [2, 4, 13, 14, 15, undefined, null, true, '1', 255, 'INVALID']) {
        assert.equal(decodeEpb({ statusParkingBrake: value }), 'unknown');
    }
    assert.equal(epbReason({ statusParkingBrake: 'PARKBREMSE_IM_STELLVORGANG_LOESEN' }), 'transition');
    assert.equal(epbReason({ statusParkingBrake: 'PARKBREMSE_IM_STELLVORGANG_FESTSTELLEN' }), 'transition');
    assert.equal(epbReason({ statusParkingBrake: 13 }), 'unsupported');
    assert.equal(epbReason({ statusParkingBrake: 14 }), 'fault');
    // These enums differ: reusing CDS's "2 means applied" for an EPB creates a false lamp.
    assert.equal(decode({ statusContactHandBrake: 2 }), 'applied');
    assert.equal(decodeEpb({ statusParkingBrake: 2 }), 'unknown');

    const f = fixture(ParkingBrake);
    assert.equal(f.brake.value(), 'unknown'); await microtasks();
    const hand = f.watches.handbrake, epb = f.watches.electronic;
    assert.equal(f.brake.value(), 'unknown');
    hand.receive({ statusContactHandBrake: 0 });
    epb.receive({ statusParkingBrake: 1 });
    assert.equal(f.brake.value(), 'applied', 'electronic brake works when the legacy handbrake contact is not coded');
    assert.equal(f.brake.status().source, 'de.bmw.infotainment.vehicle.Vehicle2.statusStandstillFunctions');
    assert.equal(f.brake.status().raw, 1);
    hand.receive({ statusContactHandBrake: 2 });
    epb.receive({ statusParkingBrake: 0 });
    assert.equal(f.brake.value(), 'released', 'fresh EPB release takes priority over a conflicting legacy contact');
    for (const value of [2, 4, 'PARKBREMSE_IM_STELLVORGANG_LOESEN', 'PARKBREMSE_IM_STELLVORGANG_FESTSTELLEN']) {
        epb.receive({ statusParkingBrake: value });
        assert.equal(f.brake.value(), 'unknown', 'EPB motion cannot revive an older applied contact');
        assert.equal(f.brake.status().reason, 'transition');
    }
    for (const value of [14, 'FUNKTION_MELDET_FEHLER']) {
        epb.receive({ statusParkingBrake: value });
        assert.equal(f.brake.value(), 'unknown', 'fresh EPB fault cannot be replaced by a legacy applied contact');
        assert.equal(f.brake.status().reason, 'fault');
        assert.equal(f.brake.status().source, 'de.bmw.infotainment.vehicle.Vehicle2.statusStandstillFunctions');
    }
    epb.receive({ statusParkingBrake: 13 });
    assert.equal(f.brake.value(), 'applied', 'an unsupported EPB interface permits a valid legacy contact');
    epb.receive({ statusParkingBrake: 15 });
    assert.equal(f.brake.value(), 'applied', 'a car without a usable EPB may use its valid legacy contact');
    hand.receive({ statusContactHandBrake: 0 });
    assert.equal(f.brake.value(), 'unknown', 'invalid EPB plus uncoded legacy gives no warning');
    assert.equal(f.brake.status().candidates.electronic.reason, 'invalid');
    assert.equal(f.brake.status().candidates.handbrake.reason, 'invalid');
    epb.receive({ statusParkingBrake: 1 });
    time.ms += MAX_AGE_MS; assert.equal(f.brake.value(), 'applied');
    time.ms++; assert.equal(f.brake.value(), 'unknown', 'each source has its own freshness window');
    hand.receive({ statusContactHandBrake: 1 });
    assert.equal(f.brake.value(), 'released', 'fresh legacy reading can recover while EPB remains stale');
    epb.receive({ statusParkingBrake: 1 }); epb.available(false);
    assert.equal(f.brake.value(), 'released', 'one provider loss does not invalidate the other valid source');
    epb.available(true); hand.receive({ statusContactHandBrake: 0 });
    assert.equal(f.brake.value(), 'unknown', 'provider recovery cannot revive the previous EPB-applied state');
    epb.receive({ statusParkingBrake: 1 }); epb.available(false); epb.available(true);
    assert.equal(f.brake.value(), 'unknown', 'brief loss between render ticks invalidates EPB');
    epb.receive({ statusParkingBrake: 0 }); assert.equal(f.brake.value(), 'released');
    const savedAt = time.ms; time.ms -= 1;
    assert.equal(f.brake.value(), 'unknown', 'clock rollback cannot make a future EPB sample valid');
    time.ms = savedAt;
    f.brake.stop(); await microtasks(); assert.equal(f.shutdowns, 2);
    epb.receive({ statusParkingBrake: 1 }); hand.receive({ statusContactHandBrake: 2 });
    assert.equal(f.brake.value(), 'unknown', 'late samples after stop are ignored');
    f.brake.stop(); await microtasks(); assert.equal(f.shutdowns, 2, 'shutdown is idempotent');

    const late = fixture(ParkingBrake, true); await microtasks(); late.brake.stop();
    for (const state of Object.values(late.watches)) state.resolve(state.sub);
    await microtasks(); assert.equal(late.shutdowns, 2, 'both subscriptions resolving after stop shut down');
    for (const state of Object.values(late.watches)) state.receive({ statusParkingBrake: 1, statusContactHandBrake: 2 });
    assert.equal(late.brake.value(), 'unknown');
    const legacyOnly = fixture(ParkingBrake, false, true); await microtasks();
    legacyOnly.watches.handbrake.receive({ statusContactHandBrake: 2 });
    assert.equal(legacyOnly.brake.value(), 'applied', 'an unsupported electronic field does not break legacy cars');
    assert.equal(legacyOnly.brake.status().candidates.electronic.reason, 'error');
    legacyOnly.brake.stop(); await microtasks();
    const app = JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/app.json'), 'utf8'));
    assert.equal(app.signals['de.bmw.infotainment.vehicle.Vehicle2'].statusStandstillFunctions, 'rs', 'EPB getter and notifier must be present in the real app manifest');

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
    console.log('F8X parking brake: distinct electronic/legacy enums, EPB priority and transitions, independent freshness/provider lifecycle, manifest access and applied-only rendering passed.');
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
