# Native M-cluster rectangles: parked comparison build 0.16.7

This is an experimental workaround, not a verified G82 fix. It does not change the vehicle, cluster coding, renderer installation, scene ID or target. No car action is performed by building or previewing it.

## What changes

**Designs → Keep BMW bottom strip clear (test)** defaults to **On**. All drawable layers end at or above y646 on the existing 1920 × 720 target. The opaque underlay ends at y646. The Day/Night background is cropped to its first 258 source rows and displayed at its original scale, ending at y645. It is not compressed vertically.

The bundled F8X layout now has main dials 14% larger and auxiliary dials 10% larger than 0.16.6, with wider placement. Faces, blades, pivots, shadows, glass and rev-limit track use matching uniform scales. Switching this test setting retains exactly the same enlarged dial geometry in both modes. The app's footer and fixed clock/ambient copies are omitted; BMW's bottom strip can show its range, clock, gear and outside temperature. The central selected information page stays available. Fuel/door message artwork is fitted above the strip and outside the enlarged lower arc; the door diagram retains its full proportions and size in the bundled layout. A saved layout that crosses the boundary is refused rather than silently shrinking or moving its gauges.

**Off** restores the full-height background and original lower information composition for comparison, with the same enlarged dial geometry. The existing no-demo and stale-speed/RPM fallback remain active in both modes. BMW remains the startup selection.

## What the evidence establishes

A [2022 G80 M3 report](https://github.com/robertnisipeanu/idrive-apps/issues/199) associates a full-height overlay with two native rectangles and a shorter overlay with their absence. A [2021 G82 M4 owner](https://github.com/bimmer-lab/apps/issues/11#issuecomment-6910435645) reports that another layout app avoids the issue. These reports motivate a comparison; they do not prove the mechanism or this car's outcome. The G80 comparison did not completely control image resolution/sampling. Both cases reported the same stock-scene unmapping, so preserving that mapping is not an established explanation.

The scene geometry reaches the cluster-side graphics renderer, but no inspected BMW source or trace establishes that native readout logic detects covered pixels or tests the bottom row's visibility. We did not find a verified individual-hide or draw-above operation for the two M rectangles.

## Parked comparison

1. Use BMW's normal cluster view with the car parked. Select F8X with the strip setting On; check both upper rectangles and note whether BMW's lower band appears.
2. Select BMW cluster before changing the setting. Compare Off, then On again, using the same car view, lighting and other settings. Confirm the dial sizes and spacing stay unchanged.
3. Because the G80 report describes retained rectangles after an app closes, a lingering box after switching modes is inconclusive. Return to BMW and obtain a clean native redraw before the next comparison; record if a door-open redraw changes it.
4. Check gear/warning visibility while parked. Switch to BMW if either display is unusable. Do not provoke speed/RPM failures while driving.

Local tests check actual renderer commands, cropped pixels in Day/Night, backpressure, hidden-layer bounds, all needle sweeps, exact dial geometry, mode switching and complete parked-test fallback. They cannot emulate BMW's proprietary masks or prove that this workaround removes them.

The release package is `samagotia_clusters@0.16.7.tgz` in the GitHub catalog release. MGU Store obtains its URL and checksum from the catalog. Publication does not install anything in the car or establish that the workaround succeeds there.
