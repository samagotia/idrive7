# Samagotia Clusters

Standalone BMW iDrive 7 instrument-cluster app featuring **F8X**. App ID: `samagotia_clusters`.

![F8X](docs/preview-day.jpg)

## MGU Store installation

This is a parked-test prerelease. Requires MGU Store already installed and **cluster-render 0.5.3 or later**. This repository does not enable SSH or install the Store on a stock car.

Add this GitHub repository as a source in MGU Store. The binary catalog is:

`https://github.com/samagotia/idrive7/releases/download/catalog/catalog.json`

The app starts with the **BMW cluster** selected and demo data off on the car. Select F8X only while parked for initial checks. Missing/stale speed or RPM, or renderer disconnection, returns to BMW and requires manual reselection. Live readers are source mapped; G82 reception, cold-limit tracking and native BMW warning takeover remain unverified on the car.

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

Original licences and credits are preserved in [NOTICE](NOTICE) and [LICENSE](LICENSE), including MPL-covered renderer-client source in `shared/cluster_render_client.js`. Full features and limitations: [app documentation](apps/samagotia_clusters/README.md). [Local validation](docs/validation-0.16.4.json).
