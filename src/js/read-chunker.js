/**
 * Text chunker for Read mode. Splits arbitrary-length text into ordered chunks
 * bounded by `maxLen`, respecting sentence boundaries. Foundation of "no character
 * limit" — the reader synthesizes one chunk per call.
 *
 * Pure function, no window/Tauri deps (browser- and node-safe).
 */

// Sentence terminators (Latin + Vietnamese punctuation). Kept WITH the sentence.
const SENTENCE_SPLIT = /(?<=[.!?…;])\s+|\n+/;

/**
 * Split `text` into ordered chunks, each ≤ maxLen where possible.
 * A single unbreakable token longer than maxLen is emitted alone (never dropped).
 * Concatenating the chunks reproduces the source words in order.
 *
 * @param {string} text
 * @param {number} maxLen conservative per-provider cap (chars)
 * @returns {string[]}
 */
export function splitIntoChunks(text, maxLen) {
    if (!text || typeof text !== 'string') return [];
    const cap = Number(maxLen) > 0 ? Math.floor(Number(maxLen)) : 120;

    const chunks = [];
    for (const sentence of text.split(SENTENCE_SPLIT)) {
        const s = sentence.trim();
        if (!s) continue;
        if (s.length <= cap) {
            chunks.push(s);
        } else {
            for (const piece of packLongSentence(s, cap)) chunks.push(piece);
        }
    }
    return chunks;
}

/**
 * A sentence longer than `cap`: split on commas first, then spaces, greedily
 * packing sub-parts into ≤ cap pieces. A lone token > cap is emitted alone.
 */
function packLongSentence(sentence, cap) {
    const out = [];
    let buf = '';

    const flush = () => {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
    };

    // Split on commas but keep them attached to the preceding fragment.
    const parts = sentence.split(/(?<=,)\s+/);
    for (const part of parts) {
        if (part.length <= cap) {
            if ((buf + ' ' + part).trim().length <= cap) {
                buf = buf ? `${buf} ${part}` : part;
            } else {
                flush();
                buf = part;
            }
            continue;
        }
        // Comma-part still too long → split on spaces.
        flush();
        for (const word of part.split(/\s+/)) {
            if (!word) continue;
            if (word.length > cap) {
                // Unbreakable token: flush current, emit the token alone (no loss).
                flush();
                out.push(word);
            } else if ((buf + ' ' + word).trim().length <= cap) {
                buf = buf ? `${buf} ${word}` : word;
            } else {
                flush();
                buf = word;
            }
        }
    }
    flush();
    return out;
}
