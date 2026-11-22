'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const bounds = { x: 1920, y: 720, w: 1920, h: 720 };

function json(res, value, status = 200) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
    return true;
}

function file(res, name, type) {
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    fs.createReadStream(name).pipe(res);
    return true;
}

module.exports = ({ root, appDir, dataDir, stage, release }) => {
    const designs = release.layouts.map((id) => [id,
        JSON.parse(fs.readFileSync(path.join(appDir, 'cluster/layouts', id + '.json'), 'utf8')).name]);
    const originals = new Set(designs.map(([id]) => id));
    const layoutDir = path.join(dataDir, 'layouts');
    const draft = path.join(layoutDir, 'our_m4.json');
    const starter = path.join(appDir, 'cluster', 'layouts', 'our_m4.json');
    const readDraft = () => fs.readFileSync(fs.existsSync(draft) ? draft : starter, 'utf8');

    function saveDraft(value) {
        const Layouts = require(path.join(stage, 'source', 'javascript', 'f8x_layouts.js'));
        Layouts.prototype._validate.call({ size: [1920, 720] }, value, 'our_m4');
        fs.mkdirSync(layoutDir, { recursive: true });
        const before = readDraft();
        const after = JSON.stringify(value, null, 2) + '\n';
        if (after === before) return;
        const history = path.join(dataDir, 'layout-history');
        fs.mkdirSync(history, { recursive: true });
        fs.writeFileSync(path.join(history, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.json'), before);
        const temp = draft + '.tmp';
        fs.writeFileSync(temp, after);
        fs.renameSync(temp, draft);
    }

    return async (req, res, url, readBody, running) => {
        const get = req.method === 'GET';
        if (get && url === '/studio-status') return json(res, { studio: 'm4-cluster-studio', app: release.id, title: release.title, running });
        if (get && url === '/studio-designs') return json(res, designs);
        if (get && url === '/studio.css') return file(res, path.join(__dirname, 'studio.css'), 'text/css; charset=utf-8');
        if (get && url === '/studio.js') return file(res, path.join(__dirname, 'studio.js'), 'text/javascript; charset=utf-8');
        const photo = /^\/design-image\/([a-z0-9_]+)\.png$/.exec(url);
        if (get && photo && (originals.has(photo[1]) || photo[1] === 'f82')) {
            return file(res, path.join(root, 'docs', 'preview-day.jpg'), 'image/jpeg');
        }
        if (url !== '/studio-layout') return false;
        try {
            if (get) return json(res, Object.assign(JSON.parse(readDraft()), { name: 'F8X' }));
            if (req.method !== 'POST') return json(res, { error: 'Choose a layout or save an edit.' }, 405);
            if (!running) return json(res, { error: 'Wait for the preview to finish starting.' }, 503);
            const update = await readBody(req);
            let value;
            if (update.base !== undefined) {
                const base = update.base === 'f82' ? 'our_m4' : update.base;
                if (!originals.has(base)) return json(res, { error: 'Choose an existing design first.' }, 400);
                const name = path.join(appDir, 'cluster', 'layouts', base + '.json');
                value = JSON.parse(fs.readFileSync(name, 'utf8'));
                value.sourceDesign = base;
                if (base !== 'our_m4') value._about = 'Local Mac preview draft based on bimmer-lab ' + base + '.';
            } else {
                value = JSON.parse(readDraft());
                const widget = value.widgets.find((item) => item.id === update.widget);
                if (!widget) return json(res, { error: 'Choose a widget to edit.' }, 400);
                const old = { x: widget.x, y: widget.y, w: widget.w, h: widget.h };
                for (const [key, max] of Object.entries(bounds)) {
                    const n = update[key];
                    const min = key === 'w' || key === 'h' ? 1 : 0;
                    if (!Number.isInteger(n) || n < min || n > max) {
                        return json(res, { error: 'Use whole pixel values within the 1920 × 720 canvas.' }, 400);
                    }
                    widget[key] = n;
                }
                // Moving or resizing an F82 face keeps its needle hub attached.
                if (widget.type === 'f82sprite' && widget.id.endsWith('_face')) {
                    const needle = value.widgets.find((item) => item.id === widget.id.replace(/_face$/, '_needle'));
                    if (needle) {
                        const sx = widget.w / old.w, sy = widget.h / old.h;
                        needle.x = Math.round(widget.x + (needle.x - old.x) * sx);
                        needle.y = Math.round(widget.y + (needle.y - old.y) * sy);
                        needle.w = Math.max(1, Math.round(needle.w * sx));
                        needle.h = Math.max(1, Math.round(needle.h * sy));
                    }
                }
                if (typeof widget.text === 'string' && typeof update.text === 'string') widget.text = update.text.slice(0, 160);
            }
            value.name = 'F8X';
            saveDraft(value);
            return json(res, value);
        } catch (error) {
            return json(res, { error: error.message }, 400);
        }
    };
};
