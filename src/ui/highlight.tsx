import type { ReactNode } from 'react';

/**
 * Tiny regex-based syntax highlighter for the assistant's code blocks. Token colors come from the
 * theme's CSS variables (see .hl-* in styles.css), so code follows the theme picked in Settings.
 */

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue debugger declare def default del delete do elif else enum ' +
    'except export extends finally fn for from func function go if impl implements import in instanceof interface is lambda ' +
    'let match module mut namespace new not of or and package pass private protected pub public raise readonly return satisfies ' +
    'select static struct super switch this throw try type typeof use var void while with yield self echo fi then done esac ' +
    'local elif unset'
  ).split(' '),
);
const LITERALS = new Set('true false null undefined None True False nil NaN Infinity'.split(' '));

const HASH_COMMENT = new Set(['py', 'python', 'sh', 'bash', 'shell', 'zsh', 'yaml', 'yml', 'toml', 'rb', 'ruby', 'dockerfile', 'ini', 'conf']);
const MARKUP = new Set(['html', 'xml', 'svg', 'vue', 'svelte', 'jsx', 'tsx']);
const CSS = new Set(['css', 'scss', 'sass', 'less']);

function tokenizer(lang: string): RegExp {
  const parts = [
    String.raw`(?<comment>\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->${HASH_COMMENT.has(lang) ? String.raw`|#[^\n]*` : ''})`,
    String.raw`(?<string>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\.|[^\x60\\])*\x60)`,
    MARKUP.has(lang) ? String.raw`(?<tag><\/?[A-Za-z][\w.:-]*|\/?>)` : '',
    String.raw`(?<number>\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)(?:px|em|rem|ms|s|%|n)?\b)`,
    String.raw`(?<word>[A-Za-z_$@][\w$-]*)`,
  ];
  return new RegExp(parts.filter(Boolean).join('|'), 'g');
}

export function highlight(code: string, lang: string): ReactNode[] {
  const language = lang.toLowerCase();
  const re = tokenizer(language);
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  const push = (cls: string, text: string) => out.push(<span key={key++} className={cls}>{text}</span>);
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    last = re.lastIndex;
    const g = m.groups!;
    const text = m[0];
    const rest = code.slice(last);
    const before = code.slice(code.lastIndexOf('\n', m.index - 1) + 1, m.index).trimEnd();
    if (g.comment) push('hl-comment', text);
    else if (g.string) push(isKey(before, rest) ? 'hl-prop' : 'hl-string', text);
    else if (g.tag) push('hl-tag', text);
    else if (g.number) push('hl-number', text);
    else {
      const prev = code[m.index - 1];
      // Words with dashes only make sense in CSS/markup; elsewhere `a-b` is a subtraction.
      if (text.includes('-') && !CSS.has(language) && !MARKUP.has(language)) {
        const [head] = text.split('-');
        re.lastIndex = last = m.index + head.length;
        out.push(classify(head, prev, before, code.slice(last), key++));
        continue;
      }
      out.push(classify(text, prev, before, rest, key++, CSS.has(language)));
    }
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

/** Object/JSON key: followed by `:` and at the start of a line or after `{`, `,` or `(` (not a ternary). */
const isKey = (before: string, rest: string) => /^\s*\??:(?!:)/.test(rest) && (before === '' || /[{,(]$/.test(before));

function classify(word: string, prev: string | undefined, before: string, rest: string, key: number, css = false): ReactNode {
  let cls = '';
  // CSS declaration (`color: red;`), not a selector with a pseudo-class (`a:hover {`).
  if (css) cls = /^\s*:[^{\n]*(?:;|\n|$)/.test(rest) ? 'hl-prop' : prev === '.' || prev === '#' ? 'hl-type' : '';
  else if (LITERALS.has(word)) cls = 'hl-number';
  else if (isKey(before, rest)) cls = 'hl-prop';
  else if (KEYWORDS.has(word) && prev !== '.') cls = 'hl-keyword';
  else if (/^\s*\(/.test(rest)) cls = 'hl-fn';
  else if (prev === '.' || /^=["'{]/.test(rest)) cls = 'hl-prop';
  else if (/^[A-Z][a-z]/.test(word)) cls = 'hl-type';
  return cls ? (
    <span key={key} className={cls}>
      {word}
    </span>
  ) : (
    word
  );
}
