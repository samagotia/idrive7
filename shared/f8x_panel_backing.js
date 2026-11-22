'use strict';
// SPDX-License-Identifier: MIT
// A resident opaque floor while the decorative background waits for image upload.
const FS = `
precision mediump float;
void main() {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
}
`;

function widget() {
    return { id: 'f8x_panel_underlay', type: 'f8xpanel', class: 'ambient', z: -1,
        x: 0, y: 0, w: 1920, h: 720 };
}

module.exports = { FS, widget };
