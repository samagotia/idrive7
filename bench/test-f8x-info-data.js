'use strict';
const assert = require('assert');
const InfoData = require('../shared/f8x_info_data').InfoData;
let now = 1000;
const data = new InfoData({ now: function () { return now; } });
const range = { fluidLevelFuelTank: 32, range: 450, mileageKilometre: 65440 };
const average = { consumptionAverage1BC1: 98, statusUnitOfMeasurementConsumptionBC: 1,
    speedAverage1BC1: 463, statusUnitOfMeasurementSpeedBC: 1 };
assert.strictEqual(data.value('rangeKm'), null);
data.range(range);
data.average(average);
data.travel({ wayPassed: 63, rideDurationHours: 1, rideDurationMinutes: 12 });
data.ambient({ temperatureExterior: 147 });
assert.strictEqual(data.value('fuelL'), 32);
assert.strictEqual(data.value('rangeKm'), 450);
assert.strictEqual(data.value('odometerKm'), 65440);
assert.deepStrictEqual(data.value('averageConsumption'), { value: 9.8, unit: 'l/100km' });
assert.strictEqual(data.value('averageSpeedKmh'), 46.3);
assert.strictEqual(data.value('travelDistanceKm'), 63);
assert.strictEqual(data.value('rideDurationHours'), 1);
assert.strictEqual(data.value('rideDurationMinutes'), 12);
assert.strictEqual(data.value('ambientC'), 33.5, 'half degrees survive decoding');

const units = [[1, 'VERBRAUCH_IN_L_S_100KM', 'l/100km'], [2, 'VERBRAUCH_IN_MPG_UK', 'mpg_uk'],
    [3, 'VERBRAUCH_IN_MPG_US', 'mpg_us'], [4, 'VERBRAUCH_IN_KM_S_L', 'km/l']];
units.forEach(function (row) {
    row.slice(0, 2).forEach(function (unit) {
        data.average(Object.assign({}, average, { statusUnitOfMeasurementConsumptionBC: unit }));
        assert.deepStrictEqual(data.value('averageConsumption'), { value: 9.8, unit: row[2] });
    });
});
[2, 'MPH__MLS'].forEach(function (unit) {
    data.average(Object.assign({}, average, { statusUnitOfMeasurementSpeedBC: unit }));
    assert.ok(Math.abs(data.value('averageSpeedKmh') - 46.3 * 1.609344) < 1e-9);
});
data.average(Object.assign({}, average, { statusUnitOfMeasurementSpeedBC: 'KM_S_H__KM' }));
assert.strictEqual(data.value('averageSpeedKmh'), 46.3);
[0, 7, 'DEFAULT', 'SIGNAL_UNGUELTIG', 'mpg', '1', undefined, null, {}].forEach(function (unit) {
    data.average(Object.assign({}, average, { statusUnitOfMeasurementConsumptionBC: unit }));
    assert.strictEqual(data.value('averageConsumption'), null, 'unknown consumption units never guessed');
});
[0, 3, 'DEFAULT', 'SIGNAL_UNGUELTIG', 'mph', '1', null].forEach(function (unit) {
    data.average(Object.assign({}, average, { statusUnitOfMeasurementSpeedBC: unit }));
    assert.strictEqual(data.value('averageSpeedKmh'), null);
});
[4095, 65535, -1, 1.5, '98', NaN, Infinity, undefined, null].forEach(function (raw) {
    data.average(average);
    data.average(Object.assign({}, average, { consumptionAverage1BC1: raw, speedAverage1BC1: raw }));
    assert.strictEqual(data.value('averageConsumption'), null, 'invalid sample clears immediately');
    assert.strictEqual(data.value('averageSpeedKmh'), null);
});
data.range(range);
data.range({ fluidLevelFuelTank: 255, range: 4095, mileageKilometre: 16777215 });
['fuelL', 'rangeKm', 'odometerKm'].forEach(function (key) { assert.strictEqual(data.value(key), null); });
data.travel({ wayPassed: 65535, rideDurationHours: 4095, rideDurationMinutes: 255 });
['travelDistanceKm', 'rideDurationHours', 'rideDurationMinutes'].forEach(function (key) { assert.strictEqual(data.value(key), null); });
[255, -1, 254.5, 256, '147', NaN, Infinity, null].forEach(function (raw) {
    data.ambient({ temperatureExterior: 147 });
    data.ambient({ temperatureExterior: raw });
    assert.strictEqual(data.value('ambientC'), null);
});
[0, 254].forEach(function (raw) {
    data.ambient({ temperatureExterior: raw });
    assert.strictEqual(data.value('ambientC'), raw * 0.5 - 40);
});
// Availability lifecycle: late feeds do not resurrect lost providers.
data.range(range); data.average(average); data.ambient({ temperatureExterior: 147 });
data.availability('kombi', false);
data.range(range); data.average(average); data.travel({ wayPassed: 63 });
['rangeKm', 'averageConsumption', 'travelDistanceKm'].forEach(function (key) { assert.strictEqual(data.value(key), null); });
assert.strictEqual(data.value('ambientC'), 33.5, 'provider loss is scoped');
data.availability('kombi', true);
assert.strictEqual(data.value('rangeKm'), null, 'reconnect needs new sample');
data.range(range); assert.strictEqual(data.value('rangeKm'), 450);
data.availability('ambient', false); data.ambient({ temperatureExterior: 147 });
assert.strictEqual(data.value('ambientC'), null);
data.availability('ambient', true); assert.strictEqual(data.value('ambientC'), null);
data.ambient({ temperatureExterior: 147 });
// Independent field freshness; unrelated range packets cannot keep averages alive.
data.average(average);
now += 4999; assert.strictEqual(data.value('ambientC'), 33.5);
now += 1; assert.strictEqual(data.value('ambientC'), null);
now += 19999; data.range(range);
assert.strictEqual(data.value('averageSpeedKmh'), 46.3);
now += 1; assert.strictEqual(data.value('averageSpeedKmh'), null);
assert.strictEqual(data.value('averageConsumption'), null);
assert.strictEqual(data.value('rangeKm'), 450);
data.average(average);
const detached = data.value('averageConsumption'); detached.value = 999;
assert.strictEqual(data.value('averageConsumption').value, 9.8, 'callers cannot mutate cached objects');
data.range(null); assert.strictEqual(data.value('rangeKm'), null);
data.ambient(null); assert.strictEqual(data.snapshot().ambientC, null);
data.travel({ wayPassed: 0, rideDurationHours: 0, rideDurationMinutes: 0 });
assert.strictEqual(data.value('travelDistanceKm'), 0, 'zero is valid');
assert.strictEqual(data.value('rideDurationHours'), 0);
assert.strictEqual(data.value('rideDurationMinutes'), 0);
now -= 1; assert.strictEqual(data.value('travelDistanceKm'), null, 'clock reversal cannot retain samples');
console.log('F8X info data: wire sentinels, numeric/named units, scaling, half-degree temperature, provider loss/reconnect and independent freshness passed.');
