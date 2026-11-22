'use strict';
// SPDX-License-Identifier: MIT
// Shared lower-right warning area. This precedence is app policy, not a
// reconstruction of BMW Check Control arbitration. Every confirmed open panel
// remains in the diagram even when a higher-priority message owns the text.
function present(doors, fuel) {
    const d = doors || {}, c = d.closures || {}, p = d.physical || {};
    const sides = d.layout === 'two' ? ['driverFront', 'passengerFront']
        : ['driverFront', 'passengerFront', 'driverRear', 'passengerRear'];
    const count = sides.filter((name) => c[name] === 'open').length;
    const hood = c.bonnet === 'open', boot = c.boot === 'open', secondary = c.boot2 === 'open';
    const state = Object.assign({ bodyStyle: d.layout === 'two' ? 'coupe' : d.layout === 'four' ? 'sedan' : 'unknown' }, p);
    let kind = null, text = '', critical = false;
    if (hood || boot || secondary || count) {
        kind = 'closure';
        text = hood ? 'Hood open' : boot ? 'Boot open' : secondary ? 'Tailgate open' : count > 1 ? 'Doors open' : 'Door open';
        // Only the hood reference establishes red text. Other labels stay pale.
        critical = hood;
    } else if (fuel && fuel.active === true) { kind = 'fuel'; text = 'Fuel reserve'; }
    const mappable = ['bonnet', 'boot', 'boot2'].some((name) => state[name] === 'open')
        || (d.layout !== null && (d.layout === 'two' || d.layout === 'four')
            && ['frontLeft', 'frontRight'].concat(d.layout === 'four' ? ['rearLeft', 'rearRight'] : []).some((name) => state[name] === 'open'));
    const diagram = kind === 'closure' && mappable;
    const key = [kind || 'none', text, critical, state.bodyStyle].concat(
        ['frontLeft', 'frontRight', 'rearLeft', 'rearRight', 'bonnet', 'boot', 'boot2'].map((name) => state[name] || 'unknown')).join('|');
    return { kind, text, critical, diagram, pump: kind === 'fuel', doorState: state, key };
}
module.exports = { present };
