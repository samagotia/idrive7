'use strict';

(async function () {
    const get = (id) => document.getElementById(id);
    const gallery = get('design-gallery');
    const editor = get('studio-editor');
    const form = get('widget-form');
    const picker = get('draft-widget');
    const base = get('draft-base');
    const editButton = get('edit-draft');
    const status = get('studio-status');
    const editStatus = get('edit-status');
    const buttons = new Map();
    let chosen = 'our_m4';
    let draft = null;
    let busy = false;

    function updateDialControls() {
        const draftWidgets = chosen === 'our_m4' && draft ? draft.widgets : [];
        get('f82-lighting-control').hidden = !draftWidgets.some((w) => w.nightAsset);
        get('f82-engine-control').hidden = !draftWidgets.some((w) => w.shiftTrack);
        const hasF82Speed = draftWidgets.some((w) => w.asset === 'speed-face');
        get('f82-readout-controls').hidden = !hasF82Speed;
        get('f82-ready-control').hidden = !hasF82Speed;
        get('f82-turn-control').hidden = !hasF82Speed;
    }

    async function request(url, body) {
        const options = body === undefined ? {} : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        };
        const response = await fetch(url, options);
        if (response.status === 204) return null;
        const value = await response.json().catch(() => null);
        if (!response.ok) throw new Error(value?.error || 'Preview is still starting. Try again in a moment.');
        return value;
    }

    function selectDesign(id) {
        chosen = id;
        for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(id === key));
        const button = buttons.get(id);
        if (button) get('active-design').textContent = button.lastElementChild.textContent;
        if (id !== 'our_m4') editor.hidden = true;
        updateDialControls();
    }

    async function run(action, message = status) {
        if (busy) return;
        busy = true;
        message.textContent = '';
        editButton.disabled = true;
        for (const button of buttons.values()) button.disabled = true;
        try {
            await action();
        } catch (error) {
            message.textContent = error.message;
        } finally {
            busy = false;
            editButton.disabled = false;
            for (const button of buttons.values()) button.disabled = false;
        }
    }

    async function showDesign(id) {
        await request('/setting', { key: 'hudLayout', value: id });
        selectDesign(id);
        if (id === 'our_m4') {
            setDraft(await request('/studio-layout'));
            editor.hidden = false;
        }
    }

    function setDraft(value) {
        const previous = picker.value;
        draft = value;
        updateDialControls();
        buttons.get('our_m4').firstElementChild.src = '/design-image/' + (draft.sourceDesign || 'our_m4') + '.png';
        picker.replaceChildren(...draft.widgets.map((widget) => new Option(widget.id.replaceAll('_', ' '), widget.id)));
        const fallback = draft.widgets.find((widget) => typeof widget.text === 'string') || draft.widgets[0];
        picker.value = draft.widgets.some((widget) => widget.id === previous) ? previous : (fallback?.id || '');
        showWidget();
    }

    function showWidget() {
        const widget = draft?.widgets.find((item) => item.id === picker.value);
        if (!widget) return;
        for (const key of ['x', 'y', 'w', 'h']) form.elements[key].value = widget[key];
        const showText = typeof widget.text === 'string';
        get('widget-text-label').hidden = !showText;
        form.elements.text.value = showText ? widget.text : '';
    }

    document.addEventListener('studio-settings', ({ detail }) => {
        if (typeof detail.hudLayout === 'string') selectDesign(detail.hudLayout);
    });

    try {
        const designs = await request('/studio-designs');
        if (!Array.isArray(designs)) return;
        for (const [id, label] of designs) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'design-card';
            const image = document.createElement('img');
            image.src = '/design-image/' + id + '.png';
            image.alt = '';
            const name = document.createElement('span');
            name.textContent = label;
            button.append(image, name);
            button.onclick = () => run(() => showDesign(id));
            gallery.append(button);
            buttons.set(id, button);
        }
        base.replaceChildren(...designs.map(([id, label]) => new Option(label, id)));
        selectDesign(chosen);
        get('studio-designs').hidden = false;
        setDraft(await request('/studio-layout'));
    } catch (error) {
        return;
    }

    editButton.onclick = () => run(async () => {
        if (chosen !== 'our_m4') base.value = chosen;
        await showDesign('our_m4');
        editor.scrollIntoView({ block: 'nearest' });
    });
    picker.onchange = showWidget;
    get('copy-layout').onsubmit = (event) => {
        event.preventDefault();
        run(async () => {
            setDraft(await request('/studio-layout', { base: base.value }));
            editStatus.textContent = 'Starting design copied to F8X.';
        }, editStatus);
    };
    form.onsubmit = (event) => {
        event.preventDefault();
        run(async () => {
            const update = { widget: picker.value, text: form.elements.text.value };
            for (const key of ['x', 'y', 'w', 'h']) update[key] = form.elements[key].valueAsNumber;
            setDraft(await request('/studio-layout', update));
            editStatus.textContent = 'Saved to F8X.';
        }, editStatus);
    };
})();
