# Performance implementation 0.16.9

The source comparison with cauliflowermossgrape/idrive7-apps identified distinct centre-HMI and remote-instrument rendering paths. Its [Redline HUD notes](https://github.com/cauliflowermossgrape/idrive7-apps/blob/e2716cdd8d779141262a078fe192cade6cf26f4b/apps/redline/README.md#L114-L136) describe shader limits on the instrument cluster. That motivates reducing shader work here; it does not establish that our shader was this G82’s dominant bottleneck.

## Default cached drawing

The dynamic lamp band is 34 small resident image layers: 17 slots with both bloom variants. Each texture is 128 × 40. Both variants preload; changes to buildup, flash and bloom select visibility. Palette and changed pitch/radius may replace cached images, then return to idle. The static lower arc is also a cached image. This replaces the two procedural ring effects while keeping the existing colours, bevels and bloom. The original shader path is retained as a Performance-page comparison option. No geometry or dial-size change is introduced.

Pixel-parity tests compare the new capsules to the old analytic formula across Day/Night, normal/strong bloom and multiple limit positions. Actual runtime/wire tests check zero steady-state/buildup/flash pixel writes, normal cleanup, hidden invalid-limit lamps and 64-layer/16-MiB constraints. The standard composition is 60 layers and about 10.07 MiB. More draw calls versus fewer fragment calculations is a tradeoff; the G82 GPU result remains unmeasured.

## Optional RPM presentation

Measured is the default. Smooth mode is explicitly a visual estimate. It requires two consecutive rising changed samples at sparse intervals, known forward gear and positive fresh pedal input. Lead is bounded to the smaller of 100 RPM, one exact dial degree, the dial limit and a known configured/live shift limit. The horizon is no longer than 50 ms or one observed sample interval. Repeated cached values do not restart that horizon. New readings, reversals, shifts, pedal lift, provider/freshness loss and backpressure reset or replace the estimate. After a 150 ms unchanged hold the estimate returns to measured. Raw values, speed, digital readouts and shift decisions are never predicted.

## Diagnostics and parked comparison

Performance shows receive and changed-value rates separately. A successful cached getter counts as received, not as a new sensor sample. App command rate and local dispatch delay cover only work inside this process, not RAMSES flush completion, GPU rendering or physical presentation. The rolling counters are bounded and add no timers or per-frame logs; the centre page refreshes at 1 Hz.

While parked in BMW’s normal view, compare Cached images and Original shaders with Measured RPM in both cases. Keep the same lighting/layout and record receive/change cadence and local dispatch delay. If input and app timing are healthy but the instrument remains slow, native renderer timing is still needed. Compare optional Smooth RPM only afterward; it can change visual stepping without proving a faster display. Do not interpret a Mac preview or app command count as car FPS.

The existing BMW startup, no-demo car policy, stale speed/RPM fallback and native telltale ownership remain unchanged. This update does not flash or code the car.
