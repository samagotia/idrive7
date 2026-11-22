'use strict';
// SPDX-License-Identifier: MIT
// Pure, read-only decoder/cache. Runtime owns subscriptions and polling.
// Public API: new InfoData({now}); availability(source, boolean);
// range/average/travel/ambient(payload); value(key); snapshot(). Missing, invalid,
// stale and unavailable data return null. Sources: kombi (25 s), ambient (5 s).
// Keys: fuelL, rangeKm, odometerKm, averageConsumption ({value, unit}),
// averageSpeedKmh, travelDistanceKm, rideDurationHours, rideDurationMinutes,
// ambientC. travelDistanceKm is travel-computer distance, NOT verified factory trip.
// Wire sentinels/enums: public M8 SOME/IP catalog attached to
// https://github.com/cauliflowermossgrape/idrive7-apps/issues/15
// Average 0.1 scaling and wayPassed km corroborated by upstream Live Data:
// https://github.com/cauliflowermossgrape/idrive7-apps/blob/main/apps/live_data/signals.js
// Catalog existence does not verify delivery on a particular vehicle.

const TTL_MS = { kombi: 25000, ambient: 5000 };
const SOURCES = {
    fuelL: 'kombi', rangeKm: 'kombi', odometerKm: 'kombi',
    averageConsumption: 'kombi', averageSpeedKmh: 'kombi',
    travelDistanceKm: 'kombi', rideDurationHours: 'kombi',
    rideDurationMinutes: 'kombi', ambientC: 'ambient'
};
const CONSUMPTION_UNITS = {
    VERBRAUCH_IN_L_S_100KM: 'l/100km', VERBRAUCH_IN_MPG_UK: 'mpg_uk',
    VERBRAUCH_IN_MPG_US: 'mpg_us', VERBRAUCH_IN_KM_S_L: 'km/l'
};
const CONSUMPTION_NUMERIC = { 1: 'l/100km', 2: 'mpg_uk', 3: 'mpg_us', 4: 'km/l' };

function counter(raw, invalid) {
    return typeof raw === 'number' && Number.isFinite(raw) && Math.floor(raw) === raw
        && raw >= 0 && raw < invalid ? raw : null;
}
function consumptionUnit(raw) {
    if (typeof raw === 'number') return CONSUMPTION_NUMERIC[raw] || null;
    return typeof raw === 'string' && Object.prototype.hasOwnProperty.call(CONSUMPTION_UNITS, raw)
        ? CONSUMPTION_UNITS[raw] : null;
}
function speedFactor(raw) {
    if (raw === 1 || raw === 'KM_S_H__KM') return 1;
    if (raw === 2 || raw === 'MPH__MLS') return 1.609344;
    return null;
}
function copy(value) {
    return value && typeof value === 'object' ? { value: value.value, unit: value.unit } : value;
}

class InfoData {
    constructor(options) {
        this._now = options && options.now || function () { return process.uptime() * 1000; };
        this._available = Object.create(null);
        this._samples = Object.create(null);
    }
    availability(source, available) {
        if (!Object.prototype.hasOwnProperty.call(TTL_MS, source) || typeof available !== 'boolean') return;
        this._available[source] = available;
        if (!available) {
            Object.keys(SOURCES).forEach((key) => {
                if (SOURCES[key] === source) delete this._samples[key];
            });
        }
    }
    _set(key, value) {
        const source = SOURCES[key];
        // Reject late callbacks after loss. Reconnection must be explicit; it
        // never revives cached values. Initial unknown availability accepts feeds.
        if (this._available[source] === false) return;
        if (value === null) delete this._samples[key];
        else this._samples[key] = { value: value, at: this._now() };
    }
    range(payload) {
        const v = payload || {};
        this._set('fuelL', counter(v.fluidLevelFuelTank, 255));
        this._set('rangeKm', counter(v.range, 4095));
        this._set('odometerKm', counter(v.mileageKilometre, 16777215));
    }
    average(payload) {
        const v = payload || {};
        const rawConsumption = counter(v.consumptionAverage1BC1, 4095);
        const unit = consumptionUnit(v.statusUnitOfMeasurementConsumptionBC);
        this._set('averageConsumption', rawConsumption !== null && unit !== null
            ? { value: rawConsumption / 10, unit: unit } : null);
        const rawSpeed = counter(v.speedAverage1BC1, 4095);
        const factor = speedFactor(v.statusUnitOfMeasurementSpeedBC);
        this._set('averageSpeedKmh', rawSpeed !== null && factor !== null ? rawSpeed / 10 * factor : null);
    }
    travel(payload) {
        const v = payload || {};
        this._set('travelDistanceKm', counter(v.wayPassed, 65535));
        this._set('rideDurationHours', counter(v.rideDurationHours, 4095));
        // A valid clock-minute component is 0..59; 255 is wire invalid.
        this._set('rideDurationMinutes', counter(v.rideDurationMinutes, 60));
    }
    ambient(payload) {
        const raw = counter(payload && payload.temperatureExterior, 255);
        this._set('ambientC', raw === null ? null : raw * 0.5 - 40);
    }
    value(key) {
        const sample = this._samples[key];
        if (!sample) return null;
        const age = this._now() - sample.at;
        if (!Number.isFinite(age) || age < 0 || age >= TTL_MS[SOURCES[key]]) {
            delete this._samples[key];
            return null;
        }
        return copy(sample.value);
    }
    snapshot() {
        const values = {};
        Object.keys(SOURCES).forEach((key) => { values[key] = this.value(key); });
        return values;
    }
}

module.exports = { InfoData, TTL_MS };
