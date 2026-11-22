'use strict';
// Actual vehicle + signal helper; only the SOME/IP provider and clock are simulated.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const signalFile = path.join(root, 'kit/runtime/signals.js');
const vehicleFile = path.join(root, 'shared/f8x_vehicle.js');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

async function run() {
    let now = 0, nextTimer = 1;
    const timers = new Map(), providers = new Map();
    const rpmField = 'statusEngineSpeed2', speedField = 'statusCarSpeed2', tempField = 'statusEngineTemperature';
    const rpmIface = 'de.bmw.infotainment.vehicle.CDS', speedIface = 'de.bmw.infotainment.vehicle.Vehicle2';
    const values = { [rpmField]: { actualValueRPMEngineCrankshaft: 0 },
        [speedField]: { speedVehicleCentreOfGravity: 0 },
        [tempField]: { temperatureEngineDrive: 138, temperatureEngineOilDrive: 138 } };
    const reads = [], optionCalls = [];
    class Provider {
        constructor(iface) {
            this.iface = iface; this.available = true; this.handlers = new Map();
            this.pending = []; this.blockField = null; this.failed = false; this.shutdowns = 0;
        }
        async init() {}
        async subscribeToAvailability(listener) { this.availability = listener; }
        async subscribe({ name, onReceive }) { this.handlers.set(name, onReceive); }
        isAvailable() { return this.available; }
        setAvailable(value) { this.available = value; this.availability(value); }
        notify(field, value) { this.handlers.get(field)(value); }
        getValue(field, timeoutMs) {
            reads.push({ iface: this.iface, field, timeoutMs, at: now });
            const value = Object.assign({}, values[field]);
            if (this.failed) return Promise.reject(new Error('simulated getter timeout'));
            if (this.blockField === field) return new Promise((resolve) => this.pending.push({ field, resolve, value }));
            return Promise.resolve(value);
        }
        release() { const pending = this.pending.shift(); assert(pending); pending.resolve(pending.value); }
        shutdown() { this.shutdowns++; }
    }
    const signalsModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(signalFile, 'utf8'), {
        module: signalsModule, __dirname: path.dirname(signalFile), setImmediate,
        setInterval(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms, next: now + ms }); return id; },
        clearInterval(id) { timers.delete(id); },
        require(name) {
            if (name === 'path') return path;
            if (name === 'fs') return { readFileSync(file) {
                const iface = path.basename(file, '.json').replace(/_/g, '.');
                const fields = iface === rpmIface ? { [rpmField]: { getter: true }, [tempField]: { getter: true } }
                    : { [speedField]: { getter: true } };
                return JSON.stringify({ iface, fields });
            } };
            if (name === 'someip') return { async buildProxy(config) {
                const provider = new Provider(config.iface); providers.set(config.iface, provider); return provider;
            } };
            throw new Error('Unexpected signal dependency: ' + name);
        },
    }, { filename: signalFile });
    const vehicleModule = { exports: {} };
    vm.runInNewContext(fs.readFileSync(vehicleFile, 'utf8'), {
        module: vehicleModule, Date: { now: () => now },
        process: { env: {}, uptime: () => now / 1000 },
        clearInterval() {},
    }, { filename: vehicleFile });
    const Car = vehicleModule.exports;
    const signals = { watch(iface, instance, handlers, log, options) {
        optionCalls.push({ iface, options });
        return signalsModule.exports.watch(iface, instance, handlers, log, options);
    } };
    const car = new Car({ spec: { config: {} }, signals,
        settings: { get() { return 'off'; } },
        log: { info() {}, warn(message) { throw new Error(message); } },
    }, ['rpm', 'speed', 'temps'], {}, true);
    const samples = []; car.onSample((value) => samples.push(Object.assign({}, value)));
    async function advance(to) {
        while (true) {
            const entry = [...timers.values()].sort((a, b) => a.next - b.next)[0];
            if (!entry || entry.next > to) break;
            now = entry.next; entry.next += entry.ms; entry.fn(); await settle();
        }
        now = to; await settle();
    }
    try {
        await settle();
        assert.equal(car.subs.length, 2);
        const rpmProvider = providers.get(rpmIface), speedProvider = providers.get(speedIface);
        const rpmOptions = optionCalls.find((call) => call.iface === rpmIface).options;
        const speedOptions = optionCalls.find((call) => call.iface === speedIface).options;
        assert.equal(rpmOptions.pollMs, 10); assert.equal(speedOptions.pollMs, 50);
        assert.equal(rpmOptions.pollFields.length, 1); assert.equal(rpmOptions.pollFields[0], rpmField);
        assert.equal(speedOptions.pollFields.length, 1); assert.equal(speedOptions.pollFields[0], speedField);
        assert.equal(rpmOptions.readTimeoutMs, 500); assert.equal(speedOptions.readTimeoutMs, 500);
        assert.equal(car.data().rpm, 0); assert.equal(car.data().speed, 0);
        assert.equal(car.missingCriticalSignal(1500), null, 'stationary zero samples are valid');
        const tempReadsAtStart = reads.filter((read) => read.field === tempField).length;
        assert.equal(tempReadsAtStart, 1, 'temperature keeps its existing initial read');

        await advance(9);
        values[rpmField] = { actualValueRPMEngineCrankshaft: 8000 };
        assert.equal(car.data().rpm, 0, 'a new provider value is not invented before a read');
        await advance(10);
        assert.equal(car.data().rpm, 2000, 'the first 10 ms getter acquires the new RPM');
        assert.equal(reads.filter((read) => read.field === rpmField).length, 2,
            'one initial read and one 10 ms periodic read');
        assert.equal(car.data().speed, 0);
        assert.equal(reads.filter((read) => read.field === speedField).length, 1,
            'RPM polling does not accelerate the separate speed cadence');

        // Hold an old getter in flight. New notices must take precedence, and
        // repeated poll ticks must not create a queue of outstanding requests.
        rpmProvider.blockField = rpmField;
        await advance(20);
        assert.equal(rpmProvider.pending.length, 1);
        const readCount = reads.filter((read) => read.field === rpmField).length;
        await advance(49);
        values[speedField] = { speedVehicleCentreOfGravity: 6400 };
        assert.equal(car.data().speed, 0, 'speed is not invented ahead of the next provider read');
        await advance(50);
        assert.equal(car.data().speed, 100, 'getter-only speed change is acquired by the next 50 ms backup read');
        values[speedField] = { speedVehicleCentreOfGravity: 0 };
        await advance(100);
        assert.equal(car.data().speed, 0, 'a getter-only return to zero is also acquired at 50 ms');
        await advance(400);
        assert.equal(reads.filter((read) => read.field === rpmField).length, readCount,
            '38 more 10 ms polls do not start another pending RPM getter');
        rpmProvider.notify(rpmField, { actualValueRPMEngineCrankshaft: 16000 });
        assert.equal(car.data().rpm, 4000, 'newer notification is delivered immediately');
        const notified = samples.length;
        rpmProvider.notify(rpmField, { actualValueRPMEngineCrankshaft: 16000 });
        assert.equal(samples.length, notified, 'an unchanged notification does not wake the renderer again');
        rpmProvider.release(); await settle();
        assert.equal(car.data().rpm, 4000, 'the old 2000 RPM getter cannot overwrite a newer notification');
        rpmProvider.blockField = null;

        values[rpmField] = { actualValueRPMEngineCrankshaft: 0 };
        const beforeStationary = samples.length;
        await advance(2200);
        assert.equal(car.data().rpm, 0); assert.equal(car.data().speed, 0);
        assert.equal(car.missingCriticalSignal(1500), null,
            'repeated valid zero getters keep parked signals fresh');
        assert.equal(samples.length, beforeStationary + 1,
            '180 valid RPM polls and 36 speed reads emit only the changed zero, with no redundant render wakeups');
        assert.equal(reads.filter((read) => read.field === speedField && read.at > 1000 && read.at <= 2000).length, 20,
            'getter-only speed backup performs exactly 20 reads per second');
        assert.equal(reads.filter((read) => read.field === tempField).length, tempReadsAtStart,
            'fast RPM polling never re-reads unrelated CDS temperature fields');
        assert(reads.every((read) => read.timeoutMs === 500), 'bounded read timeout is preserved');

        rpmProvider.failed = true;
        await advance(3699);
        assert.equal(car.missingCriticalSignal(1500), null);
        await advance(3700);
        assert.equal(car.missingCriticalSignal(1500), 'rpm', 'failed getters do not refresh stale RPM');
        rpmProvider.failed = false;
        await advance(3750);
        assert.equal(car.missingCriticalSignal(1500), null, 'a fresh valid read recovers signal freshness');

        rpmProvider.setAvailable(false);
        assert.equal(car.missingCriticalSignal(1500), 'rpm', 'provider loss invalidates RPM immediately');
        rpmProvider.setAvailable(true); await settle();
        assert.equal(car.missingCriticalSignal(1500), null);

        speedProvider.blockField = speedField;
        await advance(3800); assert.equal(speedProvider.pending.length, 1);
        const speedReadsPending = reads.filter((read) => read.field === speedField).length;
        speedProvider.notify(speedField, { speedVehicleCentreOfGravity: 3200 });
        assert.equal(car.data().speed, 50, 'speed notification bypasses the 50 ms backup timer immediately');
        await advance(4050);
        assert.equal(reads.filter((read) => read.field === speedField).length, speedReadsPending,
            'repeated speed backup ticks cannot queue another getter while one is pending');
        speedProvider.release(); await settle();
        assert.equal(car.data().speed, 50, 'an old speed getter cannot overwrite a newer notification');
        speedProvider.blockField = null;
        speedProvider.failed = true;
        await advance(5299);
        assert.equal(car.missingCriticalSignal(1500), null);
        await advance(5300);
        assert.equal(car.missingCriticalSignal(1500), 'speed', 'failed speed getters preserve the same 1500 ms dropout rule');
        speedProvider.failed = false;
        await advance(5350);
        assert.equal(car.missingCriticalSignal(1500), null, 'fresh speed getter restores validity');
        speedProvider.setAvailable(false);
        assert.equal(car.missingCriticalSignal(1500), 'speed', 'speed provider loss invalidates immediately');
        speedProvider.setAvailable(true); await settle();
        assert.equal(car.missingCriticalSignal(1500), null);

        rpmProvider.blockField = rpmField; speedProvider.blockField = speedField;
        await advance(5400);
        assert.equal(rpmProvider.pending.length, 1); assert.equal(speedProvider.pending.length, 1);
        const beforeStop = samples.length;
        car.stop(); await settle();
        assert.equal(timers.size, 0, 'shutdown clears both polling intervals');
        rpmProvider.release(); rpmProvider.notify(rpmField, { actualValueRPMEngineCrankshaft: 24000 });
        speedProvider.release(); speedProvider.notify(speedField, { speedVehicleCentreOfGravity: 6400 });
        await settle();
        assert.equal(samples.length, beforeStop, 'late getters and notices cannot revive a stopped vehicle feed');
        assert.equal(rpmProvider.shutdowns, 1); assert.equal(speedProvider.shutdowns, 1);
        console.log('F8X critical acquisition: RPM-only 10 ms and speed-only 50 ms reads, one pending getter per field, immediate changed notices, duplicate render-wakeup suppression with stationary freshness, unchanged independent dropout and teardown passed.');
    } finally { if (!car.stopped) car.stop(); }
}
run().catch((error) => { console.error(error.stack); process.exitCode = 1; });
