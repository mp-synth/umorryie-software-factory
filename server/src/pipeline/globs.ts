const SPECIAL = /[.+^${}()|[\]\\]/g;

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A path glob as a regular expression: `**` spans folders, `*` and `?` stay within one, a trailing `/` means everything under it. */
export function globPattern(glob: string): RegExp {
  const clean = glob.trim().replace(/^\.\//, '');
  const source = clean
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      if (part === '?') return '[^/]';
      return part.replace(SPECIAL, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}${clean.endsWith('/') ? '.*' : ''}$`);
}
