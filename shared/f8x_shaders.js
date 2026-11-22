'use strict';
// SPDX-License-Identifier: MIT
// Adapted from Cluster Themes, Copyright (c) 2026 bimmer-lab. See LICENSE and NOTICE.
// Atlas-text shader adapted from Robert Nisipeanu, MPL-2.0. See NOTICE.
const ATEXT = `// Atlas text for a cluster-render "effect" layer (GLSL ES 1.00): u_cells equal cells across the layer, each
// showing one glyph of the R8 glyph atlas bound to u_font (u_grid.x columns by u_grid.y rows of cells), picked
// by the codes in u_text (32 codes, 4 to a vec4; below 0 = empty). A new value is one uniform message, no
// pixels. After robertnisipeanu/idrive-apps js/showcase.js (TEXT_FS). v_uv (0,0) is the top-left.
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_font;
uniform vec4 u_text[8];
uniform float u_cells;
uniform vec2 u_grid;
uniform vec4 u_color;

float code(float cell) {
    float slot = floor(cell / 4.0), lane = cell - slot * 4.0;
    vec4 v = u_text[0];
    for (int i = 1; i < 8; i++) if (float(i) == slot) v = u_text[i];
    return lane < 0.5 ? v.x : lane < 1.5 ? v.y : lane < 2.5 ? v.z : v.w;
}

void main() {
    float x = v_uv.x * u_cells;
    float c = code(floor(x));
    float col = mod(c, u_grid.x), row = floor(c / u_grid.x);
    vec2 uv = vec2((col + fract(x)) / u_grid.x, (row + v_uv.y) / u_grid.y);
    float ink = c < 0.0 ? 0.0 : texture2D(u_font, uv).r;
    gl_FragColor = vec4(u_color.rgb, u_color.a * ink);
}
`;

const F82SHIFT = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_center;
uniform float u_radius;
uniform vec4 u_edges; // track start, amber start, red start, rail end in radians
uniform vec2 u_cells; // buildup and red lens counts
uniform float u_night;
uniform float u_build; // illuminated lenses before the amber warning zone
uniform float u_bloom; // 0.6 for normal lit lenses, 1.0 for full-throttle shift assistance

void main() {
    vec2 p = v_uv * u_size - u_center;
    float y = length(p) - u_radius;
    if (abs(y) > 12.3) {
        gl_FragColor = vec4(0.0);
        return;
    }
    float a = atan(p.x, -p.y);
    if (a < u_edges.x || a > u_edges.w) {
        gl_FragColor = vec4(0.0);
        return;
    }

    vec3 amber = mix(vec3(240.0, 184.0, 20.0), vec3(255.0, 203.0, 16.0), u_night);
    vec3 ink;
    float start, end, count;
    if (a < u_edges.y) {
        start = u_edges.x; end = u_edges.y; count = u_cells.x;
        if (a - start >= (end - start) * u_build / max(1.0, count)) {
            gl_FragColor = vec4(0.0);
            return;
        }
        ink = amber;
    } else if (a < u_edges.z) {
        ink = amber;
        start = u_edges.y; end = u_edges.z; count = 1.0;
    } else {
        ink = mix(vec3(255.0, 56.0, 91.0), vec3(255.0, 61.0, 96.0), u_night);
        start = u_edges.z; end = u_edges.w; count = u_cells.y;
    }
    float pitch = (end - start) / max(1.0, count);
    if (pitch <= 0.0) {
        gl_FragColor = vec4(0.0);
        return;
    }
    float width = pitch * u_radius;
    float gap = min(8.0, width * 0.24);
    float x = (fract((a - start) / pitch) - 0.5) * width;
    float halfLength = 0.5 * (width - gap);
    float roundness = min(1.25, halfLength);
    vec2 q = abs(vec2(x, y)) - vec2(halfLength, 4.3) + roundness;
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - roundness;
    float coverage = 1.0 - smoothstep(-0.65, 0.65, dist);
    // A dark perimeter and a very shallow bevel keep the lamps seated in the dial.
    float shoulder = 1.0 - smoothstep(-1.8, -0.3, dist);
    float sheen = 1.0 + 0.04 * (1.0 - smoothstep(-3.7, 0.2, y));
    // Normal lenses have a gentle spill; full-throttle assistance strengthens it.
    // The smooth tail ends within eight pixels; inactive slots still return above.
    // This is analytic coverage, with no extra bitmap or blur pass.
    float outside = max(0.0, dist);
    float halo = u_bloom * mix(0.28, 0.40, u_night)
        * exp(-0.5 * outside * outside / 9.0)
        * (1.0 - smoothstep(5.5, 8.0, outside));
    float alpha = coverage + (1.0 - coverage) * halo;
    vec3 core = ink / 255.0 * mix(0.84, sheen, shoulder);
    core *= 1.0 + 0.06 * u_bloom * shoulder;
    gl_FragColor = vec4(mix(ink / 255.0, core, coverage / max(alpha, 0.0001)), alpha);
}
`;

const F8XARC = `
precision highp float;
varying vec2 v_uv;
uniform vec2 u_size;
uniform vec2 u_center;
uniform vec2 u_radii;
uniform float u_halfAngle;
uniform float u_thickness;
uniform vec4 u_color;
void main() {
    vec2 q = (v_uv * u_size - u_center) / u_radii;
    float scale = min(u_radii.x, u_radii.y);
    float rail = abs(length(q) - 1.0) * scale - u_thickness * 0.5;
    // Zero is screen-down here. Radial cuts leave clean, slanted end faces.
    float ends = (abs(atan(q.x, q.y)) - u_halfAngle) * scale;
    float coverage = 1.0 - smoothstep(-0.65, 0.65, max(rail, ends));
    gl_FragColor = vec4(u_color.rgb, u_color.a * coverage);
}
`;

module.exports = { atext: ATEXT, f82shift: F82SHIFT, f8xarc: F8XARC };
