# Parking-brake ownership and integration

Responsible agent: `/root/own_parking_brake`, retained for follow-up work in this conversation. The root agent owns release integration and publication.

## Owned files and contracts

- `shared/f8x_brake.js`: read-only parking-brake inputs, decoding, source precedence, freshness and lifecycle.
- `shared/f8x_brake_art.js`: the shared EU symbol / US BRAKE warning position. Both styles use the same off-centre, speedometer-side column and the same confirmed applied state.
- `bench/test-f8x-parking-brake.js` and `bench/test-f8x-brake-art.js`: behaviour and actual retained-artwork clearance checks.

The turn-indicator owner integrated `Vehicle2.statusStandstillFunctions: "rs"` in the app manifest. The root owns `shared/f8x_runtime.js` integration; its existing warning branch displays the widget only when `parkingBrake.value()` is `applied`. Neither the reader nor artwork moves or hides BMW-controlled warnings.

## Verified source mapping

The owner's captured iDrive 7 service catalog establishes both API definitions below. Catalog support proves the field exists; it does not establish that notifications/getters contain a useful state on this G82. A parked apply/release comparison remains necessary.

| Source | Access | Applied | Released | Other values |
| --- | --- | --- | --- | --- |
| `de.bmw.infotainment.vehicle.Vehicle2.statusStandstillFunctions.statusParkingBrake` | Getter 62; notifier 32830, event group 1 | `1` / `PARKBREMSE_MECHANISCH_FESTGESTELLT` | `0` / `PARKBREMSE_MECHANISCH_NICHT_FESTGESTELLT` | `2` releasing, `4` applying, `13` unsupported, `14` fault, `15` unpopulated |
| `de.bmw.infotainment.vehicle.CDS.statusHandBrake.statusContactHandBrake` | Getter 36; notifier 32804, event group 1 | `2` / `HANDBREMSE_ANGEZOGEN` | `1` / `HANDBREMSE_GELOEST` | `0` uncoded; `3` invalid |

The legacy CDS mapping is also present in the credited MGU App Kit live-data implementation. The electronic mapping is a distinct enum and must never reuse the legacy numeric decoder. No gear-selector or inferred parking state is used.

## Selection and diagnostics

Each source has its own provider state, timestamp and 2500 ms freshness window. Both request notifications and a getter every 1000 ms, with the existing single-outstanding-read signal helper.

Fresh confirmed electronic applied/released states take priority over the legacy contact. A fresh electronic transition or specific fault remains unknown and blocks legacy fallback. An unsupported, absent, unpopulated or unavailable electronic input may use a separately fresh, valid legacy contact. Unknown data never lights the app's parking-brake warning.

Provider loss clears that source immediately. Recovery needs a fresh sample. Late callbacks after stop are ignored; subscriptions resolving after stop are closed. `status()` exposes selected state/source/raw/reason and both candidates. State/raw changes log once rather than logging every identical poll.

## Validation and limits

Passed locally: numeric/named enum decoding, conflicting-source precedence, transitions and fresh fault blocking, unsupported-EPB legacy fallback, independent freshness, provider loss/recovery, clock rollback, late subscriptions/callbacks, idempotent shutdown, real manifest permissions and applied-only rendering. Artwork tests verify actual glyph/rim clearance for both warning styles and translated/scaled layouts. The fitted-layout suite also passes.

The far-right `(P)` in the owner's photograph is stock-controlled, outside the F8X widget coordinates. The photo alone cannot distinguish a physical telltale from another BMW compositor surface. The app cannot relocate that stock-controlled indicator. Its own warning uses the F8X reference position when a supported live source confirms the brake is applied.

No vehicle installation or release publication is performed by this owner. The owner reported version 0.16.3 installed; these changes belong to the next update.
