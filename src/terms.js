// Filter terms as typed in the column editor and in Settings (mute words).
// The matching side lives in content/core.js; the three functions below are
// copies of it so the editor can refuse an unsafe /regex/ before it is saved.
// tests/core.test.mjs runs both against the same table and fails on any
// difference. Keep them identical.

const MAX_REGEX = 200;
const REGEX_FLAGS = /^[dgimsuvy]*$/;

// Comma/newline separated terms; a /regex/flags term is kept whole even if it
// contains commas, e.g. /a{1,3}/.
export function splitTerms(s) {
  const str = String(s || '');
  const out = [];
  let i = 0;
  while (i < str.length) {
    while (i < str.length && /[\s,]/.test(str[i])) i++;
    if (i >= str.length) break;
    if (str[i] === '/') {
      const m = str.slice(i).match(/^\/((?:\\.|[^\\/\n])+)\/([a-z]*)(?=\s*(?:[,\n]|$))/);
      if (m) { out.push(m[0]); i += m[0].length; continue; }
    }
    let j = i;
    while (j < str.length && str[j] !== ',' && str[j] !== '\n') j++;
    const term = str.slice(i, j).trim();
    if (term) out.push(term);
    i = j + 1;
  }
  return out;
}

export function regexProblem(src) {
  if (src.length > MAX_REGEX) return `longer than ${MAX_REGEX} characters`;
  if (/\\[1-9]|\\k</.test(src)) return 'backreferences are not allowed';
  const plain = src.replace(/\\./g, '_').replace(/\[(?:[^\]\\]|\\.)*\]/g, '_');
  const repeat = /[*+]|\{\d+,\}/g;
  if ((plain.match(repeat) || []).length > 2) return 'more than two unbounded repeats (* + {n,})';
  const stack = [];
  for (let i = 0; i < plain.length; i++) {
    const c = plain[i];
    if (c === '(') stack.push(i);
    else if (c === ')') {
      const start = stack.pop();
      if (start === undefined) continue;
      if (/^(?:[*+]|\{\d+,\})/.test(plain.slice(i + 1)) && /[*+|]|\{\d+,\}/.test(plain.slice(start + 1, i))) {
        return 'a repeated group may not contain | or another repeat';
      }
    }
  }
  return '';
}

// '' when the term is fine, otherwise the reason it cannot be used as a /regex/.
export function regexTermProblem(term) {
  const rm = term.match(/^\/(.+)\/([a-z]*)$/);
  if (!rm || !REGEX_FLAGS.test(rm[2])) return '';
  const bad = regexProblem(rm[1]);
  if (bad) return bad;
  try { new RegExp(rm[1], rm[2].replace(/[gy]/g, '')); } catch (e) { return `invalid pattern (${String(e.message).replace(/^Invalid regular expression: /, '')})`; }
  return '';
}

// One readable message for the first unusable term in a terms field, or ''.
export function termsError(label, text) {
  for (const term of splitTerms(text)) {
    const why = regexTermProblem(term);
    if (why) return `${label}: ${term.length > 40 ? `${term.slice(0, 40)}...` : term} cannot be used: ${why}.`;
  }
  return '';
}
