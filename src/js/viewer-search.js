const highlightName = 'meet-minder-viewer-search';

export function searchRenderedText(root, query, activeIndex = 1) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!root || !needle) return { count: 0, active: 0 };
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            return node.parentElement?.closest('button,header,script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
    });
    const ranges = [];
    let node;
    while ((node = walker.nextNode())) {
        const text = node.nodeValue || '';
        const lower = text.toLocaleLowerCase();
        let offset = 0;
        while ((offset = lower.indexOf(needle, offset)) !== -1) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + needle.length);
            ranges.push(range);
            offset += needle.length;
        }
    }
    if (globalThis.CSS?.highlights && globalThis.Highlight) {
        if (ranges.length) CSS.highlights.set(highlightName, new Highlight(...ranges));
        else CSS.highlights.delete(highlightName);
    }
    const active = ranges.length ? ((activeIndex - 1 + ranges.length) % ranges.length) + 1 : 0;
    if (active) {
        const range = ranges[active - 1];
        if (globalThis.CSS?.highlights && globalThis.Highlight) CSS.highlights.set(`${highlightName}-active`, new Highlight(range));
        range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (globalThis.CSS?.highlights) CSS.highlights.delete(`${highlightName}-active`);
    return { count: ranges.length, active };
}

export function clearRenderedSearch() {
    if (!globalThis.CSS?.highlights) return;
    CSS.highlights.delete(highlightName);
    CSS.highlights.delete(`${highlightName}-active`);
}
