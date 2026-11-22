# BMW parking-brake telltale ownership

Responsible agent: `/root/own_parking_brake`, retained for follow-up work in this conversation. The root agent owns release integration and publication.

BMW owns the parking-brake telltale. F8X does not draw a second EU symbol or US BRAKE label, subscribe to a parking-brake source, or offer a setting that can enable a duplicate. Its composition excludes known parking-brake widgets left in saved app layouts. BMW's stock light remains in its stock location.

The far-right `(P)` in the owner's photograph is stock-controlled, outside the F8X widget coordinates. The photograph alone cannot distinguish a physical telltale from a separate BMW compositor surface. F8X cannot relocate that stock-controlled indicator, and does not attempt to cover or suppress it.

## Owned integration contracts

- `shared/f8x_runtime.js` has no custom parking-brake reader, lifecycle hook, warning drawing branch or generated parking-brake widget. Its known legacy-widget filter enforces this policy for older app layout markers.
- The production manifest and shared-module allowlist carry no parking-brake permissions, reader or warning-art module. There is no brake-style setting in the app or settings page. The turn-indicator owner maintains those manifest/settings changes.
- The Mac test bench has no parking-brake simulation control or injected brake state.
- `shared/f8x_gauge_geometry.js` retains only the dial-pivot calculation used by cruise-speed markers, fuel messages and closure diagrams. It carries no parking-brake artwork or state decoder. Original licences and credits remain in LICENSE and NOTICE.
- `bench/test-f8x-gauge-geometry.js` covers actual dial centres, translated/scaled saved geometry, companion exclusion and invalid inputs. The composition/no-duplicate regression suite owns saved-marker rejection and absence of duplicate stock warnings.

No claim about live electronic-brake API delivery is needed for this policy: the stock indicator remains authoritative. No vehicle installation or release publication is performed by this owner.
