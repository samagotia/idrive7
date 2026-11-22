# Samagotia Clusters

Standalone BMW iDrive 7 instrument-cluster app featuring **F8X**. App ID: `samagotia_clusters`.

![F8X — local preview with simulated signals](docs/preview-0.16.8-day.png)

## MGU Store installation

This is a parked-test prerelease. Requires MGU Store already installed and **cluster-render 0.5.3 or later**. This repository does not enable SSH or install the Store on a stock car.

Add this GitHub repository as a source in MGU Store. The binary catalog is:

`https://github.com/samagotia/idrive7/releases/download/catalog/catalog.json`

The app starts with the **BMW cluster** selected and demo data off on the car. Select F8X only while parked for initial checks. Missing/stale speed or RPM, or renderer disconnection, returns to BMW and requires manual reselection. Live readers are source mapped; G82 reception, cold-limit tracking and native BMW warning takeover remain unverified on the car.

## Parked-test update 0.16.8

RPM and speed no longer wait for the extra 36 ms needle easing. Companion poses share one bounded socket write per frame, unchanged critical readings no longer wake the renderer, and speed backup reads run every 50 ms instead of 500 ms (RPM remains 10 ms). Live digital speed and gear can refresh every 50 ms rather than 200 ms. These changes reduce app delay; actual car latency and FPS remain unmeasured. [Response changes](docs/f8x-latency-0.16.8.md).

Relative to 0.16.7, main dials are 10% smaller and outer gauges 20% smaller, in both Day and Night. Main hub spacing increases from 700 to 740 pixels. **Designs → Keep BMW bottom strip clear (test)** remains On by default, with the same dial geometry when toggled Off. Physical trim clearance and the black-box workaround still require a parked check. [Comparison instructions](docs/native-m-boxes-parked-test.md).

## Mac preview

With Node.js and Python 3 installed:

```sh
node bench/server.js samagotia_clusters
```

Open http://127.0.0.1:8078/ or double-click **Start Preview.command**. Every vehicle reading here is simulated; no car connection is made.

## Build and test

```sh
python3 tools/build_clusters.py --out dist/releases --repo samagotia/idrive7
python3 tools/build_clusters.py --stage-only
for test in bench/test*.js; do node "$test" || exit 1; done
```

The builder creates a local staging placeholder and removes it before packaging. No BMW SDK, private keys, coding backups or personal preview settings are distributed. The Store supplies the real SDK on the head unit.

Original licences and credits are preserved in [NOTICE](NOTICE) and [LICENSE](LICENSE), including MPL-covered renderer-client source in `shared/cluster_render_client.js`. Full features and limitations: [app documentation](apps/samagotia_clusters/README.md). [Local validation](docs/validation-0.16.8.json).
