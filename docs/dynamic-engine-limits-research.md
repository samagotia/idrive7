# Dynamic engine limits and temperature scales

Reviewed 22 November 2026. Area owner in this chat: `/root/own_dynamic_engine_limits`.

The automatic functions in other Store apps are real, but several are calculated profiles or learning algorithms. They are not all direct reads of factory gauge limits. The implementation can adopt their automatic identification approach while keeping that distinction visible.

## Current cauliflower implementation

The current public `cauliflowermossgrape/idrive7-apps` default branch was fetched through the GitHub connector; the local `work/vehicle-apps` checkout is older.

| Function | Actual implementation | Source |
|---|---|---|
| Engine class | `Vehicle2.statusVehiclePartType.typeEngine` identifies diesel/petrol. Generic stock profiles use 5000/7000 RPM. | [engine.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/main/kit/runtime/engine.js), blob `8fcdfe3fd6e3854d0c447476dba37d5ace6f726c` |
| V8 automatic redline | Read-only DME identification selects a stock preset: 6500 RPM for N63, 7200 for an identified M S63/S68. Shared diagnostic variants use the VIN maker code. The module explicitly excludes single-DME S58. This reads identity, not a transmitted RPM calibration. | [twin_dme.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/main/kit/runtime/twin_dme.js), blob `0720107e1b7d513fef42277d5a499e5f5a9b1246` |
| Cold guard | Redline interpolates a shift point from a 4500-RPM cold preset at 30°C to its normal target at configured warm oil temperature. Warmup uses a 3500-RPM petrol preset. These are oil-dependent estimates. | [Redline main.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/main/apps/redline/main.js), blob `d1ca197640bd748c436035c0abf78981af3fe7a2`; [Warmup](https://github.com/cauliflowermossgrape/idrive7-apps/blob/main/apps/warmup/main.js), blob `7703a54b68b003ea30d62d6ecc0244250a6355f8` |
| Learned maximum RPM | Detects a sustained RPM plateau at the limiter while warm, moving and in gear; the first result requires two matching observations. This is learned from driving, not available by identifying a parked car. | [limiter.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/main/apps/redline/limiter.js), blob `ea654879b7c83dcb4bce3c9aad2826a1d477224c` |
| Recommended shift RPM | Learns a torque envelope and gear ratios, then calculates a per-gear wheel-torque crossover. Before learning, uses the chosen redline minus the configured offset. | [shiftmap.js](https://github.com/cauliflowermossgrape/idrive7-apps/blob/main/apps/redline/shiftmap.js), blob `845b6203dc71c0c0b9a536f6d98ad468d8a99a7c` |

The learned-limiter approach has not been added to the parked-test app. The new helper sends no diagnostic requests, writes no vehicle state and requires no high-RPM driving.

## Other Store cluster implementations

- [Cruzen Cluster](https://github.com/cruzen991/Cluster/blob/main/apps/mx_classic_cluster/cluster.js): `warmLimit` subtracts up to 2500 RPM at oil temperatures at or below 40°C, interpolating to the configured redline at 80°C. This is another calculated warmup model. Inspected blob `9450ae8c6da70bed66dc3b3dd52dfb8f03e21dec`.
- [Marko E39 M5 cluster](https://github.com/markoni1408/mgu-e39-m5-cluster/blob/main/shared/hud.js): its E39 prewarning threshold interpolates between cold/warm temperatures and uses configured redline. No general factory oil-scale discovery mechanism was found in this path. Inspected blob `f0677a947aeff6d4037ff15da48c850bb2384a5f`.

## Available automatic identification in our app

The existing `Doors` metadata reader already subscribes to `Vehicle2.statusVehiclePartType`, with a getter and notifier. The owner's catalog declares `typeVehicle` values F80=57, F82=58, F83=59, G80=121, G82=122 and G83=123. `Doors.value()` clears model metadata when it is stale or its provider is lost. No new SOME/IP permission or duplicate subscription is needed to select a known model profile.

`shared/f8x_engine_profile.js` implements:

- `profileFor(metadata)`: supported stock-model identity to nominal engine profile, otherwise null.
- `resolveOilScale(preference, metadata, fallback)`: explicit scale wins; Auto selects the identified model's display profile; unknown models use a labelled fallback.
- `checkLiveRpm(candidateRpm, metadata)`: rejects a candidate above the identified model's stock nominal profile, retaining the original candidate, reason and `scalingVerified: false`. It does not substitute 7200 for an incompatible 8150 candidate or establish why that candidate was wrong.

These functions are pure and add no timers, vehicle reads or learning. Runtime integration uses the existing fresh `Doors.value()` metadata. Oil scale defaults to **Auto (vehicle model)**, preserves explicit overrides, and reports **Fallback** when identity is unavailable. The format signature includes the resolved scale so a model arriving after F8X is selected updates the face and needle curve together. The settings row identifies the source. Auto RPM requires a fresh recognised stock profile. Incompatible candidates or missing/stale identity hide the warning band and produce a specific diagnostic, so metadata loss cannot revive an earlier rejected value. Accepted values remain labelled unverified signal candidates. Manual RPM remains independent. No oil-based cold-limit estimate or limiter learning was added to the production runtime.

## Profile evidence and limits

- G80/G82 S58 nominal redline is 7200 RPM in [BMW's 2020 M3/M4 press material](https://www.press.bmwgroup.com/belux/article/attachment/T0317559FR/461189). G83 is covered by [BMW's 2021 M4 Convertible announcement](https://www.press.bmwgroup.com/usa/article/detail/T0333478EN_US/the-new-bmw-m4-competition-convertible-with-m-xdrive).
- F80/F82 S55 nominal redline is 7600 RPM in [BMW's launch announcement](https://www.press.bmwgroup.com/usa/article/detail/T0160684EN_US/). F83 is covered by [BMW's M4 Cabriolet announcement](https://www.press.bmwgroup.com/canada/article/detail/T0192695EN/the-new-2015-bmw-m4-cabriolet).
- G82's 50–100–150°C scale comes from the owner's direct observation of the stock display. The G8x family uses that presentation profile; non-G82 cars still need a parked visual comparison. F8x 70–120–170°C matches the supplied reference photographs. These are presentation profiles, not a scale transmitted by the car, normal-temperature thresholds, or a measurement of engine safety.
- Tuned or engine-swapped cars can differ from a stock model profile. Explicit overrides remain necessary. Unsupported models are not guessed from petrol/diesel alone.
- The current `raw × 50` maximum-RPM candidate remains unverified on this G82. A model profile provides an automatic plausibility check: 8150 is rejected for an identified stock G82, not clamped into a claimed live 7200. This does not repair or certify the live candidate's physical scaling.

## Verification and ownership

`bench/test-f8x-engine-profile.js` passes: actual model enum decoding, known-model automatic selection, explicit oil-scale override, unknown/stale metadata, immutable profiles, late-model runtime rebuilds, explicit settings, and rejected incompatible 8150 RPM on an identified G82, with lower live candidates and Manual 7200 retained. The owner remains responsible for `shared/f8x_engine_profile.js`, this research, and associated tests, coordinating runtime/settings integration with the indicator owner and parent.

No car actions, release publishing or automatic-learning driving tests were performed for this research.
