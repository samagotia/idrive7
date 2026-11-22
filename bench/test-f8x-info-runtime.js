'use strict';
// Actual runtime presentation with real data/format trackers; no renderer or car.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const { InfoData } = require('../shared/f8x_info_data');
const { CarFormats, UNITS_FIELD, CLOCK_FIELD } = require('../shared/f8x_car_formats');
const infoFormat = require('../shared/f8x_info_format');
const sprite = require('../shared/f82_sprite');
const fuelWarning = require('../shared/f8x_fuel_warning');
let now = 1000;
const env = {};
const runtimeModule = { exports: {} };
const dependencies = { './f8x_info_data': { InfoData }, './f8x_car_formats': { CarFormats },
    './f8x_info_format': infoFormat, './f82_sprite': sprite, './f8x_fuel_warning': fuelWarning };
vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/f8x_runtime.js'), 'utf8'), {
    module: runtimeModule, Buffer, process: { env, uptime: () => now / 1000 },
    require: (name) => dependencies[name] || {},
}, { filename: 'f8x_runtime.js' });
const Runtime = runtimeModule.exports;
const units = (patch) => Object.assign({ unitOfMeasurementTemperature: 1,
    unitOfMeasurementSpeedometerDigital: 1, unitOfMeasurementTime: 2,
    unitOfMeasurementConsumption: 1, unitOfMeasurementDateExtended: 1 }, patch);
const clock = (patch) => Object.assign({ displayHour: 23, displayMinute: 59, displaySecond: 58,
    displayDateYear: 2024, displayDateMonth: 2, displayDateDay: 29, statusDisplayClockTimeDate: 1 }, patch);
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function run() {
    const watches = {};
    const ctx = { settings: { item: () => null }, log: { info() {} }, signals: {
        watch(iface, instance, handlers) {
            const field = Object.keys(handlers)[0];
            const sub = { available: true, receive: handlers[field], shutdown() {},
                onAvailability(fn) { sub.changed = fn; } };
            watches[field] = sub;
            return Promise.resolve(sub);
        }
    } };
    const carFormats = new CarFormats(ctx, { now: () => now });
    try {
        await tick();
        const settings = { units: 'auto', f82DistanceUnits: 'auto', clock: 'auto',
            f82DateFormat: 'auto', clockSource: 'car', consumptionUnits: 'auto',
            f82DigitalSpeed: true, f82InfoPage: 'outsideTemperature', f82Footer: 'show' };
        const data = new InfoData({ now: () => now });
        const vehicle = { demo: false, speed: 48, rpm: 900 };
        const runtime = Object.assign(Object.create(Runtime.prototype), { ctx, config: {}, infoData: data,
            carFormats, car: { data: () => vehicle }, setting: (key) => settings[key],
            kombiAvailable: true, fuelWarningSample: null, previewTripKm: 70.4,
            f82StartupUntil: null });
        const token = (name) => runtime._token(name);
        watches[UNITS_FIELD].receive(units());
        watches[CLOCK_FIELD].receive(clock());
        data.range({ fluidLevelFuelTank: 32, range: 450, mileageKilometre: 4868 });
        data.ambient({ temperatureExterior: 147 });
        data.travel({ wayPassed: 123, rideDurationHours: 1, rideDurationMinutes: 30 });
        data.average({ consumptionAverage1BC1: 100, statusUnitOfMeasurementConsumptionBC: 1,
            speedAverage1BC1: 842, statusUnitOfMeasurementSpeedBC: 1 });
        assert.strictEqual(token('f82Info'), '+33.5 °C', 'day text preserves measured half degrees');
        assert.strictEqual(token('f82InfoClock'), '', 'digital-speed layout has no duplicate clock by default');
        settings.f82InfoPage = 'time';
        assert.strictEqual(token('f82Info'), '23:59', 'time page reads actual car local HH:MM');
        assert.strictEqual(sprite.infoPage('time', false), 'off', 'fixed clock suppresses a duplicate Time page without digital speed');
        assert.strictEqual(sprite.infoPage('time', true), 'time');
        settings.f82InfoPage = 'averageSpeed';
        assert.strictEqual(token('f82Info'), 'Ø 84.2 km/h');
        settings.f82DistanceUnits = 'us';
        assert.strictEqual(token('f82Info'), 'Ø 52.3 mph');
        settings.f82DistanceUnits = 'auto';
        settings.f82InfoPage = 'date';
        assert.strictEqual(token('f82Info'), '\uE000 29.02.24', 'car date is not the host date');
        watches[UNITS_FIELD].receive(units({ unitOfMeasurementDateExtended: 2 }));
        assert.strictEqual(token('f82Info'), '\uE000 02/29/24', 'automatic date respects car order/separator');
        settings.f82DateFormat = 'YYYY-MM-DD';
        assert.strictEqual(token('f82Info'), '\uE000 2024-02-29', 'explicit date format overrides car preference');
        settings.f82DateFormat = 'auto';
        // A valid time with an unsupported year must not invent a current date.
        watches[CLOCK_FIELD].receive(clock({ displayDateYear: 24 }));
        assert.strictEqual(token('f82Info'), '\uE000 --');
        settings.f82InfoPage = 'time'; assert.strictEqual(token('f82Info'), '23:59');
        watches[CLOCK_FIELD].receive(clock());
        watches[UNITS_FIELD].receive(units({ unitOfMeasurementTemperature: 2, unitOfMeasurementTime: 1 }));
        settings.f82InfoPage = 'outsideTemperature'; assert.strictEqual(token('f82Info'), '+92 °F');
        settings.f82InfoPage = 'time'; assert.strictEqual(token('f82Info'), '11:59 pm');
        settings.f82InfoPage = 'fuelConsumption';
        assert.strictEqual(token('f82InfoClock'), '11:59 pm');
        assert.strictEqual(token('f82Info'), '\uE001 10.0 l/100km');
        watches[UNITS_FIELD].receive(units({ unitOfMeasurementConsumption: 2 }));
        assert.strictEqual(token('f82Info'), '\uE001 28.2 mpg', 'UK gallon conversion');
        watches[UNITS_FIELD].receive(units({ unitOfMeasurementConsumption: 3 }));
        assert.strictEqual(token('f82Info'), '\uE001 23.5 mpg', 'US gallons must stay distinct');
        settings.consumptionUnits = 'km/l';
        assert.strictEqual(token('f82Info'), '\uE001 10.0 km/l');
        settings.consumptionUnits = 'auto';
        // Actual average sentinels must never appear as plausible409.5 readings.
        data.average({ consumptionAverage1BC1: 4095, statusUnitOfMeasurementConsumptionBC: 1,
            speedAverage1BC1: 4095, statusUnitOfMeasurementSpeedBC: 1 });
        assert.strictEqual(token('f82Info'), '\uE001 --');
        settings.f82InfoPage = 'averageSpeed'; assert.strictEqual(token('f82Info'), 'Ø -- km/h');
        assert.strictEqual(token('f82Odometer'), '04868', 'factory leading zero width');
        assert.strictEqual(token('f82TripDistance'), '--', 'travel wayPassed is not a verified factory trip');
        env.M4_PREVIEW_ONLY = '1';
        assert.strictEqual(token('f82TripDistance'), '070.4', 'explicit Mac fixture may populate trip');
        env.M4_PREVIEW_ONLY = '0'; assert.strictEqual(token('f82TripDistance'), '--');
        settings.f82DistanceUnits = 'us';
        assert.strictEqual(token('f82FooterUnit'), 'mi');
        assert.strictEqual(token('f82Odometer'), '03025');
        env.M4_PREVIEW_ONLY = '1'; assert.strictEqual(token('f82TripDistance'), '043.7');
        delete env.M4_PREVIEW_ONLY; settings.f82DistanceUnits = 'auto';
        settings.f82Footer = 'off';
        ['f82Odometer', 'f82TripDistance', 'f82FooterUnit', 'f82FooterRule'].forEach((name) => assert.strictEqual(token(name), ''));
        settings.f82Footer = 'startup'; runtime.f82StartupUntil = now / 1000 + 15;
        assert.strictEqual(token('f82Odometer'), '04868');
        now += 15000; assert.strictEqual(token('f82Odometer'), '', 'startup footer expires at15s');
        settings.f82Footer = 'show';
        // Refresh independent channels before the low-fuel priority scenario.
        watches[UNITS_FIELD].receive(units()); watches[CLOCK_FIELD].receive(clock());
        data.range({ fluidLevelFuelTank: 4, range: 50, mileageKilometre: 4868 });
        settings.f82InfoPage = 'date';
        runtime.fuelWarningSample = { reserve: 3, rangeKm: 50, at: now };
        assert.strictEqual(token('f82Info'), '\uE003\uE001 50 km', 'low range temporarily overrides date');
        assert.strictEqual(settings.f82InfoPage, 'date', 'warning never rewrites the user page');
        runtime.fuelWarningSample = { reserve: 0, rangeKm: 50, at: now };
        assert.strictEqual(token('f82Info'), '\uE000 29.02.24', 'explicit BMW reserveclear restores date');
        runtime.fuelWarningSample = { reserve: 1, rangeKm: 50, at: now };
        assert.strictEqual(runtime._infoPage(), 'rangeRemaining');
        runtime.kombiAvailable = false; data.availability('kombi', false);
        assert.strictEqual(runtime._infoPage(), 'date', 'provider loss clears warningpriority');
        assert.strictEqual(token('f82Odometer'), '--', 'provider loss does not preserve mileage');
        settings.f82InfoPage = 'rangeRemaining'; assert.strictEqual(token('f82Info'), '\uE003\uE001 --');
        data.range({ range: 51, mileageKilometre: 4868 });
        assert.strictEqual(token('f82Info'), '\uE003\uE001 --', 'late callback after loss cannot resurrect display');
        data.availability('kombi', true); runtime.kombiAvailable = true; runtime.fuelWarningSample = null;
        assert.strictEqual(token('f82Info'), '\uE003\uE001 --', 'reconnect awaits a new sample');
        data.range({ range: 51, mileageKilometre: 4868 });
        assert.strictEqual(token('f82Info'), '\uE003\uE001 51 km');
        data.average({ consumptionAverage1BC1: 100, statusUnitOfMeasurementConsumptionBC: 1,
            speedAverage1BC1: 842, statusUnitOfMeasurementSpeedBC: 1 });
        data.ambient({ temperatureExterior: 147 });
        now += 5000;
        settings.f82InfoPage = 'outsideTemperature'; assert.strictEqual(token('f82Info'), '--', 'stale ambient has no synthetic temperature');
        settings.f82InfoPage = 'time'; assert.strictEqual(token('f82Info'), '--', 'stale car clock has no host-time fallback');
        settings.f82InfoPage = 'date'; assert.strictEqual(token('f82Info'), '\uE000 --');
        now += 20000;
        settings.f82InfoPage = 'averageSpeed'; assert.strictEqual(token('f82Info'), 'Ø -- km/h');
        settings.f82InfoPage = 'fuelConsumption'; assert.strictEqual(token('f82Info'), '\uE001 --');
        settings.f82InfoPage = 'rangeRemaining'; assert.strictEqual(token('f82Info'), '\uE003\uE001 --');
        assert.strictEqual(token('f82Odometer'), '--');
        assert.strictEqual(vehicle.demo, false, 'all scenarios use live-mode behavior');
        console.log('F8X info runtime: real decoded car date/time/units, half degrees, average pages, invalid/stale/provider-loss handling, fuel priority restoration and honest padded footer passed.');
    } finally { carFormats.stop(); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
