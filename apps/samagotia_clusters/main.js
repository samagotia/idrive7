'use strict';
// SPDX-License-Identifier: MIT
// Derived from Cluster Themes, Copyright (c) 2026 bimmer-lab. See LICENSE and NOTICE.
const mgu = require('./kit/mgu');
const F8xRuntime = require('./f8x_runtime');
const F8xPage = require('./f8x_page');

mgu.run({
    start(ctx) {
        // Migrate settings saved by earlier Samagotia test builds.
        if (ctx.settings.get('f82Footer') === 'time') ctx.settings.set('f82Footer', 'off');
        if (ctx.settings.get('hudLayout') === 'f82') ctx.settings.set('hudLayout', 'our_m4');
        let runtime;
        try { runtime = new F8xRuntime(ctx); }
        catch (error) {
            ctx.log.error('Cluster failed to start: ' + (error && error.stack || error));
            return;
        }
        runtime.start();
        new F8xPage(ctx, runtime).start();
        process.on('exit', () => { try { runtime.stop(); } catch (error) { /* exiting */ } });
    },
});
