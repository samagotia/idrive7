'use strict';
// Real closure decoder + real warning presenter + real pixels; only transports
// are simulated. No vehicle connection and no renderer-ownership override.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const { Doors } = require('../shared/f8x_doors');
const warning = require('../shared/f8x_warning');
const doorArt = require('../shared/f8x_door_art');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, 'apps/samagotia_clusters/cluster', name)));
const load = (name, dependencies) => {
    const m = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'shared', name), 'utf8'), {
        module: m, Buffer, console, process, setInterval, clearInterval, setTimeout, clearTimeout,
        require: (key) => Object.prototype.hasOwnProperty.call(dependencies, key) ? dependencies[key] : {},
    }, { filename: name });
    return m.exports;
};
const text = load('f8x_text.js', { './f8x_data': { json: readJson } });
const fuelArt = load('f8x_fuel_warning_art.js', {
    './f8x_brake_art': require('../shared/f8x_brake_art'), './f8x_icons': require('../shared/f8x_icons'), './f8x_text': text,
});
const Runtime = load('f8x_runtime.js', { './f8x_warning': warning, './f8x_door_art': doorArt,
    './f8x_text': text, './f8x_fuel_warning_art': fuelArt });
const fixtureLayout = readJson('layouts/our_m4.json');
const readAsset = (name) => readJson('f82/' + name + '.json');
const widgets = fuelArt.widgetsFor(fixtureLayout, readAsset).concat(doorArt.widgetsFor(fixtureLayout, readAsset));
assert.strictEqual(widgets.length, 4, 'three shared warning widgets plus one small diagram');
let now = 1000;
const streams = {};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const CONTACTS = ['statusDoorSwitchDRD', 'statusDoorSwitchPSD', 'statusDoorSwitchDRDR',
    'statusDoorSwitchPSDR', 'statusContactBonnet', 'statusContactBootLid', 'statusContactBootLid2'];
const packet = (patch) => Object.assign(CONTACTS.reduce((o, key) => { o[key] = 0; return o; }, {}), patch);
async function run() {
    const tracker = new Doors({ log: { info() {} }, signals: {
        watch(iface, instance, handlers) {
            const sub = { available: true, handlers, shutdown() { sub.available = false; },
                onAvailability(fn) { sub.change = fn; } };
            streams[iface] = sub;
            return Promise.resolve(sub);
        },
    } }, { now: () => now });
    try {
        await tick();
        const body = streams['de.bmw.body.DoorsWindowsRoofMirrors'];
        const meta = streams['de.bmw.infotainment.vehicle.Vehicle2'];
        const feed = (patch) => body.handlers.CentralLockingSystemAndPanelStatus2(packet(patch));
        const feedMeta = (patch) => meta.handlers.statusVehiclePartType(Object.assign({ typeVehicle: 122, typeBody: 2, typeSteering: 1 }, patch));
        let fuel = { active: null }, settings = { f8xVehicleLayout: 'auto', f8xSteeringSide: 'auto', f82InfoPage: 'date' };
        const writes = [], poses = [], creations = [];
        const transport = { image(options) { creations.push(options); return creations.length; },
            pixels(ref, rect, bytes) { writes.push({ ref, rect, bytes: Buffer.from(bytes) }); },
            set(ref, pose) { poses.push({ ref, visible: pose.visible }); } };
        const runtime = Object.assign(Object.create(Runtime.prototype), { doors: tracker,
            fuelWarningState: () => fuel, setting: (key) => settings[key], f82Light: 'day',
            _connOf: () => 0, _clientAt: () => transport, widgets: new Map(), theme: {}, target: 'panel',
        });
        widgets.forEach((w) => runtime._create(w, null));
        assert(creations.every((base) => base.target === 'panel' && base.klass === 'content' && base.visible === false));
        for (const base of creations) for (const key of ['yield', 'contend', 'hold', 'takeOver', 'take_over_stock']) {
            assert(!Object.prototype.hasOwnProperty.call(base, key), 'custom warning must not override native ownership with ' + key);
        }
        assert(poses.every((p) => !p.visible), 'unknown contacts do not show all-closed reassurance');
        const layers = widgets.map((w) => runtime.widgets.get(w.id));
        const diagram = layers.find((x) => x.w.doorRole);
        const label = layers.find((x) => x.w.warningRole === 'fuelReserveText');
        const pump = layers.find((x) => x.w.warningRole === 'fuelReserveIcon');
        const triangle = layers.find((x) => x.w.warningRole === 'attentionTriangle');
        const update = () => layers.forEach((x) => runtime._update(x, now, false));
        const lastVisible = (layer) => poses.filter((p) => p.ref === layer.ref).slice(-1)[0].visible;
        const uploadsFor = (layer) => writes.filter((p) => p.ref === layer.ref).length;
        const total = () => writes.length + poses.length;
        const start = total(); for (let i = 0; i < 60; i++) update();
        assert.strictEqual(total(), start, 'idle unknown state sends no pixels or poses');

        fuel = { active: true }; update();
        assert.strictEqual(runtime.warningPresentation().kind, 'fuel');
        assert(lastVisible(label) && lastVisible(pump) && lastVisible(triangle) && !lastVisible(diagram));
        assert.strictEqual(runtime._infoPage(), 'rangeRemaining', 'fresh low fuel retains numeric BC priority');
        feedMeta({}); feed({ statusDoorSwitchDRD: 1 }); update();
        assert.strictEqual(runtime.warningPresentation().text, 'Door open');
        assert(lastVisible(diagram) && !lastVisible(pump) && lastVisible(triangle));
        assert.strictEqual(runtime._infoPage(), 'rangeRemaining', 'door text does not cancel low-fuel range priority');
        assert(diagram.px.some((v, i) => i % 4 === 3 && v > 128), 'a confirmed mapped opening has real car ink');
        const activeWrites = uploadsFor(diagram), still = total();
        for (let i = 0; i < 120; i++) { now += 16; update(); }
        assert.strictEqual(total(), still, 'stationary door warning does not join the 60 Hz needle upload loop');
        feed({ statusDoorSwitchDRD: 1 }); update(); assert.strictEqual(uploadsFor(diagram), activeWrites, 'duplicate contact packet is silent');

        feed({ statusDoorSwitchDRD: 1, statusContactBonnet: 1 }); update();
        assert.strictEqual(runtime.warningPresentation().text, 'Hood open');
        assert(runtime.warningPresentation().critical);
        assert.strictEqual(runtime.warningPresentation().doorState.frontLeft, 'open', 'higher-priority hood text retains door highlight');
        assert.strictEqual(uploadsFor(diagram), activeWrites + 1, 'one changed closure set uploads the small diagram once');
        const hoodPixels = Buffer.from(diagram.px);
        runtime.f82Light = 'night'; update();
        assert(!hoodPixels.equals(diagram.px), 'night changes small diagram lighting');
        const night = total(); update(); assert.strictEqual(total(), night, 'night lighting stays cached');

        feed({ statusContactBootLid: 1 }); update();
        assert.strictEqual(runtime.warningPresentation().text, 'Boot open');
        assert(!runtime.warningPresentation().critical, 'only evidenced hood message uses critical red');
        feed({ statusContactBootLid2: 1 }); update(); assert.strictEqual(runtime.warningPresentation().text, 'Tailgate open');
        feed({ statusDoorSwitchDRDR: 1 }); update();
        assert.strictEqual(runtime.warningPresentation().kind, 'fuel', 'two-door body ignores phantom rear switch for warning display');
        feedMeta({ typeVehicle: 121, typeBody: 1 }); feed({ statusDoorSwitchDRDR: 1 }); update();
        assert.strictEqual(runtime.warningPresentation().doorState.bodyStyle, 'sedan');
        assert.strictEqual(runtime.warningPresentation().doorState.rearLeft, 'open');
        assert(lastVisible(diagram));
        feedMeta({ typeVehicle: 121, typeBody: 1, typeSteering: 2 }); update();
        assert.strictEqual(runtime.warningPresentation().doorState.rearRight, 'open', 'RHD maps driver side to vehicle right');

        feedMeta({ typeSteering: 15 }); feed({ statusDoorSwitchDRD: 1 }); update();
        assert.strictEqual(runtime.warningPresentation().text, 'Door open');
        assert(!lastVisible(diagram), 'unknown steering retains warning text without a misleading closed-looking diagram');
        assert(lastVisible(triangle));
        settings.f8xSteeringSide = 'lhd'; update(); assert(lastVisible(diagram), 'explicit side override can render known opening');
        settings.f8xSteeringSide = 'auto';
        feed({}); update();
        assert.strictEqual(runtime.warningPresentation().kind, 'fuel', 'closing door restores still-active fuel warning');
        assert(lastVisible(pump) && lastVisible(triangle) && !lastVisible(diagram));
        fuel = { active: false }; update();
        assert.strictEqual(runtime._infoPage(), 'date', 'cleared fuel restores saved page');
        assert(!lastVisible(label) && !lastVisible(pump) && !lastVisible(triangle) && !lastVisible(diagram));

        feedMeta({}); feed({ statusDoorSwitchDRD: 1 }); update();
        fuel = { active: true }; body.available = false; body.change(false); update();
        assert.strictEqual(runtime.warningPresentation().kind, 'fuel', 'door provider loss does not clear independent fuel warning');
        body.available = true; body.change(true); update();
        assert.strictEqual(runtime.warningPresentation().kind, 'fuel', 'reconnect cannot revive old open state');
        feed({ statusDoorSwitchDRD: 3, statusContactBonnet: 2 }); update();
        assert.strictEqual(runtime.warningPresentation().kind, 'fuel', 'invalid contact bits are not truthy openings');

        const beforeUnknown = poses.length;
        fuel = { active: null }; update();
        assert(poses.length > beforeUnknown); assert(!lastVisible(triangle));
        let stopped = 0;
        const cleanup = Object.assign(Object.create(Runtime.prototype), { f82Motion: new Map(), layouts: {},
            car: { stop() {} }, parkingBrake: { stop() {} }, rpmLimit: { stop() {} }, cruise: { stop() {} },
            doors: { stop() { stopped++; } }, clients: [], atlases: new Map() });
        cleanup.stop(); assert.strictEqual(stopped, 1, 'runtime teardown stops door watches');
        console.log('F8X door warning runtime: shared warning ownership, real contact/model/steering decode, priority, no phantom coupe doors, cached Day/Night images, zero idle uploads, independent fuel restoration, unknown/reconnect and unchanged native ownership passed.');
    } finally { tracker.stop(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
