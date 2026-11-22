'use strict';
const assert = require('assert').strict;
const { profileFor, resolveOilScale, checkLiveRpm } = require('../shared/f8x_engine_profile');
const { decodeMetadata } = require('../shared/f8x_doors');
const g82 = decodeMetadata({ typeVehicle: 122 });
const f82 = decodeMetadata({ typeVehicle: 58 });
assert.equal(g82.model, 'G82');
assert.equal(profileFor(g82).nominalRpm, 7200);
assert.equal(profileFor(f82).nominalRpm, 7600);
assert.equal(profileFor('G83').engine, 'S58');
assert.equal(resolveOilScale('auto', g82).scale, '50-150');
assert.equal(resolveOilScale('auto', f82).scale, '70-170');
assert.equal(resolveOilScale('auto', g82).source, 'vehicle-profile:G82');
assert.equal(resolveOilScale('auto', g82).automatic, true);
assert.equal(resolveOilScale('70-170', g82).scale, '70-170', 'explicit preference wins over model policy');
assert.equal(resolveOilScale('70-170', g82).source, 'manual');
assert.equal(resolveOilScale('auto', null, '70-170').scale, '70-170');
assert.equal(resolveOilScale('auto', null).automatic, false, 'fallback must not be called detected');
assert.equal(resolveOilScale('auto', null).reason, 'model-unavailable');
assert.equal(resolveOilScale('invalid', g82).source, 'fallback');
for (const metadata of [null, {}, 'G20', 'S58', 122, { model: 'G82', fresh: false }, { model: 'g82' }, { model: '__proto__' }]) {
    assert.equal(profileFor(metadata), null, 'unsupported metadata never guesses a stock model');
}
const mutated = profileFor(g82); mutated.nominalRpm = 9999;
assert.equal(profileFor(g82).nominalRpm, 7200, 'callers cannot change the shared policy');

const rejected = checkLiveRpm(8150, g82);
assert.equal(rejected.rpm, null); assert.equal(rejected.candidateRpm, 8150);
assert.equal(rejected.reason, 'incompatible-profile'); assert.equal(rejected.profile.nominalRpm, 7200);
assert.equal(rejected.scalingVerified, false, 'profile rejection does not verify the wire scaling');
assert.equal(checkLiveRpm(4500, g82).rpm, 4500, 'a lower transmitted candidate is not raised');
assert.equal(checkLiveRpm(8150, null).rpm, null, 'unknown models cannot bypass the profile check');
assert.equal(checkLiveRpm(8150, null).reason, 'model-unavailable');
assert.equal(checkLiveRpm(7200, { model: 'G82', fresh: false }).rpm, null, 'stale metadata cannot validate a candidate');
assert.equal(checkLiveRpm(null, g82).rpm, null, 'missing candidate cannot be revived as a live value');

// Exercise the runtime path: metadata arrives after the layout is selected.
const fs = require('fs'), path = require('path'), vm = require('vm');
const profile = require('../shared/f8x_engine_profile');
const sprite = require('../shared/f82_sprite');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../shared/f8x_runtime.js'), 'utf8'), {
    module: moduleUnderTest, Buffer, process: { env: {}, uptime: () => 0 },
    require(name) { return name === './f8x_engine_profile' ? profile : name === './f82_sprite' ? sprite : {}; },
});
let metadata = null, candidate = 8150, rebuilds = 0;
const settings = { f8xOilScale: 'auto', f8xLimitSource: 'auto', f82Redline: 7200 };
const runtime = Object.assign(Object.create(moduleUnderTest.exports.prototype), {
    setting: (key) => settings[key], doors: { value: () => metadata },
    _effectiveFormat: () => 'metric', car: { data: () => ({ oil: 100, condition: 10 }) },
    rpmLimit: { value: () => candidate, status: () => ({ raw: 163, reason: 'live', ageMs: 0 }) },
    activeName: 'our_m4', _formatSignature: null, client: { ready: true }, clients: [], widgets: [],
    _rebuild: () => { rebuilds++; }, _updateF82Startup() {}, _queueF82() {},
});
assert.equal(runtime._oilScaleInfo().source, 'fallback');
assert.match(runtime.oilScaleStatus(), /^Fallback:/);
runtime._tick(); assert.equal(rebuilds, 1);
metadata = f82; runtime._tick(); assert.equal(rebuilds, 2, 'model arrival changes the resolved scale and triggers a rebuild');
assert.equal(runtime._oilScaleInfo().scale, '70-170');
assert.match(runtime.oilScaleStatus(), /Auto F82/);
metadata = g82; runtime._tick(); assert.equal(rebuilds, 3);
assert.equal(runtime._oilScaleInfo().scale, '50-150');
assert.equal(runtime._f82ShiftLimit(100), null, '8150 cannot be used as a valid G82 redline');
assert.match(runtime.rpmLimitStatus(), /rejected.*8150.*G82.*7200/);
assert.match(runtime.rpmLimitDetails(), /raw 163.*incompatible with G82/);
metadata = null;
assert.equal(runtime._f82ShiftLimit(100), null, 'losing G82 metadata cannot revive the rejected 8150 candidate');
assert.match(runtime.rpmLimitStatus(), /vehicle profile unknown/);
metadata = g82; candidate = 7200;
assert.equal(runtime._f82ShiftLimit(100), 7200, 'fresh profile and a compatible new candidate recover');
assert.match(runtime.rpmLimitStatus(), /candidate \(unverified\): 7200/);
candidate = 4500; assert.equal(runtime._f82ShiftLimit(30), 4500, 'a plausible lower live limit remains dynamic');
settings.f8xLimitSource = 'manual'; candidate = 8150;
assert.equal(runtime._f82ShiftLimit(100), 7200, 'explicit Manual remains independent of the rejected live candidate');
assert.match(runtime.rpmLimitStatus(), /Manual max RPM: 7200/);
settings.f8xOilScale = '70-170'; runtime._tick(); assert.equal(rebuilds, 4);
assert.equal(runtime._oilScaleInfo().source, 'manual');
metadata = null; runtime._tick(); assert.equal(rebuilds, 4, 'metadata loss does not override an explicit scale');
settings.f8xOilScale = 'auto'; runtime._tick(); assert.equal(rebuilds, 5);
assert.equal(runtime._oilScaleInfo().source, 'fallback', 'metadata loss cannot retain an identified profile');
console.log('F8X engine profiles: actual model decoding, automatic scale and late metadata rebuild, explicit overrides, unknown/stale metadata and incompatible live-RPM rejection passed.');
