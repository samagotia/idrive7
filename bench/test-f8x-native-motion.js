'use strict';
// Historical test filename: the instrument GPU now takes resident pose updates.
// This measures deterministic interpolation only, not car frame rate.
const assert = require('assert').strict;
const { NeedleMotion } = require('../shared/f8x_motion');
const near = (a, b) => assert(Math.abs(a - b) < 1e-9, a + ' differs from ' + b);
for (const delta of [-240, -50, -1, 1, 50, 240]) {
    const motion = new NeedleMotion({ settleMs: 36, maxStepMs: 36 });
    near(motion.sample(0, 0), 0);
    near(motion.sample(delta, 100), 0);
    assert.equal(motion.duration, 36, 'fast needles add no large-step or sample-spacing lag');
    for (let now = 100; now <= 136; now++) {
        const value = motion.sample(delta, now);
        assert(value >= Math.min(0, delta) && value <= Math.max(0, delta), 'no future-RPM prediction or overshoot');
    }
    near(motion.sample(delta, 136), delta);
    assert.equal(motion.moving(136), false);
    motion.sample(-delta, 150); const current = motion.sample(-delta, 160);
    near(motion.sample(delta, 160), current);
    for (let now = 160; now <= 196; now++) {
        const value = motion.sample(delta, now);
        assert(value >= Math.min(current, delta) && value <= Math.max(current, delta), 'reversals remain bounded');
    }
    near(motion.sample(delta, 196), delta);
    assert.equal(motion.sample(null, 200), null);
    near(motion.sample(42, 201), 42);
    motion.sample(50, 210); near(motion.sample(10, 100), 10);
}
console.log('F8X short needle motion: 36ms fast settlement across large steps, bounded reversals, no prediction, invalid clearing and monotonic-clock recovery passed.');
