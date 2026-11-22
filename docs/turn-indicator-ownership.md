# Turn-indicator presentation

Owner for this work: `/root/own_turn_indicators`. Reuse this agent for turn-indicator implementation, regression tests and follow-up fixes. The root agent integrates and validates the combined build.

The owner's G82 photo shows two right-turn arrows: the lower arrow matches the app's reference position, while the upper arrow is consistent with BMW's stock-controlled indicator. The peer [Cruzen cluster documentation](https://github.com/cruzen991/Cluster#readme) records that instrument panels render below BMW's warning and indicator telltales. That source describes observations on another car; the exact native-versus-hardware implementation on this G82 has not been established.

The app does not relocate, suppress or duplicate BMW's turn telltales. It contains no production turn-arrow widgets, turn-signal subscription, blink controller, direction decoder or turn-indicator setting. The historical `f8xTurnIndicators` preference is ignored even when saved as `f8x`. Old custom turn and parking-brake widgets are filtered before layer planning, so saved preferences/layouts cannot restore duplicate telltales.

The parking-brake reader, schema, signal permissions and renderer icon were also removed in coordination with `/root/own_parking_brake`. A shared `f8x_gauge_geometry.js` retains only the generic pivot calculation needed by other artwork. There is no setting to turn these stock-telltale replicas back on. BMW remains responsible for its own lamps and native warning layers.

Owned implementation paths and touchpoints:

- `shared/f82_sprite.js`: sequential predicate; no custom turn-arrow widget factory or decoder remains.
- `shared/f8x_runtime.js`: exclusion of obsolete turn metadata before planning; no turn subscriptions or blink branch.
- `apps/samagotia_clusters/app.json` and `release.json`: no turn/brake settings or corresponding signal permissions. `CDS.statusGearIndicator` remains for verified gear recommendations.
- `shared/f8x_page.js`: retained Vehicle settings, with no turn/brake controls.
- `bench/test-f8x-turn-indicators.js`: removed schema/permissions/renderers and actual layer planning against legacy preferences and widgets. Cruise set-speed marker and sequential recommendations remain, while duplicate telltales are absent.

Validation covers default, old BMW, old F8X and invalid saved turn preferences combined with both historical brake styles. It injects legacy widget IDs, icons and metadata and confirms none reach the real runtime layer plan. Mac tests do not emulate BMW's native compositor or physical lamps; the retained stock display still requires a parked comparison.

No app release or car deployment is performed by this agent.

## Sequential gear recommendations

This owner also maintains `shared/f8x_gear_recommendation.js`, `shared/f8x_gear_recommendation_art.js`, the vertical `shiftUp`/`shiftDown` icon shapes, and `bench/test-f8x-gear-recommendation.js`.

The car's catalog provides an explicit direction, independent of RPM: `de.bmw.infotainment.vehicle.CDS.statusGearIndicator.displayGearShiftIndicatorDrive`. Its enum is `ANZEIGE_AUS`/0, `RUNTERSCHALTHINWEIS`/1, `HOCHSCHALTHINWEIS`/2, and invalid/3. The field has getter 35 and notifier 32803 in event group 1. The app requests read and subscribe permissions and uses only that mapped field; ambiguous `dummy` members in `Powertrain.dataDisplayGearboxSecure` are not interpreted.

Small up/down icons beside the large gear appear only for a fresh explicit recommendation, a valid forward gear, and the connected MDrive provider's verified S/M sequential mode. The recommendation expires after 1500 ms, with a 500 ms getter keeping unchanged indications current. At most one field read is outstanding through the shared signal helper. Program state is retained while its notifier-only provider stays available, and is cleared on invalid mode or provider loss; reconnect needs a new program notification. The same sequential predicate is used by the main gear readout.

Both arrows start hidden and use cached pixels. Live changes send visibility updates only. Automatic, P/N/R, invalid, unavailable, stale and simulated inputs show no recommendation. There is no guessed target gear, RPM threshold or simulated recommendation in the vehicle app.

The reader, enum, program-availability integration, icon placement and runtime visibility behavior pass local tests. Actual G82 recommendation delivery and parity with the stock display remain unverified until a parked comparison. A catalog entry alone is not evidence that the car populates a signal.
