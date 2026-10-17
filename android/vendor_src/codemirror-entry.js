import {EditorState, Compartment} from "@codemirror/state";
import {EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor} from "@codemirror/view";
import {defaultKeymap, history, historyKeymap, indentMore, indentLess, undo, redo, undoDepth, redoDepth, cursorLineUp, cursorLineDown, selectAll} from "@codemirror/commands";
import {syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, StreamLanguage, indentUnit} from "@codemirror/language";
import {closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap} from "@codemirror/autocomplete";
import {highlightSelectionMatches} from "@codemirror/search";
import {tags as t} from "@lezer/highlight";
import {javascript} from "@codemirror/lang-javascript";
import {html} from "@codemirror/lang-html";
import {css} from "@codemirror/lang-css";
import {python} from "@codemirror/lang-python";
import {cpp} from "@codemirror/lang-cpp";
import {java} from "@codemirror/lang-java";
import {sql, SQLite} from "@codemirror/lang-sql";
import {shell} from "@codemirror/legacy-modes/mode/shell";

// Couleurs lues dans des variables CSS (--cl-*) : changer de thème = changer un attribut data-cl-theme, sans reconstruire l'éditeur.
const hl = HighlightStyle.define([
  {tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--cl-kw)"},
  {tag: [t.string, t.special(t.string), t.regexp], color: "var(--cl-str)"},
  {tag: [t.number, t.bool, t.null, t.atom], color: "var(--cl-num)"},
  {tag: [t.comment, t.lineComment, t.blockComment], color: "var(--cl-com)", fontStyle: "italic"},
  {tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: "var(--cl-fn)"},
  {tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], color: "var(--cl-type)"},
  {tag: [t.propertyName, t.attributeName], color: "var(--cl-prop)"},
  {tag: [t.tagName, t.angleBracket], color: "var(--cl-tag)"},
  {tag: [t.operator, t.punctuation, t.separator, t.bracket], color: "var(--cl-op)"},
  {tag: [t.definition(t.variableName), t.variableName], color: "var(--cl-var)"},
  {tag: t.invalid, color: "var(--cl-err)"},
  {tag: t.heading, color: "var(--cl-kw)", fontWeight: "bold"},
]);

const LANGS = {
  js: () => javascript(), html: () => html(), css: () => css(), python: () => python(), c: () => cpp(), cpp: () => cpp(),
  java: () => java(), sql: () => sql({dialect: SQLite}), shell: () => StreamLanguage.define(shell), text: () => [],
};

function create(parent, o) {
  o = o || {};
  const lang = new Compartment(), wrap = new Compartment(), nums = new Compartment(), comp = new Compartment(), indent = new Compartment();
  const state = EditorState.create({
    doc: o.doc || "",
    extensions: [
      nums.of(lineNumbers()), highlightActiveLineGutter(), history(), drawSelection(), dropCursor(), indentOnInput(), bracketMatching(), closeBrackets(),
      highlightActiveLine(), highlightSelectionMatches(), syntaxHighlighting(hl),
      indent.of(indentUnit.of("    ")), comp.of([]), lang.of([]), wrap.of([]),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
      // clavier Android : pas de correction/majuscule automatique, pas de vérificateur d'orthographe dans le code
      EditorView.contentAttributes.of({autocorrect: "off", autocapitalize: "off", spellcheck: "false", autocomplete: "off", enterkeyhint: "enter"}),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && o.onChange) o.onChange();
        if ((u.selectionSet || u.docChanged) && o.onSelection) o.onSelection();
      }),
    ],
  });
  const view = new EditorView({state, parent});
  const H = {
    view,
    getDoc: () => view.state.doc.toString(),
    setDoc: (s) => view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: s}, selection: {anchor: 0}}),
    setLang: (id) => view.dispatch({effects: lang.reconfigure((LANGS[id] || LANGS.text)())}),
    setWrap: (on) => view.dispatch({effects: wrap.reconfigure(on ? EditorView.lineWrapping : [])}),
    setLineNumbers: (on) => view.dispatch({effects: nums.reconfigure(on ? lineNumbers() : [])}),
    setAutocomplete: (on) => view.dispatch({effects: comp.reconfigure(on ? autocompletion({activateOnTyping: true}) : [])}),
    setIndent: (n) => view.dispatch({effects: indent.reconfigure(indentUnit.of(" ".repeat(n)))}),
    focus: () => view.focus(),
    // insertion à la sélection (barre d'outils) ; `pair` : insère "{}" puis place le curseur entre les deux
    insert: (s, back) => {
      const r = view.state.selection.main;
      const pos = r.from + s.length - (back || 0);
      view.dispatch({changes: {from: r.from, to: r.to, insert: s}, selection: {anchor: pos}, scrollIntoView: true});
      view.focus();
    },
    wrapSelection: (open, close) => {
      const r = view.state.selection.main, sel = view.state.sliceDoc(r.from, r.to);
      view.dispatch({changes: {from: r.from, to: r.to, insert: open + sel + close}, selection: {anchor: r.from + open.length, head: r.from + open.length + sel.length}, scrollIntoView: true});
      view.focus();
    },
    move: (dx) => { const r = view.state.selection.main; const p = Math.max(0, Math.min(view.state.doc.length, (dx < 0 ? r.from : r.to) + dx)); view.dispatch({selection: {anchor: p}, scrollIntoView: true}); view.focus(); },
    moveLine: (dy) => { (dy < 0 ? cursorLineUp : cursorLineDown)(view); view.focus(); },
    indent: () => { indentMore(view); view.focus(); },
    outdent: () => { indentLess(view); view.focus(); },
    undo: () => { undo(view); view.focus(); }, redo: () => { redo(view); view.focus(); },
    canUndo: () => undoDepth(view.state) > 0, canRedo: () => redoDepth(view.state) > 0,
    selectAll: () => { selectAll(view); view.focus(); },
    cursor: () => { const p = view.state.selection.main.head, l = view.state.doc.lineAt(p); return {line: l.number, col: p - l.from + 1, pos: p}; },
    selection: () => { const r = view.state.selection.main; return view.state.sliceDoc(r.from, r.to); },
    goto: (line) => { const n = Math.max(1, Math.min(view.state.doc.lines, line)); const l = view.state.doc.line(n); view.dispatch({selection: {anchor: l.from}, effects: EditorView.scrollIntoView(l.from, {y: "center"})}); },
    destroy: () => view.destroy(),
  };
  H.setLang(o.lang || "text");
  return H;
}

window.CM = {create, languages: Object.keys(LANGS)};
