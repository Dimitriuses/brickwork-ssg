'use strict';
// Zero-dependency ANSI colour for the build/test output — a small traffic-light palette (green =
// success, yellow = warning, red = error) used by lib/log.js. No chalk. Enablement is resolved once
// under a policy (auto | always | never), honouring NO_COLOR / FORCE_COLOR / TTY. See
// docs/terminal-ux-plan.md.

const CODE = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m'
};

// Should colour be emitted to `stream` under `policy`?
//   never  -> off; always -> on; auto (default) -> NO_COLOR disables (any value), FORCE_COLOR
//   forces (unless "0"), otherwise require the stream to be a TTY. A piped stream (e.g. tests,
//   CI capture) is not a TTY, so auto yields plain text there.
function shouldColor(policy, stream) {
  if (policy === 'never') return false;
  if (policy === 'always') return true;
  if ('NO_COLOR' in process.env) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return !!(stream && stream.isTTY);
}

// A palette bound to an `enabled` flag. When disabled, every helper returns its input unchanged,
// so callers use one code path whether or not colour is on (and output stays byte-identical when off).
function palette(enabled) {
  const wrap = (code) => enabled ? (s) => code + s + CODE.reset : (s) => String(s);
  return {
    enabled: !!enabled,
    dim: wrap(CODE.dim),
    bold: wrap(CODE.bold),
    red: wrap(CODE.red),
    green: wrap(CODE.green),
    yellow: wrap(CODE.yellow)
  };
}

module.exports = { shouldColor, palette, CODE };
