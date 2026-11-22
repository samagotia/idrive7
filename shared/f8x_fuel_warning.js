'use strict';
// SPDX-License-Identifier: MIT
// Source-mapped from the public M8 i-Level 20-07-510 SOME/IP catalog:
// KombiIF.statusRangeTankStatus.statusFluidLevelFuelTankSpare,
// StatusFluidLevelFuelTankSpare: NICHT_AKTIV=0, AKTIV=1, invalid=3.
// Catalog: https://github.com/cauliflowermossgrape/idrive7-apps/issues/15
// Field presence does not establish delivery on a particular vehicle.
const RANGE_THRESHOLD_KM = 50;
// Existing KombiIF getter is polled every ten seconds. Allow two missed polls
// plus scheduling tolerance, then stop presenting the old value as live.
const MAX_AGE_MS = 25000;

function decodeReserve(raw) {
    if (raw === 1 || raw === 'AKTIV') return true;
    if (raw === 0 || raw === 'NICHT_AKTIV') return false;
    return null;
}

function evaluateFuelWarning(sample) {
    if (!sample || sample.available !== true || !Number.isFinite(sample.ageMs)
        || sample.ageMs < 0 || sample.ageMs >= MAX_AGE_MS) {
        return { active: null, source: 'unavailable', rangeKm: null };
    }
    const reserve = decodeReserve(sample.reserve);
    const rangeKm = Number.isFinite(sample.rangeKm) && sample.rangeKm >= 0 && sample.rangeKm < 4095
        ? sample.rangeKm : null;
    // BMW's explicit state takes priority, even when its reserve strategy differs
    // from the user's fallback threshold. Never infer reserve from fuel percent.
    if (reserve !== null) return { active: reserve, source: 'bmw-reserve', rangeKm };
    if (rangeKm !== null) return { active: rangeKm <= RANGE_THRESHOLD_KM, source: 'range-fallback', rangeKm };
    return { active: null, source: 'unavailable', rangeKm: null };
}

module.exports = { decodeReserve, evaluateFuelWarning, RANGE_THRESHOLD_KM, MAX_AGE_MS };
