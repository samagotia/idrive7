'use strict';

// Run after python3 tools/build_clusters.py --stage-only, or pass an extracted release stage.
// Exercise the staged runtime, with only the head-unit providers and renderer transport simulated.
const assert = require('assert').strict;
const EventEmitter = require('events');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { headUnit } = require('../kit/tools/hu-stub');

const stage = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../dist/samagotia_clusters');
const runtime = path.join(stage, 'source/javascript');
const HudApp = require(path.join(runtime, 'f8x_runtime'));
const { SIGNALS } = require(path.join(runtime, 'f8x_vehicle'));
const signalFields = {
    speed: 'speedVehicleCentreOfGravity',
    rpm: 'actualValueRPMEngineCrankshaft',
};
const providers = new Map();

class Provider {
    constructor() {
        this.available = true;
        this.handlers = new Map();
        this.values = new Map();
        this.reads = new Map();
    }
    async init() {}
    async subscribeToAvailability(fn) { this.onAvailability = fn; fn(this.available); }
    async subscribe({ name, onReceive }) { this.handlers.set(name, onReceive); }
    isAvailable() { return this.available; }
    async getValue(field, timeoutMs) {
        assert.equal(timeoutMs, 500);
        this.reads.set(field, (this.reads.get(field) || 0) + 1);
        if (!this.values.has(field)) throw new Error('simulated getter timeout');
        const sample = this.values.get(field);
        if (this.readGate) await this.readGate;
        return sample;
    }
    setAvailable(available) { this.available = available; this.onAvailability(available); }
}

function simulatedSignals() {
    const filename = path.join(runtime, 'kit/signals.js');
    const source = fs.readFileSync(filename, 'utf8');
    const sdk = { async buildProxy({ iface }) {
        const provider = new Provider();
        if (!providers.has(iface)) providers.set(iface, []);
        providers.get(iface).push(provider);
        return provider;
    } };
    const configFs = { readFileSync(file) {
        const iface = path.basename(file, '.json').replace(/_/g, '.');
        const fields = {};
        Object.keys(signalFields).forEach((key) => {
            const [service, field] = SIGNALS[key];
            if (service === iface) fields[field] = { getter: true };
        });
        return JSON.stringify({ iface, fields });
    } };
    const imports = { someip: sdk, fs: configFs, path };
    const load = vm.runInThisContext('(function (require, module, __dirname) {\n' + source + '\n})', { filename });
    const module = { exports: {} };
    load((name) => imports[name], module, path.dirname(filename));
    return module.exports;
}

class RenderSocket extends EventEmitter {
    constructor() {
        super();
        this.layers = new Set();
        this.created = 0;
        this.closed = false;
        setImmediate(() => this.emit('connect'));
    }
    write(bytes) {
        if (bytes[4] !== 0x4a) return true;
        const op = JSON.parse(bytes.slice(5).toString('utf8'));
        if (op.op === 'hello') {
            const hello = Buffer.from(JSON.stringify({ ev: 'hello', backend: process.env.F8X_TEST_BACKEND || 'bench' }));
            const frame = Buffer.alloc(5 + hello.length);
            frame.writeUInt32LE(hello.length + 1, 0);
            frame[4] = 0x4a;
            hello.copy(frame, 5);
            setImmediate(() => this.emit('data', frame));
        } else if (op.op === 'layer') {
            assert.equal(op.target, 'panel');
            this.layers.add(op.ref);
            this.created++;
        } else if (op.op === 'drop') this.layers.delete(op.ref);
        return true;
    }
    destroy() {
        if (this.closed) return;
        this.closed = true;
        this.layers.clear();
        setImmediate(() => this.emit('close'));
    }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, message) {
    const deadline = Date.now() + 4000;
    while (!condition()) {
        assert(Date.now() < deadline, message);
        await delay(15);
    }
}

async function run() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f8x-parked-test-'));
    process.env.SCREEN_DIR = path.join(dataDir, 'screen');
    process.env.HUD_CLUSTER_SOCKET = path.join(dataDir, 'render.sock');
    delete process.env.M4_PREVIEW_ONLY;
    const sockets = [];
    const connect = net.connect;
    net.connect = (socketPath) => {
        assert.equal(socketPath, process.env.HUD_CLUSTER_SOCKET);
        const socket = new RenderSocket();
        sockets.push(socket);
        return socket;
    };
    const hasLayers = () => sockets.some((s) => s.layers.size > 0);
    let hud;
    try {
        const hu = headUnit(stage, { live: true, dataDir, image: async () => {},
            sets: { hudLayout: 'our_m4', demo: 'on',
                // Settings left by an older release must not restore duplicates.
                f8xBrakeStyle: 'icon', f8xTurnIndicators: 'f8x' },
            log: { info() {}, warn() {}, debug() {}, error: (msg) => { throw new Error(msg); } } });
        const { settings, spec } = hu;
        assert.equal(spec.id, 'samagotia_clusters');
        assert.equal(spec.config.parkedTest, true);
        assert(!spec.settings.some((item) => item.key === 'byMode'));
        assert(!fs.existsSync(path.join(runtime, 'hud.js')));
        assert(!fs.existsSync(path.join(runtime, 'kit/car.js')));
        assert(!fs.existsSync(path.join(runtime, 'kit/sim.js')));
        assert.equal(settings.item('hudLayout').default, 'off');
        assert.equal(settings.item('demo').default, 'off');
        hu.ctx.signals = simulatedSignals();
        // The test doesn't edit layout files. Some sandboxed Macs cannot allocate a filesystem watcher.
        const watch = fs.watch;
        fs.watch = () => {};
        try { hud = new HudApp(hu.ctx); } finally { fs.watch = watch; }
        hud.start();
        await until(() => hud.client.ready && hud.activeName === 'off', 'start on BMW cluster');
        assert.equal(settings.get('hudLayout'), 'off');
        assert.equal(settings.get('demo'), 'off');
        assert(!hasLayers());
        settings.set('demo', 'on');
        assert.equal(settings.get('demo'), 'off');
        assert.equal(hud.testShift(), false);
        const select = () => settings.set('hudLayout', 'our_m4');
        select();
        assert.equal(settings.get('hudLayout'), 'off');
        assert(!hasLayers());

        function input(key) {
            const [iface, field] = SIGNALS[key];
            const provider = providers.get(iface).find((candidate) => candidate.handlers.has(field));
            assert(provider, 'critical field subscribed: ' + field);
            return { field, provider, set: (value) => {
                provider.values.set(field, { [signalFields[key]]: value });
            } };
        }
        await until(() => Object.keys(signalFields).every((key) =>
            hud.car.subs.some((s) => s.iface === SIGNALS[key][0])), 'signal providers');
        const speed = input('speed'), rpm = input('rpm');
        const ready = () => hud.car.missingCriticalSignal(1500) === null;
        const active = () => hud.activeName === 'our_m4' && hasLayers();
        const stock = () => hud.activeName === 'off' && !hasLayers() && settings.get('hudLayout') === 'off';
        speed.set(0);
        await until(() => hud.car.data().speed === 0, 'speed zero received');
        select();
        assert(stock(), 'one live input is insufficient');
        rpm.set(0);
        await until(ready, 'both zero values confirmed by getters');
        select();
        assert(active());
        const underlay = Array.from(hud.widgets.values()).find((x) => x.w.type === 'f8xpanel');
        assert(underlay, 'F8X includes an opaque floor before background image upload');
        const underlayLayer = underlay.c.layers.get(underlay.ref);
        assert.equal(underlayLayer.kind, 'effect', 'the opaque floor requires no image upload');
        assert.deepEqual([underlayLayer.opts.x, underlayLayer.opts.y, underlayLayer.opts.w, underlayLayer.opts.h], [0, 0, 1920, 646]);
        assert.equal(underlayLayer.opts.klass, 'ambient');
        assert.equal(underlayLayer.opts.z, -1);
        assert(!underlayLayer.opts.exclusive, 'native BMW warnings retain priority');
        const produced = Array.from(hud.widgets.values()).map((x) => x.w);
        assert(!produced.some((w) => w.indicator || w.warning === 'parkingBrake'
            || w.icon === 'parkingBrake' || w.icon === 'turnLeft' || w.icon === 'turnRight'
            || w.text === 'BRAKE' || w.cruiseRole === 'symbol'
            || w.icon === 'cruise' || w.warningRole === 'attentionTriangle'),
        'actual F8X composition never recreates stock status telltales, even with legacy preferences');
        for (const id of ['gear_selector', 'f8x_cruise_marker', 'f8x_fuel_reserve_text', 'f8x_fuel_reserve_icon']) {
            assert(produced.some((w) => w.id === id), 'retain covered base-panel information: ' + id);
        }
        assert(produced.some((w) => w.doorRole), 'retain live opening diagram');
        assert(produced.some((w) => w.gearRecommendation), 'retain sequential shift recommendation');
        const gaugeIds = ['speed_face', 'speed_needle', 'rpm_face', 'rpm_needle', 'fuel_face', 'fuel_needle', 'oil_face', 'oil_needle'];
        const dialGeometry = () => gaugeIds.map((id) => {
            const w = hud.widgets.get(id).w;
            return [id, w.x, w.y, w.w, w.h, w.pivot];
        });
        const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '../apps/samagotia_clusters/cluster/layouts/our_m4.json')));
        const originalGeometry = gaugeIds.map((id) => {
            const w = bundled.widgets.find((w) => w.id === id);
            return [id, w.x, w.y, w.w, w.h, w.pivot];
        });
        assert.deepEqual(dialGeometry(), originalGeometry, 'every dial and blade keeps its exact shipped size, position and pivot');
        const assertStripClear = () => {
            for (const socket of hud.clients) for (const layer of socket.layers.values()) {
                if (layer.kind === 'asset') continue;
                assert(layer.opts.y + layer.opts.h <= 646, 'every actual drawable ends above BMW strip, even when hidden');
            }
            assert(!hud.widgets.has('f82_odometer') && !hud.widgets.has('f82_footer_rule'), 'no empty footer rectangles cover BMW strip');
            const bg = hud.widgets.get('backdrop'), wireLayer = bg.c.layers.get(bg.ref);
            assert.equal(wireLayer.ih, 258);
            assert.equal(wireLayer.opts.h, 645, 'crop complete source rows at original scale');
            const source = hud._f82Asset('background');
            assert(wireLayer.image.equals(Buffer.from(source.rgba, 'base64').slice(0, source.w * 258 * 4)),
                'Day background is the exact original pixel prefix, never a squashed full image');
        };
        assertStripClear();
        settings.set('f8xNativeBottomStrip', false);
        assert.equal(hud.widgets.get('f8x_panel_underlay').w.h, 720);
        assert(hud.widgets.has('f82_odometer'), 'Off restores the original footer for parked comparison');
        assert.equal(hud.widgets.get('backdrop').w.sourceRows, undefined);
        assert.deepEqual(dialGeometry(), originalGeometry, 'comparison toggle does not change dial geometry');
        settings.set('f8xNativeBottomStrip', true);
        assertStripClear();
        assert.deepEqual(dialGeometry(), originalGeometry);
        await delay(1650);
        assert(active(), 'quiet but readable zero values keep F8X active');
        assert.equal(hud.car.data().demo, false);
        if (process.env.F8X_TEST_BACKEND) {
            const needle = hud.f82Needles.find((x) => x.w.id === 'rpm_needle');
            const before = hud.client.layers.get(needle.ref).opts.rotate;
            rpm.set(4000);
            await until(() => hud.client.layers.get(needle.ref).opts.rotate !== before,
                'native GPU RPM pose responds before dropout tests');
            assert(hud.f82Motion.size > 0, 'short resident-pose motion is exercised');
            assert(Array.from(hud.client.layers.values()).every((layer) => layer.anims.size === 0),
                'needle movement avoids native animation-system replacements');
        }

        for (const [key, source] of [['speed', speed], ['RPM', rpm]]) {
            source.provider.values.delete(source.field);
            await until(stock, key + ' timeout releases every drawable layer');
            assert(hud.statusText().includes('no fresh ' + key));
            source.set(0);
            await until(ready, key + ' resumed');
            assert(stock(), 'restored samples require reselecting F8X');
            select();
            assert(active());
        }
        // A delayed getter must not overwrite a newer invalid notification.
        const readsBefore = rpm.provider.reads.get(rpm.field);
        let finishRead;
        rpm.provider.readGate = new Promise((resolve) => { finishRead = resolve; });
        await until(() => rpm.provider.reads.get(rpm.field) > readsBefore, 'RPM getter pending');
        rpm.provider.handlers.get(rpm.field)({ [signalFields.rpm]: 65535 });
        rpm.set(65535);
        rpm.provider.readGate = null;
        finishRead();
        await delay(15);
        assert.equal(hud.car.missingCriticalSignal(1500), 'rpm');
        await until(stock, 'invalid RPM forces stock');
        rpm.set(0);
        await until(ready, 'valid RPM restored');
        select();
        speed.provider.setAvailable(false);
        await until(stock, 'speed provider loss forces stock');
        speed.provider.setAvailable(true);
        await until(ready, 'speed provider restored');
        select();
        assert(active());

        const count = sockets.length;
        sockets[count - 1].destroy();
        await until(stock, 'renderer disconnect returns to stock');
        await until(() => sockets.length > count && hud.client.ready, 'renderer reconnected');
        assert.equal(sockets[count].created, 0, 'custom layers must never replay after a renderer disconnect');
        select();
        assert(active());
        settings.set('hudLayout', 'off');
        assert(stock(), 'manual Off releases every drawable layer');
        console.log('Passed: stock startup, no demo, valid stationary zeros, independent signal timeouts, invalid RPM, provider loss, renderer reconnect, and manual Off.');
    } finally {
        if (hud) hud.stop();
        net.connect = connect;
        fs.rmSync(dataDir, { recursive: true, force: true });
    }
}

run().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
