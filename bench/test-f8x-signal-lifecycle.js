'use strict';
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = path.resolve(__dirname, '../kit/runtime/signals.js');
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(setImmediate); };

async function main() {
    const timers = new Map(), getters = [], received = [], available = [];
    let nextTimer = 1, shutdowns = 0, event, providerAvailability;
    const provider = {
        async init() {},
        async subscribeToAvailability(listener) { providerAvailability = listener; },
        async subscribe({ onReceive }) { event = onReceive; },
        isAvailable() { return true; },
        getValue(field, timeout) {
            assert.equal(field, 'statusHandBrake'); assert.equal(timeout, 700);
            return new Promise((resolve) => getters.push(resolve));
        },
        shutdown() { shutdowns++; },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(source, 'utf8'), {
        module, __dirname: path.dirname(source), setImmediate,
        setInterval: (fn, ms) => { assert.equal(ms, 1000); const id = nextTimer++; timers.set(id, fn); return id; },
        clearInterval: (id) => timers.delete(id),
        require: (name) => {
            if (name === 'path') return path;
            if (name === 'fs') return { readFileSync: () => JSON.stringify({ fields: { statusHandBrake: { getter: true } } }) };
            if (name === 'someip') return { buildProxy: async () => provider };
            throw new Error('Unexpected dependency ' + name);
        },
    }, { filename: source });
    const sub = await module.exports.watch('de.bmw.infotainment.vehicle.CDS', '1', {
        statusHandBrake: (sample) => received.push(sample),
    }, { warn(message) { throw new Error(message); } }, { pollMs: 1000, readTimeoutMs: 700 });
    sub.onAvailability((value) => available.push(value));
    await settle();
    assert.equal(sub.available, true); assert.equal(getters.length, 1); assert.equal(timers.size, 1);
    providerAvailability(false);
    assert.equal(sub.available, false); assert.equal(available[available.length - 1], false);
    event('ignored while disconnected'); getters.shift()('stale in-flight getter');
    await settle(); assert.deepEqual(received, []);
    providerAvailability(true); await settle();
    assert.equal(getters.length, 1); getters.shift()('fresh recovery');
    await settle(); assert.deepEqual(received, ['fresh recovery']);
    [...timers.values()][0](); await settle(); assert.equal(getters.length, 1);
    await sub.shutdown(); assert.equal(timers.size, 0); assert.equal(shutdowns, 1); assert.equal(sub.available, false);
    getters.shift()('late getter after shutdown'); event('late event after shutdown'); providerAvailability(true);
    await settle();
    assert.equal(sub.available, false); assert.deepEqual(received, ['fresh recovery']); assert.equal(getters.length, 0);
    console.log('F8X signal lifecycle: pending reads, availability, late events and poll-timer teardown passed.');
}
main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
