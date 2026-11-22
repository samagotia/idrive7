'use strict';
const assert = require('assert');
const { Doors, decodeContact, decodeContacts, decodeMetadata, INTERFACE, FIELDS,
    METADATA_INTERFACE, METADATA_FIELD, METADATA_MAX_AGE_MS, CONTACTS, MODELS, BODY } = require('../shared/f8x_doors');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function contacts(changes) {
    return Object.assign({ statusDoorSwitchDRD: 0, statusDoorSwitchPSD: 0,
        statusDoorSwitchDRDR: 0, statusDoorSwitchPSDR: 0, statusContactBonnet: 0,
        statusContactBootLid: 0, statusContactBootLid2: 3 }, changes);
}
function metadata(changes) { return Object.assign({ typeVehicle: 122, typeBody: 2, typeSteering: 1 }, changes); }
async function run() {
    Object.keys(CONTACTS).forEach((key) => {
        const spec = CONTACTS[key];
        assert.strictEqual(decodeContact(0, spec[1], spec[2]), 'closed');
        assert.strictEqual(decodeContact(spec[1], spec[1], spec[2]), 'closed');
        assert.strictEqual(decodeContact(1, spec[1], spec[2]), 'open');
        assert.strictEqual(decodeContact(spec[2], spec[1], spec[2]), 'open');
        [2, 3, 255, -1, 1.5, true, false, '0', '1', 'OFFEN', 'SIGNAL_UNGUELTIG', null, undefined, NaN, Infinity, {}]
            .forEach((value) => assert.strictEqual(decodeContact(value, spec[1], spec[2]), 'unknown'));
    });
    const named = {};
    Object.keys(CONTACTS).forEach((key) => { named[CONTACTS[key][0]] = CONTACTS[key][2]; });
    const decodedNamed = decodeContacts(named, true);
    Object.keys(decodedNamed).forEach((key) => assert.strictEqual(decodedNamed[key], 'open'));
    assert.strictEqual(decodeContacts(named, false).boot2, 'unknown', 'legacy wrapper cannot supply second flap');
    Object.keys(decodeContacts(null, true)).forEach((key) => assert.strictEqual(decodeContacts(null, true)[key], 'unknown'));
    assert.strictEqual(decodeContacts({ statusCentralLockingSystemBootlid: 1 }, true).boot, 'unknown', 'unlocked is not open');
    assert.strictEqual(decodeContacts({ statusDoorSwitchPSD: 'FAT_IST_OFFEN' }, true).passengerFront, 'unknown', 'named enums are field-specific');
    assert.deepStrictEqual(decodeMetadata(metadata()), { model: 'G82', body: 'coupe', bodyCode: 2, steering: 'lhd', layout: 'two', splitBoot: false });
    Object.keys(MODELS).forEach((model) => {
        const namedMeta = decodeMetadata(metadata({ typeVehicle: model }));
        const numberedMeta = decodeMetadata(metadata({ typeVehicle: MODELS[model] }));
        assert.deepStrictEqual(namedMeta, numberedMeta); assert.strictEqual(namedMeta.model, model);
        assert.strictEqual(namedMeta.layout, ['F80', 'G80', 'G05'].indexOf(model) >= 0 ? 'four' : 'two');
    });
    Object.keys(BODY).forEach((body) => assert.deepStrictEqual(
        decodeMetadata(metadata({ typeVehicle: 0, typeBody: body })),
        decodeMetadata(metadata({ typeVehicle: 0, typeBody: BODY[body] }))));
    assert.strictEqual(decodeMetadata({ typeBody: 'HATCH_COUPE' }).layout, null, 'hatchback class does not determine side-door count');
    assert.strictEqual(decodeMetadata({ typeBody: 'LIMOUSINE' }).layout, 'four');
    assert.strictEqual(decodeMetadata({ typeBody: 'ROADSTER' }).layout, 'two');
    assert.strictEqual(decodeMetadata({ typeBody: '_4_X_4_TWO_PIECE_TAILGATE' }).splitBoot, true);
    assert.strictEqual(decodeMetadata({ typeSteering: 'RECHTSLENKER' }).steering, 'rhd');
    for (const raw of [0, 15, 255, -1, true, '1', 'LEFT', null, undefined, NaN]) {
        assert.strictEqual(decodeMetadata({ typeSteering: raw }).steering, null);
    }
    assert.strictEqual(decodeMetadata({ typeVehicle: 'G82', typeBody: 255 }).layout, 'two', 'known-model artwork policy can work without body class');
    assert.strictEqual(decodeMetadata({ typeVehicle: 255, typeBody: 255 }).layout, null);

    let now = 100, shutdowns = 0;
    const watches = {};
    const ctx = { log: { info() {} }, signals: { watch(iface, instance, handlers, log, opts) {
        assert.strictEqual(instance, '1');
        const w = { available: true, handlers, onAvailability(fn) { w.changed = fn; },
            shutdown() { shutdowns++; }, setAvailable(value) { w.available = value; if (w.changed) w.changed(value); } };
        if (iface === INTERFACE) {
            assert.deepStrictEqual(Object.keys(handlers), FIELDS);
            assert.strictEqual(opts, undefined, 'closure contacts have no invented getter/polling options');
        } else {
            assert.strictEqual(iface, METADATA_INTERFACE);
            assert.deepStrictEqual(Object.keys(handlers), [METADATA_FIELD]);
            assert.deepStrictEqual(opts, { pollMs: 10000, pollFields: [METADATA_FIELD], readTimeoutMs: 1000 });
        }
        watches[iface] = w;
        return Promise.resolve(w);
    } } };
    const tracker = new Doors(ctx, { now: () => now });
    try {
        await tick();
        const door = watches[INTERFACE], meta = watches[METADATA_INTERFACE];
        const send = (v) => door.handlers[FIELDS[0]](v);
        const send2 = (v) => door.handlers[FIELDS[1]](v);
        const model = (v) => meta.handlers[METADATA_FIELD](v);
        assert.strictEqual(tracker.value().anyOpen, false);
        assert.strictEqual(tracker.value().allClosed, false, 'initial unknown is never all-closed reassurance');
        assert.strictEqual(tracker.value().layout, null);
        assert.strictEqual(tracker.status().reason, 'waiting');
        send(contacts({ statusDoorSwitchDRD: 1 }));
        let value = tracker.value();
        assert.strictEqual(value.closures.driverFront, 'open'); assert.strictEqual(value.anyOpen, true);
        assert.strictEqual(value.physical.frontLeft, 'unknown', 'unknown steering must not silently assume LHD');
        assert.strictEqual(value.physical.frontRight, 'unknown');
        send2({});
        assert.strictEqual(tracker.value().closures.driverFront, 'open', 'unfilled extended default cannot hijack a meaningful legacy stream');
        assert.strictEqual(tracker.value().source, FIELDS[0]);
        model(metadata()); value = tracker.value();
        assert.strictEqual(value.physical.frontLeft, 'open'); assert.strictEqual(value.physical.frontRight, 'closed');
        assert.strictEqual(value.layout, 'two'); assert.strictEqual(value.steering, 'lhd');
        assert.strictEqual(tracker.value({ steering: 'rhd' }).physical.frontRight, 'open');
        assert.strictEqual(tracker.value({ steering: 'rhd' }).physical.frontLeft, 'closed');
        assert.strictEqual(tracker.value({ layout: 'four' }).layout, 'four');
        model(metadata({ typeSteering: 'RECHTSLENKER' }));
        assert.strictEqual(tracker.value().physical.frontRight, 'open', 'RHD moves driver contact to physical right');
        assert.strictEqual(tracker.value({ steering: 'lhd' }).physical.frontLeft, 'open');
        send(contacts()); assert.strictEqual(tracker.value().allClosed, true);
        send(contacts({ statusDoorSwitchDRDR: 3, statusDoorSwitchPSDR: 3 }));
        assert.strictEqual(tracker.value().layout, 'two', 'coupe metadata independent of invalid rear fields');
        model(metadata({ typeVehicle: 0, typeBody: 255 }));
        assert.strictEqual(tracker.value().layout, null, 'invalid rears do not infer a coupe when metadata unknown');
        assert.strictEqual(tracker.value().allClosed, false);
        model(metadata({ typeVehicle: 'G05', typeBody: '_4_X_4_TWO_PIECE_TAILGATE' }));
        send2(contacts()); assert.strictEqual(tracker.value().layout, 'four');
        assert.strictEqual(tracker.value().allClosed, false, 'split tailgate requires observed second flap closed');
        send2(contacts({ statusContactBootLid2: 0 })); assert.strictEqual(tracker.value().allClosed, true);
        send2(contacts({ statusDoorSwitchPSD: 1, statusContactBootLid2: 1 }));
        value = tracker.value(); assert.strictEqual(value.physical.frontRight, 'open');
        assert.strictEqual(value.closures.boot2, 'open'); assert.strictEqual(value.anyOpen, true);
        assert.strictEqual(value.source, FIELDS[1]);
        send(contacts());
        assert.strictEqual(tracker.value().closures.passengerFront, 'open', 'late legacy packets cannot override extended session');
        send2({ statusContactBonnet: 1 }); value = tracker.value();
        assert.strictEqual(value.closures.bonnet, 'open'); assert.strictEqual(value.closures.passengerFront, 'unknown', 'snapshots do not merge stale missing members');
        assert.strictEqual(value.closures.boot2, 'unknown');
        send2({}); assert.strictEqual(tracker.value().anyOpen, false); assert.strictEqual(tracker.value().allClosed, false);
        send(contacts({ statusDoorSwitchPSD: 1 })); assert.strictEqual(tracker.value().anyOpen, false, 'invalid extended reading cannot revive old wrapper state');
        send2(contacts({ statusDoorSwitchDRDR: 1, statusContactBootLid: 1 }));
        value = tracker.value(); assert.strictEqual(value.anyOpen, true); assert.strictEqual(value.physical.rearLeft, 'open');
        value.closures.driverRear = 'closed'; value.physical.rearLeft = 'closed';
        assert.strictEqual(tracker.value().physical.rearLeft, 'open', 'returned snapshots cannot mutate cache');
        now += 3600000;
        assert.strictEqual(tracker.value().closures.driverRear, 'open', 'unchanged open contact remains observed during provider session');
        assert.strictEqual(tracker.status().ageMs, 3600000);
        assert.strictEqual(tracker.status().cadenceVerified, false);
        assert.strictEqual(tracker.status().closureExpiry, 'provider-session');
        assert.strictEqual(tracker.value().layout, null, 'gettable metadata expires independently');
        assert.strictEqual(tracker.value().physical.rearLeft, 'unknown', 'stale steering does not preserve side assertion');
        assert.strictEqual(tracker.value({ layout: 'four', steering: 'lhd' }).physical.rearLeft, 'open', 'explicit presentation override is independent');
        now = 500; assert.strictEqual(tracker.value().layout, null, 'clock rollback cannot revive cleared metadata');
        model(metadata()); now += METADATA_MAX_AGE_MS + 1;
        assert.strictEqual(tracker.value().model, null);
        model(metadata()); now = NaN; assert.strictEqual(tracker.value().model, null);
        now = 200;
        model(metadata());
        door.setAvailable(false);
        assert.strictEqual(tracker.value().anyOpen, false); assert.strictEqual(tracker.value().closures.boot, 'unknown');
        assert.strictEqual(tracker.status().reason, 'unavailable');
        send2(contacts({ statusContactBonnet: 1 })); assert.strictEqual(tracker.value().anyOpen, false, 'reject late packets while unavailable');
        door.setAvailable(true); assert.strictEqual(tracker.value().allClosed, false);
        assert.strictEqual(tracker.status().reason, 'waiting');
        send(contacts({ statusContactBootLid: 1 }));
        assert.strictEqual(tracker.value().source, FIELDS[0], 'new provider session resets extended preference');
        assert.strictEqual(tracker.value().closures.boot, 'open');
        meta.setAvailable(false); model(metadata()); assert.strictEqual(tracker.value().model, null);
        meta.setAvailable(true); assert.strictEqual(tracker.value().model, null, 'metadata reconnect requires fresh packet');
        model(metadata()); assert.strictEqual(tracker.value().model, 'G82');
        assert.strictEqual(tracker.value().closures.boot, 'open', 'metadata loss does not clear unrelated closure session');
        tracker.stop(); tracker.stop(); await tick(); assert.strictEqual(shutdowns, 2);
        send2(contacts({ statusContactBonnet: 1 })); model(metadata());
        assert.strictEqual(tracker.value().anyOpen, false); assert.strictEqual(tracker.value().model, null);
        assert.strictEqual(tracker.status().reason, 'stopped');
    } finally { tracker.stop(); }

    const pending = [], stopped = [];
    const late = new Doors({ signals: { watch(iface, instance, handlers) {
        return new Promise((resolve) => pending.push({ iface, handlers, resolve }));
    } } });
    await tick(); late.stop();
    pending.forEach((p) => {
        Object.keys(p.handlers).forEach((field) => p.handlers[field](field === METADATA_FIELD ? metadata() : contacts({ statusContactBonnet: 1 })));
        p.resolve({ available: true, shutdown() { stopped.push(p.iface); } });
    });
    await tick(); assert.strictEqual(stopped.length, 2); assert.strictEqual(late.value().anyOpen, false);
    const failed = new Doors({ signals: { watch() { throw Error('not in catalog'); } } });
    await tick(); assert.strictEqual(failed.status().reason, 'error'); assert.strictEqual(failed.status().metadata.reason, 'error'); failed.stop();
    console.log('F8X doors: exact contact enums, metadata/model policy, LHD/RHD, unknowns, notification-only subscriptions, whole-stream precedence, no fabricated heartbeat TTL, provider recovery and late teardown passed.');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
