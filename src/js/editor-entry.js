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

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = this.buildDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
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
                    const level = Math.floor(leadingSpaces / 2);
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
        if (indent.length >= 2) {
          const newIndent = indent.slice(2);
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
          changes.push({ from: lineObj.from, to: lineObj.from, insert: '  ' });
        }
        dispatch({
          changes,
          selection: {
            anchor: main.anchor + 2,
            head: main.head + (main.head >= main.anchor ? 2 * (endLine - startLine + 1) : 2),
          },
        });
        return true;
      }
      
      dispatch({
        changes: { from: main.from, to: main.to, insert: '  ' },
        selection: { anchor: main.from + 2 },
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
        if (text.startsWith('  ')) removeLen = 2;
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
        wrapSelection(view, '[', '](https://)');
      } else {
        view.dispatch({
          changes: { from: main.from, to: main.to, insert: '[tiêu đề](url)' },
          selection: { anchor: main.from + 1, head: main.from + 8 },
        });
      }
      return true;
    },
  },
];

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
      overflow: 'auto',
      fontFamily: 'inherit',
    },
    '.cm-placeholder': {
      color: '#71717a',
      fontStyle: 'italic',
    },
    '.cm-line': {
      padding: '1px 0',
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
  }

  mount(container, { initialContent = '', readOnly = false, placeholderText = 'Nhập ghi chú...', onChange = null, onSave = null, onCancel = null } = {}) {
    this.container = container;
    this.onChange = onChange;
    this.onSave = onSave;
    this.onCancel = onCancel;

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
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(markdownHighlightStyle),
        livePreviewPlugin,
        keymap.of([...actionKeymap, ...smartListKeymap, ...defaultKeymap, ...historyKeymap]),
        history(),
        drawSelection(),
        dropCursor(),
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
