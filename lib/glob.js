// Minimal glob -> RegExp for matching file paths (case-insensitive). Supports:
//   *        a run of non-slash characters
//   **       a run that may include slashes
//   ?        one non-slash character
//   {a,b,c}  alternation
// Everything else matches literally. Used for a collection data_model's `match`.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }   // unterminated: literal '{'
      const alts = glob.slice(i + 1, end).split(',')
        .map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      re += '(?:' + alts.join('|') + ')';
      i = end;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

module.exports = { globToRegExp };
