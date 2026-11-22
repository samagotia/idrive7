'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const fuel = require('../shared/f8x_fuel_warning');
let now = 1000;
const fakeProcess = { env: {}, uptime: () => now / 1000 };
const carModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_vehicle.js'), 'utf8'), {
    module: carModule, process: fakeProcess, clearInterval, setInterval,
});
const moduleUnderTest = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: moduleUnderTest, Buffer, process: fakeProcess,
    require: (name) => name === './f8x_warning' ? require('../shared/f8x_warning') : name === './f8x_info_data' ? require('../shared/f8x_info_data') : name === './f8x_vehicle' ? carModule.exports : name === './f8x_fuel_warning' ? fuel : {},
});
const Runtime = moduleUnderTest.exports;
const subscriptions = new Map();
const log = { info() {}, warn() {} };
const ctx = { spec: { config: {} }, log, settings: { get: () => 'off' }, signals: {
    async watch(iface, instance, handlers, logger, options) {
        assert(!Object.keys(handlers).some((key) => key.startsWith('$')), 'availability hook must not become a vehicle field');
        const listeners = [];
        const sub = { iface, handlers, available: true, onAvailability(fn) { listeners.push(fn); },
            change(value) { this.available = value; listeners.forEach((fn) => fn(value)); }, shutdown() {} };
        subscriptions.set(iface, sub);
        if (iface.endsWith('KombiIF')) assert.equal(options.pollMs, 10000);
        return sub;
    },
} };
const state = Object.assign(Object.create(Runtime.prototype), { ctx, log, kombiAvailable: false, fuelWarningSample: null,
    setting: () => 7200, _watchF82Turns() {}, _queueF82() {},
    fuelWarningState: Runtime.prototype.fuelWarningState, _blitDiff() {} });
(async () => {
    Runtime.prototype._setupVehicleData.call(state);
    await Promise.resolve(); await Promise.resolve();
    const kombi = subscriptions.get('de.bmw.infotainment.KombiIF');
    const receive = kombi.handlers.statusRangeTankStatus;
    const send = (reserve, range) => receive({ statusFluidLevelFuelTankSpare: reserve, range, fluidLevelFuelTank: 4 });
    assert.equal(state.fuelWarningState().active, null);
    send(1, 100); assert.equal(state.fuelWarningState().active, true);
    assert.equal(state.fuelWarningState().source, 'bmw-reserve');
    send(0, 49); assert.equal(state.fuelWarningState().active, false, 'explicit BMW inactive wins');
    send(3, 51); assert.equal(state.fuelWarningState().active, false);
    send(3, 50); assert.equal(state.fuelWarningState().active, true);
    assert.equal(state.fuelWarningState().source, 'range-fallback');
    // Visibility is a cached state update, independent of distance-unit settings.
    const writes = [];
    const x = { w: { warningRole: 'attentionTriangle' }, ref: 1, last: null, warningPaint: undefined,
        c: { set(ref, pose) { writes.push(pose.visible); }, pixels() { throw Error('visibility must not upload artwork'); } } };
    x.warningPaint = state.f82Light;
    Runtime.prototype._update.call(state, x, now, false);
    for (let i = 0; i < 100; i++) Runtime.prototype._update.call(state, x, now, false);
    assert.deepEqual(writes, [true]);
    kombi.change(false);
    assert.equal(state.fuelWarningSample, null);
    Runtime.prototype._update.call(state, x, now, false);
    assert.deepEqual(writes, [true, false]);
    kombi.change(true);
    assert.equal(state.fuelWarningState().active, null, 'reconnect cannot revive a cached low range');
    send(3, 0); assert.equal(state.fuelWarningState().active, true, 'zero range is a valid warning');
    now += fuel.MAX_AGE_MS;
    assert.equal(state.fuelWarningState().active, null, 'expiry uses the monotonic receipt clock');
    send(3, 4095); assert.equal(state.fuelWarningState().active, null);
    send(1, 4095); assert.equal(state.fuelWarningState().active, true, 'valid BMW reserve does not need valid range');
    send(0, 4095); assert.equal(state.fuelWarningState().active, false);
    state.car.stop();
    // The Mac provider must expose the same availability transitions as the
    // native signal adapter; otherwise a correct warning would stay hidden.
    const stub = fs.readFileSync(path.join(root, 'kit/tools/hu-stub.js'), 'utf8');
    const start = stub.indexOf('function liveSignals(hu)');
    const end = stub.indexOf('/* ---------------- emu.js', start);
    const makeSignals = vm.runInNewContext('(' + stub.slice(start, end).trim() + ')');
    const hu = { log }, adapter = makeSignals(hu), availability = [], samples = [];
    const sub = await adapter.watch('test', '1', { field: (value) => samples.push(value) });
    sub.onAvailability((value) => availability.push(value));
    hu.feed('test', 'field', 1); hu.feed('test', 'field', 2);
    hu.feed('test', 'field', 3, false);
    hu.feed('test', 'field', 4);
    await sub.shutdown(); hu.feed('test', 'field', 5);
    assert.deepEqual(samples, [1, 2, 4]);
    assert.deepEqual(availability, [true, false, true, false]);
    console.log('F8X fuel warning runtime: existing live stream, priority, inclusive 50 km fallback, zero range, provider loss/reconnect, monotonic expiry and pose-only cached visibility passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
