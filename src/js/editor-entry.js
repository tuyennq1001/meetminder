import {
  EditorState,
  StateField,
  StateEffect,
  RangeSetBuilder,
  Compartment,
  Prec,
  EditorSelection,
} from '@codemirror/state';
import {
  EditorView,
  Decoration,
  ViewPlugin,
  WidgetType,
  keymap,
  placeholder,
  drawSelection,
  dropCursor,
} from '@codemirror/view';
import {
  syntaxTree,
  HighlightStyle,
  syntaxHighlighting,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  defaultKeymap,
  history,
  historyKeymap,
} from '@codemirror/commands';
import { tags } from '@lezer/highlight';

// ─── Live Preview Widgets ──────────────────────────────────────

class EmptyWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-md-hidden-syntax';
    span.style.display = 'none';
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

class TaskCheckboxWidget extends WidgetType {
  constructor(checked, from, to, readOnly = false) {
    super();
    this.checked = checked;
    this.from = from;
    this.to = to;
    this.readOnly = readOnly;
  }

  eq(other) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to && other.readOnly === this.readOnly;
  }

  toDOM(view) {
    const wrap = document.createElement('span');
    wrap.className = `cm-md-checkbox-wrap ${this.checked ? 'checked' : ''}`;
    
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-md-checkbox';
    input.checked = this.checked;
    if (this.readOnly) {
      input.disabled = true;
      input.style.cursor = 'default';
    }
    
    input.addEventListener('change', (e) => {
      if (this.readOnly) return;
      e.stopPropagation();
      const newChar = input.checked ? 'x' : ' ';
      const newText = `[${newChar}]`;
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: newText },
      });
    });

    wrap.appendChild(input);
    return wrap;
  }

  ignoreEvent(event) {
    return event.type === 'click' || event.type === 'change';
  }
}

class HorizontalRuleWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr');
    hr.className = 'cm-md-hr';
    return hr;
  }
  ignoreEvent() {
    return false;
  }
}

class BulletWidget extends WidgetType {
  constructor(level = 0) {
    super();
    this.level = level;
  }

  eq(other) {
    return other.level === this.level;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-md-bullet cm-md-bullet-level-${this.level % 3}`;
    const bulletIcons = ['•', '◦', '▪'];
    span.textContent = bulletIcons[this.level % 3] || '•';
    return span;
  }

  ignoreEvent() {
    return false;
  }
}

class ImageWidget extends WidgetType {
  constructor(src, alt) {
    super();
    this.src = src;
    this.alt = alt;
  }

  eq(other) {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-md-image';
    img.src = this.src;
    img.alt = this.alt || 'Pasted image';
    img.loading = 'lazy';
    img.draggable = false;
    return img;
  }

  ignoreEvent() {
    return false;
  }
}

function normaliseExternalUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value || /^attachment:/i.test(value)) return null;
  if (/^(?:https?:\/\/|mailto:|tel:|#)/i.test(value)) return value;
  return `https://${value}`;
}

function openExternalUrl(rawUrl) {
  const url = normaliseExternalUrl(rawUrl);
  if (!url || url.startsWith('#')) return;

  try {
    const opener = window.__TAURI__?.opener;
    if (opener?.openUrl) {
      void opener.openUrl(url);
      return;
    }
  } catch (error) {
    console.warn('[NotesEditor] Failed to open link with Tauri opener:', error);
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

class LinkWidget extends WidgetType {
  constructor(label, url) {
    super();
    this.label = label;
    this.url = url;
  }

  eq(other) {
    return other.label === this.label && other.url === this.url;
  }

  toDOM() {
    const link = document.createElement('a');
    link.className = 'cm-md-link';
    link.textContent = this.label;
    link.href = normaliseExternalUrl(this.url) || '#';
    link.title = this.url;
    link.rel = 'noopener noreferrer';
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openExternalUrl(this.url);
    });
    return link;
  }

  ignoreEvent(event) {
    return event.type === 'click' || event.type === 'mousedown';
  }
}

const refreshImageAssetsEffect = StateEffect.define();

function escapeTableHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitTableRow(line) {
  let content = line.trim();
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|') && !content.endsWith('\\|')) content = content.slice(0, -1);

  const cells = [];
  let cell = '';
  let escaped = false;
  for (const char of content) {
    if (char === '|' && !escaped) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
    escaped = char === '\\' && !escaped;
  }
  cells.push(cell.trim());
  return cells;
}

function formatTableCell(text) {
  const escaped = escapeTableHtml(text.replace(/\\([|*_])/g, '$1'));
  const codeDelimiter = String.fromCharCode(96);
  const codePattern = new RegExp(codeDelimiter + '([^' + codeDelimiter + ']+)' + codeDelimiter, 'g');
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(codePattern, '<code>$1</code>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function getTableAlignment(delimiter) {
  return splitTableRow(delimiter).map((cell) => {
    const value = cell.trim();
    if (value.startsWith(':') && value.endsWith(':')) return 'center';
    if (value.endsWith(':')) return 'right';
    return 'left';
  });
}

class TableWidget extends WidgetType {
  constructor(markdownText) {
    super();
    this.markdownText = markdownText;
  }

  eq(other) {
    return other.markdownText === this.markdownText;
  }

  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-md-table-widget';

    const lines = this.markdownText.split(/\r?\n/);
    const header = splitTableRow(lines[0] || '');
    const alignments = getTableAlignment(lines[1] || '');
    const table = document.createElement('table');
    table.className = 'cm-md-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    header.forEach((cell, index) => {
      const th = document.createElement('th');
      th.style.textAlign = alignments[index] || 'left';
      th.innerHTML = formatTableCell(cell);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const line of lines.slice(2)) {
      if (!line.trim()) continue;
      const row = document.createElement('tr');
      splitTableRow(line).forEach((cell, index) => {
        const td = document.createElement('td');
        td.style.textAlign = alignments[index] || 'left';
        td.innerHTML = formatTableCell(cell);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }

  ignoreEvent() {
    return false;
  }
}

function buildTableDecorations(state) {
  if (!state.readOnly) return Decoration.none;

  const builder = new RangeSetBuilder();
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'Table') {
        builder.add(
          node.from,
          node.to,
          Decoration.replace({
            widget: new TableWidget(state.sliceDoc(node.from, node.to)),
            block: true,
          }),
        );
        return false;
      }
    },
  });
  return builder.finish();
}

const tableDecorationsField = StateField.define({
  create: buildTableDecorations,
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.reconfigured) {
      return buildTableDecorations(transaction.state);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ─── Live Preview ViewPlugin ──────────────────────────────────

function isSelectionOverlapping(selection, from, to) {
  for (const range of selection.ranges) {
    if (range.from <= to && range.to >= from) {
      return true;
    }
  }
  return false;
}

function isLineSelected(selection, line) {
  for (const range of selection.ranges) {
    if (range.from <= line.to && range.to >= line.from) {
      return true;
    }
  }
  return false;
}

function createLivePreviewPlugin(resolveImageAsset = () => null) {
  return ViewPlugin.fromClass(
    class {
    constructor(view) {
      this.decorations = this.buildDecorations(view);
    }

    update(update) {
      const imageAssetsChanged = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshImageAssetsEffect))
      );
      if (update.docChanged || update.selectionSet || update.viewportChanged || imageAssetsChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view) {
      const { doc, selection } = view.state;
      const isReadOnly = Boolean(view.state.readOnly);
      const tree = syntaxTree(view.state);
      const decos = [];
      const decoratedLines = new Set();

      for (const { from, to } of view.visibleRanges) {
        tree.iterate({
          from,
          to,
          enter: (node) => {
            const nodeName = node.name;
            const nodeFrom = node.from;
            const nodeTo = node.to;

            // ─── 1. Headings (ATXHeading1 .. ATXHeading6) ───
            if (nodeName.startsWith('ATXHeading')) {
              const levelStr = nodeName.replace('ATXHeading', '');
              const level = parseInt(levelStr, 10) || 1;
              const line = doc.lineAt(nodeFrom);
              const isFocused = !isReadOnly && isLineSelected(selection, line);

              if (!decoratedLines.has(line.from)) {
                decoratedLines.add(line.from);
                decos.push({
                  from: line.from,
                  to: line.from,
                  deco: Decoration.line({
                    class: `cm-md-heading cm-md-heading-${level}${isFocused ? ' cm-md-heading-active' : ''}`,
                  }),
                });
              }

              // Hide heading marker (e.g. "## ") when line is not focused
              if (!isFocused) {
                const lineText = line.text;
                const match = lineText.match(/^(#{1,6}\s+)/);
                if (match) {
                  const markerLen = match[1].length;
                  decos.push({
                    from: line.from,
                    to: line.from + markerLen,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                }
              }
              return;
            }

            // ─── 2. Bold (StrongEmphasis) ───
            if (nodeName === 'StrongEmphasis') {
              const isOverlapping = !isReadOnly && isSelectionOverlapping(selection, nodeFrom, nodeTo);
              const markerLen = 2;

              if (nodeTo - nodeFrom >= markerLen * 2) {
                if (!isOverlapping) {
                  decos.push({
                    from: nodeFrom,
                    to: nodeFrom + markerLen,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                  decos.push({
                    from: nodeFrom + markerLen,
                    to: nodeTo - markerLen,
                    deco: Decoration.mark({ class: 'cm-md-bold' }),
                  });
                  decos.push({
                    from: nodeTo - markerLen,
                    to: nodeTo,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                } else {
                  decos.push({
                    from: nodeFrom,
                    to: nodeTo,
                    deco: Decoration.mark({ class: 'cm-md-bold' }),
                  });
                }
              }
              return false;
            }

            // ─── 3. Italic (Emphasis) ───
            if (nodeName === 'Emphasis') {
              const isOverlapping = !isReadOnly && isSelectionOverlapping(selection, nodeFrom, nodeTo);
              const markerLen = 1;

              if (nodeTo - nodeFrom >= markerLen * 2) {
                if (!isOverlapping) {
                  decos.push({
                    from: nodeFrom,
                    to: nodeFrom + markerLen,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                  decos.push({
                    from: nodeFrom + markerLen,
                    to: nodeTo - markerLen,
                    deco: Decoration.mark({ class: 'cm-md-italic' }),
                  });
                  decos.push({
                    from: nodeTo - markerLen,
                    to: nodeTo,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                } else {
                  decos.push({
                    from: nodeFrom,
                    to: nodeTo,
                    deco: Decoration.mark({ class: 'cm-md-italic' }),
                  });
                }
              }
              return false;
            }

            // ─── 4. Strikethrough ───
            if (nodeName === 'Strikethrough') {
              const isOverlapping = !isReadOnly && isSelectionOverlapping(selection, nodeFrom, nodeTo);
              const markerLen = 2;

              if (nodeTo - nodeFrom >= markerLen * 2) {
                if (!isOverlapping) {
                  decos.push({
                    from: nodeFrom,
                    to: nodeFrom + markerLen,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                  decos.push({
                    from: nodeFrom + markerLen,
                    to: nodeTo - markerLen,
                    deco: Decoration.mark({ class: 'cm-md-strikethrough' }),
                  });
                  decos.push({
                    from: nodeTo - markerLen,
                    to: nodeTo,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                } else {
                  decos.push({
                    from: nodeFrom,
                    to: nodeTo,
                    deco: Decoration.mark({ class: 'cm-md-strikethrough' }),
                  });
                }
              }
              return false;
            }

            // ─── 5. Inline Code ───
            if (nodeName === 'InlineCode') {
              const isOverlapping = !isReadOnly && isSelectionOverlapping(selection, nodeFrom, nodeTo);
              if (nodeTo - nodeFrom >= 2) {
                if (!isOverlapping) {
                  decos.push({
                    from: nodeFrom,
                    to: nodeFrom + 1,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                  decos.push({
                    from: nodeFrom + 1,
                    to: nodeTo - 1,
                    deco: Decoration.mark({ class: 'cm-md-inline-code' }),
                  });
                  decos.push({
                    from: nodeTo - 1,
                    to: nodeTo,
                    deco: Decoration.replace({ widget: new EmptyWidget() }),
                  });
                } else {
                  decos.push({
                    from: nodeFrom,
                    to: nodeTo,
                    deco: Decoration.mark({ class: 'cm-md-inline-code' }),
                  });
                }
              }
              return false;
            }

            // ─── 6. Task Markers (Checklist: - [ ] or - [x]) ───
            if (nodeName === 'TaskMarker') {
              const text = doc.sliceString(nodeFrom, nodeTo);
              const checked = /\[[xX]\]/.test(text);
              decos.push({
                from: nodeFrom,
                to: nodeTo,
                deco: Decoration.replace({
                  widget: new TaskCheckboxWidget(checked, nodeFrom, nodeTo, isReadOnly),
                }),
              });
              if (checked) {
                const line = doc.lineAt(nodeFrom);
                decos.push({
                  from: nodeTo,
                  to: line.to,
                  deco: Decoration.mark({ class: 'cm-md-task-done' }),
                });
              }
              return false;
            }

            // ─── 7. Bullet Lists (ListMark: - or * or +) ───
            if (nodeName === 'ListMark') {
              const text = doc.sliceString(nodeFrom, nodeTo);
              if (/^[-*+]$/.test(text)) {
                const line = doc.lineAt(nodeFrom);
                const afterMarker = doc.sliceString(nodeTo, line.to);
                const isTask = /^\s*\[[ xX]\]/.test(afterMarker);
                if (!isTask) {
                  const isOverlapping = !isReadOnly && isSelectionOverlapping(selection, nodeFrom, nodeTo);
                  if (!isOverlapping) {
                    const leadingSpaces = (line.text.match(/^(\s*)/)?.[1] || '').length;
                    const level = Math.floor(leadingSpaces / 4);
                    decos.push({
                      from: nodeFrom,
                      to: nodeTo,
                      deco: Decoration.replace({
                        widget: new BulletWidget(level),
                      }),
                    });
                  }
                }
              }
              return false;
            }

            // Render links as clickable labels while the line is not being edited.
            if (nodeName === 'Link') {
              const line = doc.lineAt(nodeFrom);
              const isFocused = !isReadOnly && isLineSelected(selection, line);
              if (!isFocused) {
                const raw = doc.sliceString(nodeFrom, nodeTo);
                const match = raw.match(/^\[([\s\S]*?)\]\(([^)\s]+)(?:\s+["'][\s\S]*?["'])?\)$/);
                if (match) {
                  decos.push({
                    from: nodeFrom,
                    to: nodeTo,
                    deco: Decoration.replace({ widget: new LinkWidget(match[1], match[2]) }),
                  });
                }
              }
              return false;
            }

            // Render pasted images while the line is not being edited. New
            // images use a short attachment token; legacy notes may still use
            // an inline data URI.
            if (nodeName === 'Image' && !isSelectionOverlapping(selection, nodeFrom, nodeTo)) {
              const raw = doc.sliceString(nodeFrom, nodeTo);
              const legacyMatch = raw.match(/^!\[([^\]]*)\]\((data:image\/[a-z0-9.+-]+;base64,[^)]+)\)$/i);
              const attachmentMatch = raw.match(/^!\[([^\]]*)\]\(attachment:([a-z0-9_-]+)\)$/i);
              const asset = attachmentMatch ? resolveImageAsset(attachmentMatch[2]) : null;
              const src = legacyMatch?.[2] || asset?.data_url || asset?.dataUrl;
              const alt = legacyMatch?.[1] || attachmentMatch?.[1];
              if (src && alt !== undefined) {
                decos.push({
                  from: nodeFrom,
                  to: nodeTo,
                  deco: Decoration.replace({ widget: new ImageWidget(src, alt) }),
                });
              }
              return false;
            }

            // ─── 8. Horizontal Rules (---) ───
            if (nodeName === 'HorizontalRule') {
              const line = doc.lineAt(nodeFrom);
              const isFocused = !isReadOnly && isLineSelected(selection, line);
              if (!isFocused) {
                decos.push({
                  from: nodeFrom,
                  to: nodeTo,
                  deco: Decoration.replace({
                    widget: new HorizontalRuleWidget(),
                  }),
                });
              }
              return false;
            }

            // ─── 8. Blockquote ───
            if (nodeName === 'Blockquote') {
              const line = doc.lineAt(nodeFrom);
              if (!decoratedLines.has(line.from)) {
                decoratedLines.add(line.from);
                decos.push({
                  from: line.from,
                  to: line.from,
                  deco: Decoration.line({ class: 'cm-md-blockquote' }),
                });
              }
            }

            // ─── 9. Code Block ───
            if (nodeName === 'FencedCode' || nodeName === 'CodeBlock') {
              const startLine = doc.lineAt(nodeFrom).number;
              const endLine = doc.lineAt(nodeTo).number;
              for (let l = startLine; l <= endLine; l++) {
                const lineObj = doc.line(l);
                if (!decoratedLines.has(lineObj.from)) {
                  decoratedLines.add(lineObj.from);
                  decos.push({
                    from: lineObj.from,
                    to: lineObj.from,
                    deco: Decoration.line({ class: 'cm-md-code-block-line' }),
                  });
                }
              }
            }

          },
        });
      }

      // Sort decorations by start pos (from), then by type (line decorations first, then marks/replaces)
      decos.sort((a, b) => {
        if (a.from !== b.from) return a.from - b.from;
        if (a.to !== b.to) return a.to - b.to;
        return 0;
      });

      const builder = new RangeSetBuilder();
      for (const item of decos) {
        builder.add(item.from, item.to, item.deco);
      }

      return builder.finish();
    }
  },
  {
    decorations: (v) => v.decorations,
  }
  );
}

// ─── Smart List Keymaps (Enter, Tab, Shift-Tab) ────────────────

const smartListKeymap = [
  {
    key: 'Enter',
    run: (view) => {
      const { state, dispatch } = view;
      const { doc, selection } = state;
      const { main } = selection;
      if (!main.empty) return false;

      const line = doc.lineAt(main.head);
      const lineText = line.text;
      const posInLine = main.head - line.from;
      const textBeforeCursor = lineText.slice(0, posInLine);

      // Matches: "  - [ ] ", "  * [x] ", "  - ", "  * ", "  1. "
      const match = textBeforeCursor.match(/^(\s*)([-*+]|\d+\.)(\s+\[[ xX]\])?(\s+)(.*)$/);
      if (!match) return false;

      const indent = match[1];
      const bullet = match[2];
      const taskMarker = match[3];
      const space = match[4];
      const content = match[5];

      // If bullet line is empty (user hit Enter on empty bullet) -> unindent or clear bullet
      if (!content.trim()) {
        if (indent.length >= 4) {
          const newIndent = indent.slice(4);
          const fullPrefix = `${newIndent}${bullet}${taskMarker || ''}${space}`;
          dispatch({
            changes: { from: line.from, to: line.to, insert: fullPrefix },
            selection: { anchor: line.from + fullPrefix.length },
          });
          return true;
        } else {
          dispatch({
            changes: { from: line.from, to: line.to, insert: '' },
            selection: { anchor: line.from },
          });
          return true;
        }
      }

      // Continue list on next line
      let nextPrefix = '';
      if (/^\d+\.$/.test(bullet)) {
        const num = parseInt(bullet, 10) + 1;
        nextPrefix = `${indent}${num}.${space}`;
      } else if (taskMarker) {
        nextPrefix = `${indent}${bullet} [ ] `;
      } else {
        nextPrefix = `${indent}${bullet}${space}`;
      }

      dispatch({
        changes: { from: main.head, to: main.head, insert: `\n${nextPrefix}` },
        selection: { anchor: main.head + 1 + nextPrefix.length },
      });
      return true;
    },
  },
  {
    key: 'Tab',
    run: (view) => {
      const { state, dispatch } = view;
      const { doc, selection } = state;
      const { main } = selection;
      const line = doc.lineAt(main.head);
      const lineText = line.text;

      const match = lineText.match(/^(\s*)([-*+]|\d+\.)/);
      if (match || !main.empty) {
        const startLine = doc.lineAt(main.from).number;
        const endLine = doc.lineAt(main.to).number;
        const changes = [];
        for (let l = startLine; l <= endLine; l++) {
          const lineObj = doc.line(l);
          changes.push({ from: lineObj.from, to: lineObj.from, insert: '    ' });
        }
        dispatch({
          changes,
          selection: {
            anchor: main.anchor + 4,
            head: main.head + (main.head >= main.anchor ? 4 * (endLine - startLine + 1) : 4),
          },
        });
        return true;
      }
      
      dispatch({
        changes: { from: main.from, to: main.to, insert: '    ' },
        selection: { anchor: main.from + 4 },
      });
      return true;
    },
  },
  {
    key: 'Shift-Tab',
    run: (view) => {
      const { state, dispatch } = view;
      const { doc, selection } = state;
      const { main } = selection;
      const startLine = doc.lineAt(main.from).number;
      const endLine = doc.lineAt(main.to).number;
      const changes = [];

      for (let l = startLine; l <= endLine; l++) {
        const lineObj = doc.line(l);
        const text = lineObj.text;
        let removeLen = 0;
        if (text.startsWith('    ')) removeLen = 4;
        else if (text.startsWith(' ')) removeLen = 1;

        if (removeLen > 0) {
          changes.push({ from: lineObj.from, to: lineObj.from + removeLen, insert: '' });
        }
      }

      if (changes.length > 0) {
        dispatch({ changes });
        return true;
      }
      return false;
    },
  },
  {
    // On list items, Cmd/Ctrl+Left should land before the list marker rather
    // than at the absolute start of the line (inside the indentation).
    key: 'Mod-ArrowLeft',
    run: (view) => {
      const { state, dispatch } = view;
      const { main } = state.selection;
      if (!main.empty) return false;
      const line = state.doc.lineAt(main.head);
      const match = line.text.match(/^(\s*)([-*+]|\d+\.)\s+/);
      if (!match) return false;
      const markerStart = line.from + match[1].length;
      if (main.head <= markerStart) return false;
      dispatch({ selection: { anchor: markerStart } });
      return true;
    },
  },
  {
    key: 'Mod-b',
    run: (view) => {
      wrapSelection(view, '**', '**');
      return true;
    },
  },
  {
    key: 'Mod-i',
    run: (view) => {
      wrapSelection(view, '*', '*');
      return true;
    },
  },
  {
    key: 'Mod-k',
    run: (view) => {
      const { state } = view;
      const { main } = state.selection;
      const selText = state.sliceDoc(main.from, main.to);
      if (selText) {
        const insert = `[${selText}](https://)`;
        const urlStart = main.from + selText.length + 3;
        view.dispatch({
          changes: { from: main.from, to: main.to, insert },
          selection: { anchor: urlStart, head: urlStart + 8 },
        });
      } else {
        view.dispatch({
          changes: { from: main.from, to: main.to, insert: '[tiêu đề](https://)' },
          selection: { anchor: main.from + 11, head: main.from + 19 },
        });
      }
      return true;
    },
  },
];

function findMarkdownLinkAt(state, position) {
  const line = state.doc.lineAt(position);
  const pattern = /\[([^\]]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
  let match;
  while ((match = pattern.exec(line.text))) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (position >= from && position <= to) {
      return { from, to, url: match[2] };
    }
  }
  return null;
}

function wrapSelection(view, before, after) {
  const { state, dispatch } = view;
  const { main } = state.selection;
  const text = state.sliceDoc(main.from, main.to);

  if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
    const unwrapped = text.slice(before.length, text.length - after.length);
    dispatch({
      changes: { from: main.from, to: main.to, insert: unwrapped },
      selection: { anchor: main.from, head: main.from + unwrapped.length },
    });
  } else {
    const wrapped = `${before}${text}${after}`;
    dispatch({
      changes: { from: main.from, to: main.to, insert: wrapped },
      selection: {
        anchor: main.from + before.length,
        head: main.from + before.length + text.length,
      },
    });
  }
}

// ─── Theme & Syntax Highlighting ───────────────────────────────

const meetMinderDarkTheme = EditorView.theme(
  {
    '&': {
      color: '#f4f4f5',
      backgroundColor: 'transparent',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", sans-serif',
      fontSize: 'var(--note-font-size, 14px)',
      lineHeight: '1.65',
      height: '100%',
    },
    '.cm-content': {
      caretColor: '#d9b0de',
      padding: '8px 12px',
      minHeight: '100%',
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#d9b0de',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(126, 62, 135, 0.35) !important',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'rgba(126, 62, 135, 0.2)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.025)',
    },
    '.cm-scroller': {
      overflowY: 'auto',
      overflowX: 'hidden',
      fontFamily: 'inherit',
    },
    '.cm-placeholder': {
      color: '#71717a',
      fontStyle: 'italic',
    },
    '.cm-line': {
      padding: '1px 0',
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    },
  },
  { dark: true }
);

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, color: '#ffffff', fontWeight: '700' },
  { tag: tags.heading2, color: '#e4e4e7', fontWeight: '600' },
  { tag: tags.heading3, color: '#d4d4d8', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700', color: '#fef08a' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#d9b0de' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: '#71717a' },
  { tag: tags.monospace, color: '#c88dce', fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
  { tag: tags.link, color: '#d9b0de', textDecoration: 'underline' },
  { tag: tags.quote, color: '#a1a1aa', fontStyle: 'italic' },
]);

// ─── Public NotesEditor API ────────────────────────────────────

export class NotesEditor {
  constructor(options = {}) {
    this.options = options;
    this.container = null;
    this.view = null;
    this.readOnlyCompartment = new Compartment();
    this.placeholderCompartment = new Compartment();
    this.lineWrappingCompartment = new Compartment();
    this.imageAssets = new Map();
  }

  mount(container, { initialContent = '', imageAssets = [], readOnly = false, placeholderText = 'Nhập ghi chú...', lineWrapping = true, onChange = null, onSave = null, onCancel = null, allowImagePaste = false } = {}) {
    this.container = container;
    this.onChange = onChange;
    this.onSave = onSave;
    this.onCancel = onCancel;
    this.imageAssets = new Map(
      (Array.isArray(imageAssets) ? imageAssets : [])
        .filter((asset) => asset && asset.id)
        .map((asset) => [asset.id, asset])
    );

    const actionKeymap = [];
    if (this.onSave) {
      actionKeymap.push({
        key: 'Mod-s',
        run: () => {
          this.onSave();
          return true;
        },
      });
    }
    if (this.onCancel) {
      actionKeymap.push({
        key: 'Escape',
        run: () => {
          this.onCancel();
          return true;
        },
      });
    }

    const startState = EditorState.create({
      doc: initialContent || '',
      extensions: [
        meetMinderDarkTheme,
        this.lineWrappingCompartment.of(lineWrapping !== false ? EditorView.lineWrapping : []),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(markdownHighlightStyle),
        tableDecorationsField,
        createLivePreviewPlugin((id) => this.imageAssets.get(id)),
        Prec.highest(keymap.of(smartListKeymap)),
        keymap.of([...actionKeymap, ...defaultKeymap, ...historyKeymap]),
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.domEventHandlers({
          click: (event, view) => {
            if (!event.metaKey && !event.ctrlKey) return false;
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            const link = pos === null ? null : findMarkdownLinkAt(view.state, pos);
            if (!link) return false;
            event.preventDefault();
            event.stopPropagation();
            openExternalUrl(link.url);
            return true;
          },
        }),
        ...(allowImagePaste ? [EditorView.domEventHandlers({
          paste: (event, view) => {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItem = items.find(item => item.kind === 'file' && /^image\//i.test(item.type));
            if (!imageItem) return false;
            const file = imageItem.getAsFile();
            if (!file) return false;
            if (file.size > 2 * 1024 * 1024) {
              this.options?.onImagePasteError?.('Ảnh quá lớn (tối đa 2 MB)');
              return true;
            }
            event.preventDefault();
            const reader = new FileReader();
            reader.onload = () => {
              const { main } = view.state.selection;
              const alt = (file.name || 'Pasted image').replace(/[\[\]]/g, '').replace(/\r?\n/g, ' ').trim();
              const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
              const asset = {
                id,
                alt: alt || 'Pasted image',
                data_url: String(reader.result || ''),
              };
              this.imageAssets.set(id, asset);
              this.options?.onImagePaste?.(asset);
              const text = `![${asset.alt}](attachment:${id})`;
              view.dispatch({
                changes: { from: main.from, to: main.to, insert: text },
                selection: { anchor: main.from + text.length },
              });
              view.focus();
            };
            reader.readAsDataURL(file);
            return true;
          },
        })] : []),
        this.readOnlyCompartment.of(EditorState.readOnly.of(readOnly)),
        this.placeholderCompartment.of(placeholder(placeholderText)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && typeof this.onChange === 'function') {
            this.onChange(update.state.doc.toString());
          }
        }),
      ],
    });

    this.view = new EditorView({
      state: startState,
      parent: container,
    });

    return this;
  }

  setImageAssets(assets = []) {
    this.imageAssets = new Map(
      (Array.isArray(assets) ? assets : [])
        .filter((asset) => asset && asset.id)
        .map((asset) => [asset.id, asset])
    );
    if (this.view) {
      this.view.dispatch({ effects: refreshImageAssetsEffect.of(null) });
    }
  }

  getImageAssets() {
    return Array.from(this.imageAssets.values());
  }

  setLineWrapping(enabled) {
    if (!this.view) return;
    this.view.dispatch({
      effects: this.lineWrappingCompartment.reconfigure(enabled ? EditorView.lineWrapping : []),
    });
  }

  getContent() {
    return this.view ? this.view.state.doc.toString() : '';
  }

  setContent(text) {
    if (!this.view) return;
    const currentText = this.getContent();
    if (currentText === text) return;

    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: text || '',
      },
    });
  }

  insertText(text) {
    if (!this.view) return;
    const { main } = this.view.state.selection;
    this.view.dispatch({
      changes: { from: main.from, to: main.to, insert: text },
      selection: { anchor: main.from + text.length },
    });
    this.view.focus();
  }

  applyFormat(fmt) {
    if (!this.view || this.isReadOnly()) return;
    const view = this.view;
    const { state, dispatch } = view;
    const { main } = state.selection;
    const selText = state.sliceDoc(main.from, main.to);

    switch (fmt) {
      case 'bold':
        wrapSelection(view, '**', '**');
        break;
      case 'italic':
        wrapSelection(view, '*', '*');
        break;
      case 'h1': {
        const line = state.doc.lineAt(main.head);
        const lineText = line.text.replace(/^#{1,6}\s+/, '');
        dispatch({
          changes: { from: line.from, to: line.to, insert: `# ${lineText}` },
          selection: { anchor: line.from + 2 + (selText ? selText.length : lineText.length) },
        });
        break;
      }
      case 'h2': {
        const line = state.doc.lineAt(main.head);
        const lineText = line.text.replace(/^#{1,6}\s+/, '');
        dispatch({
          changes: { from: line.from, to: line.to, insert: `## ${lineText}` },
          selection: { anchor: line.from + 3 + (selText ? selText.length : lineText.length) },
        });
        break;
      }
      case 'list': {
        const line = state.doc.lineAt(main.head);
        const match = line.text.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (match) {
          const cleanText = match[1] + match[3];
          dispatch({
            changes: { from: line.from, to: line.to, insert: cleanText },
          });
        } else {
          dispatch({
            changes: { from: line.from, to: line.from, insert: '- ' },
          });
        }
        break;
      }
      case 'todo': {
        const line = state.doc.lineAt(main.head);
        const match = line.text.match(/^(\s*)([-*+]\s+\[[ xX]\]\s+)?(.*)$/);
        if (match && match[2]) {
          const cleanText = match[1] + (match[3] || '');
          dispatch({
            changes: { from: line.from, to: line.to, insert: cleanText },
          });
        } else {
          dispatch({
            changes: { from: line.from, to: line.from, insert: '- [ ] ' },
          });
        }
        break;
      }
      case 'code':
        if (selText.includes('\n')) {
          wrapSelection(view, '```\n', '\n```');
        } else {
          wrapSelection(view, '`', '`');
        }
        break;
      case 'link': {
        const label = selText || 'liên kết';
        const insert = `[${label}](https://)`;
        const urlStart = main.from + label.length + 3;
        dispatch({
          changes: { from: main.from, to: main.to, insert },
          selection: { anchor: urlStart, head: urlStart + 8 },
        });
        break;
      }
      default:
        break;
    }
    view.focus();
  }

  setReadOnly(readOnly) {
    if (!this.view) return;
    this.view.dispatch({
      effects: this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }

  isReadOnly() {
    return this.view ? this.view.state.readOnly : false;
  }

  focus() {
    if (this.view) {
      this.view.focus();
    }
  }

  destroy() {
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
  }
}
