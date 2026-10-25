/**
 * Decode a Windows process command line without observing processes or files.
 * @param {string} command
 * @returns {string[]|null}
 */
export function parseWindowsProcessCommandLine(command) {
  if (typeof command !== 'string') throw new TypeError('Windows process command line must be a string.');
  /** @type {string[]} */ const args = [];
  let offset = 0;
  while (offset < command.length) {
    while (offset < command.length && /[ \t]/.test(command[offset])) offset++;
    if (offset === command.length) break;
    let arg = '';
    let quoted = false;
    while (offset < command.length) {
      const character = command[offset];
      if (!quoted && /[ \t]/.test(character)) break;
      if (character === '\\') {
        let end = offset;
        while (command[end] === '\\') end++;
        const count = end - offset;
        if (command[end] === '"') {
          arg += '\\'.repeat(Math.floor(count / 2));
          if (count % 2) arg += '"';
          else quoted = !quoted;
          offset = end + 1;
        } else {
          arg += '\\'.repeat(count);
          offset = end;
        }
        continue;
      }
      if (character === '"') {
        if (quoted && command[offset + 1] === '"') {arg += '"'; offset += 2; continue;}
        quoted = !quoted;
        offset++;
        continue;
      }
      arg += character;
      offset++;
    }
    if (quoted) return null;
    args.push(arg);
  }
  return args;
}
