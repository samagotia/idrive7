# F8X Mac test bench

Run `node bench/server.js samagotia_clusters` and open http://127.0.0.1:8078/.

Actual app artwork, shaders and signal decoding run against simulated providers. Demo drive generates a drive cycle; Manual enables sliders and Doors / panels controls. Nothing here connects to a car. Settings are stored in ignored `bench/.data`.

Limits model cluster-render 0.5.3: 64 layers/client, 96 total, 16 MiB image memory counting images twice. F8X uses about 30 layers/8.6 MiB. Native BMW slot takeover is not reproduced by the browser.
