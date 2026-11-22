'use strict';
/**
 * Bench launcher: runs the BUILT app (dist/<id>, made by tools/build_clusters.py, the
 * same build the Store runs on the car) inside the kit's stubbed head unit (kit/tools/hu-stub.js,
 * live mode). No BMW SDK, no SOME/IP:
 *
 *  - The center-screen page is hu-stub's fake RHMI. A setting from the bench panel is sent the way
 *    the car's HMI sends it: an 'action' on the SET_<KEY> component (the drop-down's row, or a
 *    checkbox press), so the kit's own wireSettings() handles it and saves bench/.data/<id>/settings.json.
 *  - The status row (ctx.ui.text('STATUS', ...)) is reported to the page.
 *  - Manual signals go in as RAW SOME/IP values through hu.feed, the scaling car.js undoes on the
 *    car. Demo mode uses the bench-injected simulator (the "demo" setting).
 *  - HUD_CLUSTER_SOCKET points f8x_runtime.js at the bench's fake cluster-render socket.
 *
 * Run by bench/server.js as a forked child: node bench/run-app.js <stage dir> <data dir>
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const stage = process.argv[2], dataDir = process.argv[3];
if (!stage || !dataDir) { console.error('usage: run-app.js <dist/<id>> <data dir>'); process.exit(2); }

const send = (m) => { if (process.connected) process.send(m); };
const fmt = (a) => a.map((x) => (x && x.stack) ? x.stack : (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
const tag = '[' + path.basename(stage) + '] ';
const log = {
    info: (...a) => console.log(tag + fmt(a)),
    warn: (...a) => console.warn(tag + 'WARN ' + fmt(a)),
    error: (...a) => console.warn(tag + 'ERROR ' + fmt(a)),
    debug: () => {},
};
// As on the car, an uncaught exception ends the app (kit/mgu.js): the bench shows the exit.
process.on('uncaughtException', (e) => { log.error('uncaught (the car would exit the app here): ' + (e && e.stack || e)); process.exit(1); });
// This process belongs to the Mac preview server. Do not leave a second
// renderer client alive if its parent is restarted or closes unexpectedly.
process.once('disconnect', () => process.exit(0));

try { fs.mkdirSync(dataDir); } catch (e) { /* there */ }
const { headUnit } = require(path.join(__dirname, '..', 'kit', 'tools', 'hu-stub.js'));
const hu = headUnit(stage, { live: true, dataDir, log, image: () => Promise.resolve() });
const { spec, settings, ui } = hu;
if (spec.id === 'samagotia_clusters') {
    const designs = settings.item('hudLayout').options;
    if (!designs.some(([id]) => id === settings.get('hudLayout')) || settings.get('hudLayout') === 'off') {
        settings.set('hudLayout', designs.find(([id]) => id !== 'off')[0]);
    }
}

// the app's HudApp instance, for the values the page shows (f8x_runtime.js is loaded by the app's main.js)
let hud = null;
const realLoad = Module._load;
Module._load = function (req) {
    const m = realLoad.apply(this, arguments);
    if ((req === './f8x_runtime' || req === './hud') && typeof m === 'function' && !m.__bench) {
        // the status line: the engine's own (the page shows it on its Settings tab; there is no STATUS row any more)
        const Wrapped = class extends m { constructor(ctx) { super(ctx); hud = this; this.onStatus((s) => { status = s; send({ t: 'status', s }); }); } };
        Wrapped.__bench = true;
        return Wrapped;
    }
    return m;
};

// the center screen's status row
let status = '';
const text = ui.text;
ui.text = (n, t, row, cell) => {
    if (n === 'STATUS' && !row) { status = String(t); send({ t: 'status', s: status }); }
    return text(n, t, row, cell);
};

const sendSettings = () => send({ t: 'settings', schema: spec.settings, values: Object.assign({}, settings.values) });
settings.onChange(sendSettings);

/** A setting from the panel, pressed on the fake HMI as the car's HMI would. */
function press(key, value) {
    const s = settings.item(key);
    if (!s) return log.warn('bench: no setting ' + key);
    if (s.hidden) {
        settings.set(key, value);
        return;
    }
    const comp = ui.comp('SET_' + key.toUpperCase());
    if (s.type === 'bool') {
        if (!!settings.get(key) !== !!value) comp.emit('action', {});      // a checkbox press toggles
        return;
    }
    const rows = s.type === 'choice' ? s.options.map((o) => o[0]) : s.steps;
    const row = rows.indexOf(value);
    if (row < 0) return log.warn('bench: ' + key + ' has no value ' + JSON.stringify(value));
    comp.emit('action', { row });
}

// Manual signals are raw SOME/IP values, matching f8x_vehicle.js SCALE.
const SCALE = { rpm: [0.25, 0], speed: [0.015625, 0], temp: [1, -48] };
const raw = (k, v) => Math.round((v - SCALE[k][1]) / SCALE[k][0]);
let mode = 'demo', manual = {};
const num = (k, d) => typeof manual[k] === 'number' && isFinite(manual[k]) ? manual[k] : d;

function feedTripComputer() {
    const kombi = 'de.bmw.infotainment.KombiIF';
    const miles = settings.get('f82DistanceUnits') === 'us';
    // Car-shaped fixtures, explicitly simulated by this Mac test bench.
    const date = new Date();
    hu.feed('de.bmw.infotainment.vehicle.Vehicle', 'statusNewCurrentUnitsStatusExt', {
        unitOfMeasurementTemperature: manual.carTemperatureUnit || 1,
        unitOfMeasurementSpeedometerDigital: manual.carDistanceUnit || 1,
        unitOfMeasurementTime: manual.carClockFormat || 2,
        unitOfMeasurementDateExtended: manual.carDateFormat || 1,
        unitOfMeasurementConsumption: manual.consumptionUnit || (miles ? 3 : 1),
    });
    hu.feed(kombi, 'statusShowTimeDate', { statusDisplayClockTimeDate: 1,
        displayHour: date.getHours(), displayMinute: date.getMinutes(), displaySecond: date.getSeconds(),
        displayDateDay: date.getDate(), displayDateMonth: date.getMonth() + 1, displayDateYear: date.getFullYear() });
    if (hud) hud.previewTripKm = num('tripKm', 370);
    hu.feed('de.bmw.infrastructure.EnvironmentalInformation', 'ExteriorTemperature', { temperatureExterior: Math.round((num('ambient', 22.5) + 40) * 2) });
    hu.feed(kombi, 'statusRangeTankStatus', {
        fluidLevelFuelTank: Math.round(num('fuelL', 40)),
        range: Math.round(num('range', 450)),
        statusFluidLevelFuelTankSpare: mode === 'manual'
            ? (manual.fuelReserve === 'inactive' ? 0 : manual.fuelReserve === 'active' ? 1 : 3) : 3,
        mileageKilometre: Math.round(num('odometerKm', 65460)),
    });
    hu.feed(kombi, 'statusBordcomputerTravelData', { wayPassed: Math.round(num('travelKm', 180)), rideDurationHours: 2, rideDurationMinutes: 15 });
    hu.feed(kombi, 'statusBordcomputerAverage', {
        speedAverage1BC1: Math.round(num('averageSpeed', 68.5) * 10),
        statusUnitOfMeasurementSpeedBC: 1,
        consumptionAverage1BC1: Math.round(num('averageConsumption', miles ? 19.6 : 12.0) * 10),
        statusUnitOfMeasurementConsumptionBC: (manual.consumptionUnit === undefined || manual.consumptionUnit === null ? (miles ? 3 : 1) : manual.consumptionUnit),
    });
}

let lastDoorPacket = null;
function feedDoors() {
    const iface = 'de.bmw.body.DoorsWindowsRoofMirrors';
    const fixture = mode === 'manual' ? manual : {};
    const model = fixture.doorModel || 'G82';
    const modelValue = { G82: 122, G80: 121, G05: 83 }[model] || 0;
    hu.feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusVehiclePartType', {
        typeVehicle: modelValue, typeBody: model === 'G82' ? 2 : model === 'G80' ? 1 : model === 'G05' ? 33 : 255,
        typeSteering: fixture.doorSteering === 'rhd' ? 2 : fixture.doorSteering === 'unknown' ? 15 : 1 });
    const wire = (key) => fixture[key] === 'open' ? 1 : fixture[key] === 'unknown' ? 3 : 0;
    const packet = { statusDoorSwitchDRD: wire('doorDriverFront'), statusDoorSwitchPSD: wire('doorPassengerFront'),
        statusDoorSwitchDRDR: wire('doorDriverRear'), statusDoorSwitchPSDR: wire('doorPassengerRear'),
        statusContactBonnet: wire('doorBonnet'), statusContactBootLid: wire('doorBoot'), statusContactBootLid2: wire('doorBoot2') };
    const available = fixture.doorProvider !== 'unavailable';
    const key = JSON.stringify([packet, available]);
    // Model change-driven closures. Retry the initial fixture until the app has
    // subscribed; unchanged open contacts are not treated as expired RPM feeds.
    const waiting = hud && hud.doors && !hud.doors.value().source;
    if (key === lastDoorPacket && (!available || !waiting)) return;
    lastDoorPacket = key;
    hu.feed(iface, 'CentralLockingSystemAndPanelStatus2', packet, available);
}

function feedCruise() {
    const state = mode === 'manual' ? manual.cruiseState : 'off';
    const on = state === 'active' || state === 'standby';
    hu.feed('de.bmw.infotainment.displaydata.DisplayDataServer2', 'functionalLibraryData', {
        ldmIconId: on ? 3 : 0,
        ldmIconState: state === 'active' ? 2 : state === 'standby' ? 1 : 0,
        ldmSetSpeed: { ldmSetSpeedValue: Math.round(num('cruiseSpeed', 100)),
            ldmSetSpeedColour: state === 'active' ? 1 : state === 'standby' ? 2 : 0 },
        speed: { unitFirstSpeed: manual.cruiseUnit === 'mph' ? 2 : 1 },
    });
}

function feedManual() {
    if (mode !== 'manual') return;
    const v = manual;
    const g = Math.round(num('gear', 0));
    const selector = ['P', 'R', 'N', 'D', 'M'].indexOf(v.selector) >= 0 ? v.selector : (g > 0 ? 'D' : 'P');
    const stage = selector === 'M' ? 'D' : selector;
    const program = selector === 'M' ? 'M' : (v.program || 'D');
    const gear = stage === 'R' ? 'R' : stage === 'D' && g > 0 ? 'G' + g : 'N_OR_P';
    hu.feed('de.bmw.infrastructure.VehicleCondition', 'VehicleCondition', { statusConditionVehicle: v.driveReady === true ? 'FAHREN' : 'WOHNEN' });
    hu.feed('de.bmw.powertrain.AcceleratorPedal', 'AngleAcceleratorPedal', {
        actualValueAngleAcceleratorPedal: v.pedal === null ? 65535 : Math.round(num('pedal', 0) / 0.025),
    });
    feedCruise();
    hu.feed('de.bmw.infotainment.vehicle.CDS', 'statusEngineSpeed2', { actualValueRPMEngineCrankshaft: raw('rpm', num('rpm', 0)) });
    hu.feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', { speedVehicleCentreOfGravity: raw('speed', num('speed', 0)) });
    hu.feed('de.bmw.infotainment.vehicle.CDS', 'statusEngineTemperature', { temperatureEngineDrive: raw('temp', num('coolant', 90)), temperatureEngineOilDrive: raw('temp', num('oil', 100)) });
    hu.feed('de.bmw.infrastructure.VehicleInformation', 'statusGearboxDrive', { statusActualGearDrive: gear, statusActualStageDrive: stage });
    hu.feed('de.bmw.infrastructure.VehicleInformation', 'DataPowerTrain2CRC', {
        rPMEngineMaximumAllowed: Math.round(num('maxRpm', 7200) / 50),
        reductionDownControlRPMDrive2: 0,
    });
    hu.feed('de.bmw.infrastructure.EnvironmentalInformation', 'ExteriorTemperature', { temperatureExterior: Math.round((num('ambient', 22) + 40) / 0.5) });
    hu.feed('de.bmw.infotainment.misc.MDrive', 'dataDisplayGearbox', { displayProgramGearbox: program === 'S' ? 'S_MINUS_PROGRAMM' : program === 'M' ? 'M_MINUS_PROGRAMM' : 'D_PROGRAMM' });
}
setInterval(feedManual, 50);
setInterval(feedTripComputer, 1000);
setInterval(feedDoors, 1000);
setInterval(feedCruise, 1000);

// what the app actually sees, so the page shows demo values too
setInterval(() => {
    if (!hud) return;
    const d = hud.car.data(), out = {};
    ['rpm', 'speed', 'oil', 'coolant', 'gear'].forEach((n) => { out[n] = d[n] === undefined ? null : d[n]; });
    out.pedal = hud._f82PedalPercent(d, Date.now());
    out.maxRpm = mode === 'manual' ? num('maxRpm', 7200) : hud._f82ShiftLimit(d.oil);
    out.driveReady = mode === 'manual' && manual.driveReady === true;
    out.selector = mode === 'manual' ? manual.selector : '';
    out.cruiseState = mode === 'manual' ? (manual.cruiseState || 'off') : 'off';
    out.cruiseUnit = manual.cruiseUnit || 'kmh';
    out.cruiseSpeed = num('cruiseSpeed', 100);
    out.turnSignal = mode === 'manual' ? (manual.turnSignal || 'off') : 'off';
    out.fuelL = hud.infoData.value('fuelL'); out.range = hud.infoData.value('rangeKm'); out.ambient = hud.infoData.value('ambientC');
    out.fuelReserve = mode === 'manual' ? (manual.fuelReserve || 'unknown') : 'unknown';
    ['doorDriverFront','doorPassengerFront','doorDriverRear','doorPassengerRear','doorBonnet','doorBoot','doorBoot2'].forEach((key) => { out[key] = mode === 'manual' ? manual[key] || 'closed' : 'closed'; });
    out.doorModel = manual.doorModel || 'G82'; out.doorSteering = manual.doorSteering || 'lhd'; out.doorProvider = manual.doorProvider || 'available';
    send({ t: 'values', mode, values: out, limitStatus: hud.rpmLimitStatus(), fuelWarning: hud.fuelWarningState(), infoStatus: hud.infoStatus(), carFormats: hud.carFormats.value(), doorStatus: hud.doorStatusText(), doorSnapshot: hud.doors.value() });
}, 250);

process.on('message', (m) => {
    if (!m) return;
    if (m.t === 'signals') {
        mode = m.mode === 'manual' ? 'manual' : 'demo';
        manual = m.values || {};
        // demo drive = the kit's sim; manual = live data (auto: the sim gives way once data arrives)
        const want = mode === 'manual' ? 'off' : 'on';
        if (settings.get('demo') !== want) press('demo', want);
        const indicator = mode === 'manual' ? { left: 3, right: 4, both: 8 }[manual.turnSignal] : 0;
        hu.feed('de.bmw.body.Light', 'StatusFunctionsIndicators2', { controlIndicateDirection: indicator || 0 });
            feedCruise();
        feedManual();
        feedTripComputer();
        feedDoors();
    } else if (m.t === 'set') {
        press(m.key, m.value);
        if (m.key === 'f82DistanceUnits') feedTripComputer();
    }
    else if (m.t === 'lighting') {
        hu.feed('de.bmw.infotainment.vehicle.Vehicle', 'statusDayNightChangeOver',
            { dayNightChangeOver: m.value === 'night' ? 'NACHT' : 'TAG' });
    }
    else if (m.t === 'f82Engine' && hud) hud.setPreviewF82Engine(m.value);
    else if (m.t === 'shiftTest' && hud) hud.testShift();
});
process.on('disconnect', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Simulation is a Mac bench dependency; it is never imported by the car runtime.
if (process.env.M4_PREVIEW_ONLY === '1') hu.ctx.simulator = new (require('../kit/runtime/sim'))();
hu.start();
sendSettings();
log.info('bench: app loaded from ' + path.relative(process.cwd(), stage) + ', data in ' + dataDir);
