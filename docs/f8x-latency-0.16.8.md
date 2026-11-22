# RPM/speed response changes in 0.16.8

The reported car lag is real user evidence. These changes address source-proven app delay and unnecessary transport work; the Mac cannot establish the G82's physical frame rate or source cadence.

## Changed paths

- RPM and speed now submit the newest measured angle on the next eligible output frame. They no longer start a 36 ms ease that initially redraws the previous angle, then takes another 1–3 frames to catch up. No future RPM is predicted.
- Blade, shadow and glass poses for each connection are merged into one bounded frame write. Repeated updates to the same layer inside that frame retain only its latest properties. This avoids separate stream writes/wakeups for each companion layer.
- A changing 100 Hz source remains capped near 60 output frames per second. Settled RPM/speed schedule no interpolation frames. Fuel/oil retain 100 ms bounded smoothing and their slower pose budget.
- Congestion still pauses production, clears old motion, and resumes at the newest sample. Invalid data hides the affected needle; parked-test fallback and BMW warning ownership remain unchanged.

The native renderer supports consecutive protocol messages in one stream read: [`Server::read_client`](https://github.com/robertnisipeanu/idrive-apps/blob/main/native/cluster-render/src/server.cpp) consumes all complete messages before [`Service::after_poll`](https://github.com/robertnisipeanu/idrive-apps/blob/main/native/cluster-render/src/service.cpp) arranges/renders the scene. A socket write is not a message boundary. Batching reduces avoidable wakeups; it cannot force an unmeasured display refresh rate.

Live digital speed and gear have a 50 ms update gate instead of the old 200 ms text gate. Speed backup polling is now 50 ms; RPM remains 10 ms. [Input delivery details](f8x-input-latency-0.16.8.md).

## Deterministic comparison

Run `F8X_PROFILE_BASELINE=28b810fdb2bd3fd077e35abcf0716f9669dac116 node bench/profile-f8x-motion.js docs/f8x-motion-performance-0.16.8.json` to compare against the actual published 0.16.7 runtime. The model runs a 2000 RPM/s ramp with an ideal renderer, excluding real transport, CPU/GPU and display delays.

With a genuinely fresh 20 Hz source, mean modeled tracking lag falls from 57.61 ms to 24.49 ms. The remaining delay is principally the source's 50 ms held samples. The RPM blade/shadow pair falls from 116 to 20 socket writes per second. With a genuinely fresh 100 Hz source, output uses 60 writes per second and mean modeled tracking lag is 13.02 ms. These are software-model results, not measurements from the car.

The cached-source scenarios deliberately keep invoking the output queue on duplicate samples; production critical-sample deduplication is tested separately. Faster polling cannot make a cached source contain new information. If the car only supplies sparse samples, removing extra easing favors prompt accurate response over adding invented intermediate movement.

`test-f8x-live-latency.js` checks first-frame response, reversals, latest-value frame gating, companion delivery, idle silence and invalid recovery. `test-f8x-pose-batching.js` checks actual framing, bounded merging, nested batches, congestion, drops and exception cleanup. Existing native-runtime/motion, auxiliary-shadow and backpressure tests remain active. Renderer-client MPL-2.0 attribution is retained.
