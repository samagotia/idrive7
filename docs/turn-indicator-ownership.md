# Turn-indicator presentation

Owner for this work: `/root/own_turn_indicators`. Reuse this agent for turn-indicator implementation, regression tests and follow-up fixes. The root agent integrates and validates the combined build.

The owner's G82 photo shows two right-turn arrows: the lower arrow matches the app's reference position, while the upper arrow is consistent with BMW's stock-controlled indicator. The peer [Cruzen cluster documentation](https://github.com/cruzen991/Cluster#readme) records that instrument panels render below BMW's warning and indicator telltales. That source describes observations on another car; the exact native-versus-hardware implementation on this G82 has not been established.

The app does not relocate or suppress BMW telltales. It avoids duplicating them by default. `f8xTurnIndicators` is an explicit presentation preference, not hardware detection:

- `stock` / **BMW indicators** is the default, including existing installations with no saved value. No in-panel F8X arrows are created.
- `f8x` / **F8X indicators** explicitly adds the reference left/right arrows for installations that need them. BMW indicators may remain visible as well.
- Invalid or unknown saved values select the BMW/default presentation.

The control appears in **Vehicle settings**. It fits above the vehicle status and bottom diagnostics; the General settings grid is not extended. The cruise icon retains its existing reference anchor to the right of the left-turn position, even when F8X turn arrows are omitted.

Owned implementation paths and touchpoints:

- `shared/f82_sprite.js`: reference positions, `turnIndicatorWidgets`, turn decoding.
- `shared/f8x_runtime.js`: turn-layer selection and live blink presentation only; other runtime areas have separate owners.
- `apps/samagotia_clusters/app.json` and `release.json`: turn setting schema and public visibility. The same coordinated edit adds `Vehicle2.statusStandstillFunctions: rs` for the parking-brake owner's reader.
- `shared/f8x_page.js`: Vehicle settings placement.
- `bench/test-f8x-turn-indicators.js`: schema, real rebuild layer selection, real runtime blink visibility, cruise anchoring and actual page-control bounds.

Validation: turn-indicator, page-performance, cruise-art and oil-scale suites pass. The test exercises default, explicit BMW, explicit F8X and invalid settings against the actual runtime's layer-plan path. It checks left/right/hazard illumination and the dark blink phase. The physical stock telltales remain a parked-car verification item; Mac tests do not emulate BMW's compositor or lamps.

No app release or car deployment is performed by this agent.

## Sequential gear recommendations

This owner also maintains `shared/f8x_gear_recommendation.js`, `shared/f8x_gear_recommendation_art.js`, the vertical `shiftUp`/`shiftDown` icon shapes, and `bench/test-f8x-gear-recommendation.js`.

The car's catalog provides an explicit direction, independent of RPM: `de.bmw.infotainment.vehicle.CDS.statusGearIndicator.displayGearShiftIndicatorDrive`. Its enum is `ANZEIGE_AUS`/0, `RUNTERSCHALTHINWEIS`/1, `HOCHSCHALTHINWEIS`/2, and invalid/3. The field has getter 35 and notifier 32803 in event group 1. The app requests read and subscribe permissions and uses only that mapped field; ambiguous `dummy` members in `Powertrain.dataDisplayGearboxSecure` are not interpreted.

Small up/down icons beside the large gear appear only for a fresh explicit recommendation, a valid forward gear, and the connected MDrive provider's verified S/M sequential mode. The recommendation expires after 1500 ms, with a 500 ms getter keeping unchanged indications current. At most one field read is outstanding through the shared signal helper. Program state is retained while its notifier-only provider stays available, and is cleared on invalid mode or provider loss; reconnect needs a new program notification. The same sequential predicate is used by the main gear readout.

Both arrows start hidden and use cached pixels. Live changes send visibility updates only. Automatic, P/N/R, invalid, unavailable, stale and simulated inputs show no recommendation. There is no guessed target gear, RPM threshold or simulated recommendation in the vehicle app.

The reader, enum, program-availability integration, icon placement and runtime visibility behavior pass local tests. Actual G82 recommendation delivery and parity with the stock display remain unverified until a parked comparison. A catalog entry alone is not evidence that the car populates a signal.
