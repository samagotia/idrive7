'use strict';
// SPDX-License-Identifier: MIT
// Presentation policy selected by Vehicle2.statusVehiclePartType's model code.
// These are stock-model profiles, not ECU calibration or manufacturer safety limits.
// See docs/dynamic-engine-limits-research.md for model/specification sources and
// the distinction between measured values, profiles and temperature estimates.
const PROFILES = {
    F80: { engine: 'S55', nominalRpm: 7600, oilScale: '70-170' },
    F82: { engine: 'S55', nominalRpm: 7600, oilScale: '70-170' },
    F83: { engine: 'S55', nominalRpm: 7600, oilScale: '70-170' },
    G80: { engine: 'S58', nominalRpm: 7200, oilScale: '50-150' },
    G82: { engine: 'S58', nominalRpm: 7200, oilScale: '50-150' },
    G83: { engine: 'S58', nominalRpm: 7200, oilScale: '50-150' },
};
const SCALES = ['50-150', '70-170'];
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

// The caller should pass Doors.value(), which clears model on stale metadata
// and provider loss. A metadata object explicitly marked stale is also rejected.
function profileFor(metadata) {
    if (metadata && typeof metadata === 'object' && metadata.fresh === false) return null;
    const model = typeof metadata === 'string' ? metadata : metadata && metadata.model;
    if (typeof model !== 'string' || !Object.prototype.hasOwnProperty.call(PROFILES, model)) return null;
    return Object.assign({ model, source: 'vehicle-profile:' + model }, PROFILES[model]);
}

function resolveOilScale(preference, metadata, fallback) {
    const profile = profileFor(metadata);
    if (SCALES.indexOf(preference) >= 0) {
        return { scale: preference, source: 'manual', automatic: false, model: profile ? profile.model : null, reason: 'explicit' };
    }
    if ((preference === 'auto' || preference === undefined) && profile) {
        return { scale: profile.oilScale, source: profile.source, automatic: true, model: profile.model, reason: 'identified-model' };
    }
    const scale = SCALES.indexOf(fallback) >= 0 ? fallback : '50-150';
    return { scale, source: 'fallback', automatic: false, model: null,
        reason: preference === 'auto' || preference === undefined ? 'model-unavailable' : 'invalid-setting' };
}

// Reject a candidate above a known stock nominal value instead of replacing it
// with the profile and mislabelling that substitution as BMW live data.
function checkLiveRpm(candidateRpm, metadata) {
    const profile = profileFor(metadata);
    const valid = isNum(candidateRpm) && candidateRpm >= 1000 && candidateRpm <= 10000;
    const incompatible = valid && !!profile && candidateRpm > profile.nominalRpm;
    return { rpm: valid && !!profile && !incompatible ? candidateRpm : null,
        candidateRpm: valid ? candidateRpm : null, profile,
        reason: incompatible ? 'incompatible-profile' : valid && !profile ? 'model-unavailable'
            : valid ? 'candidate' : 'unavailable', scalingVerified: false };
}

module.exports = { profileFor, resolveOilScale, checkLiveRpm };
