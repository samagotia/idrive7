'use strict';
// A notifier-only temperature provider must work without a getter or poll timer.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { InfoData } = require('../shared/f8x_info_data');
const iface = 'de.bmw.infrastructure.EnvironmentalInformation';
const spec = require('../apps/samagotia_clusters/app.json');
const manifest = require('../dist/samagotia_clusters/source/manifest.json');
assert.equal(spec.signals[iface].ExteriorTemperature, 's');
assert.equal(manifest.proxies[iface].attributes.ExteriorTemperature, 's');
const filename = path.resolve(__dirname, '../kit/runtime/signals.js');
const moduleUnderTest = { exports: {} };
let event, unavailable, getters = 0, timers = 0, stops = 0;
const provider = {
    async init() {},
    async subscribeToAvailability(fn) { unavailable = fn; },
    async subscribe({ name, onReceive }) {
        assert.equal(name, 'ExteriorTemperature'); event = onReceive;
    },
    isAvailable() { return true; },
    getValue() { getters++; throw new Error('No temperature getter exists'); },
    shutdown() { stops++; },
};
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: moduleUnderTest, __dirname: path.dirname(filename), setImmediate,
    setInterval() { timers++; throw new Error('Notifier-only field must not be polled'); },
    clearInterval() {},
    require(name) {
        if (name === 'path') return path;
        if (name === 'fs') return { readFileSync: () => JSON.stringify({ fields: {
            ExteriorTemperature: { notifier: { id: 32769, eventgroups: [1] } },
        } }) };
        if (name === 'someip') return { buildProxy: async () => provider };
        throw new Error('Unexpected dependency ' + name);
    },
}, { filename });
(async () => {
    const data = new InfoData();
    const sub = await moduleUnderTest.exports.watch(iface, '1', {
        ExteriorTemperature: (value) => data.ambient(value),
    }, { warn(message) { throw new Error(message); } });
    sub.onAvailability((available) => data.availability('ambient', available));
    data.availability('ambient', sub.available);
    assert.equal(data.value('ambientC'), null);
    event({ temperatureExterior: 147 });
    assert.equal(data.value('ambientC'), 33.5);
    unavailable(false);
    assert.equal(data.value('ambientC'), null);
    event({ temperatureExterior: 150 });
    assert.equal(data.value('ambientC'), null);
    await sub.shutdown();
    assert.equal(stops, 1); assert.equal(getters, 0); assert.equal(timers, 0);
    console.log('F8X temperature: generated notification-only manifest, actual signal handler, no getter/polling, and provider loss passed.');
})().catch((error) => { console.error(error.stack); process.exitCode = 1; });
