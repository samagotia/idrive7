# Implementation and follow-up ownership

The user requested that delegated agents implement changes and retain responsibility for their areas. Reuse these existing agents for follow-up work in this chat. The root agent coordinates shared-file edits, integration checks, packaging and release reporting.

| Area | Responsible agent | Contract and evidence |
| --- | --- | --- |
| BMW-only turn-telltale policy and sequential gear-recommendation arrows | `/root/own_turn_indicators` | [Owner notes](turn-indicator-ownership.md); turn and gear-recommendation tests |
| BMW-only parking-brake policy and shared gauge geometry | `/root/own_parking_brake` | [Owner notes](parking-brake-ownership.md); shared gauge geometry and no-duplicate composition tests |
| Full-panel backing and compositor/client coverage | `/root/own_panel_compositing` | `shared/f8x_panel_backing.js`; panel-underlay, wire-backing and parked fallback tests |
| Vehicle identity, automatic oil-scale profiles and RPM-candidate checks | `/root/own_dynamic_engine_limits` | [Research and ownership](dynamic-engine-limits-research.md); engine-profile, oil-scale and RPM-limit tests |
| RPM input cadence and signal-read lifecycle | `/root/rpm_signal_latency` | `shared/f8x_vehicle.js`; RPM-acquisition and signal-lifecycle tests |
| Needle motion, renderer commands and congestion recovery | `/root/native_renderer_latency` | `shared/f8x_motion.js`; motion/runtime, socket-drain and parked fallback tests |
| Independent performance validation | `/root/dial_render_cost` | [Reproducible comparison](../bench/profile-f8x-motion.js), [model results](f8x-motion-performance-0.16.4.json) |

Several areas share `shared/f8x_runtime.js` and the app manifest. Coordinate edits by section; owners preserve other areas' changes. A passing Mac test is evidence about that test's stated scope, not proof of live signal delivery or display FPS. On-car validation remains distinct from source verification and local simulation.
