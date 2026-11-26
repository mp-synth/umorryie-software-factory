import path from 'node:path';
import { git } from '../git.ts';

export interface RuleViolation {
  file: string;
  line: number;
  rule: 'comment' | 'linear';
  text: string;
}

export interface RuleNote {
  file: string;
  line: number;
  rule: 'uncalled' | 'duplicate';
  text: string;
  detail: string;
}

export interface OwnerRulesResult {
  violations: RuleViolation[];
  notes: RuleNote[];
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

type GitRunner = (cwd: string, args: string[]) => Promise<GitResult>;
type SkipFile = (file: string) => boolean;
type DefinitionKind = 'function' | 'class' | 'constant';
type DefinitionPattern = [RegExp, DefinitionKind];

interface Language {
  comment: '#' | '//';
  quotes: string[];
  definitions: DefinitionPattern[];
  regexLiterals?: boolean;
  charLiterals?: boolean;
}

interface AddedLine {
  line: number;
  text: string;
}

interface AddedRun {
  file: string;
  lines: AddedLine[];
}

interface AddedDefinition {
  file: string;
  line: number;
  name: string;
  kind: DefinitionKind;
}

interface FoundDefinition extends AddedDefinition {
  entryPoint: boolean;
}

interface ScanState {
  blockComment: boolean;
  openString: string | null;
}

interface CodeLine {
  line: number;
  text: string;
  code: string;
}

interface Block {
  file: string;
  lines: CodeLine[];
}

interface GrepMatch {
  file: string;
  line: number;
  match: string;
}

interface Copy {
  file: string;
  line: number;
  endLine: number;
  text: string;
  otherFile: string;
  otherLine: number;
  length: number;
}

const PYTHON_DEFINITIONS: DefinitionPattern[] = [
  [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, 'function'],
  [/^\s*class\s+([A-Za-z_]\w*)/, 'class'],
  [/^([A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=(?!=)/, 'constant'],
];

const SCRIPT_DEFINITIONS: DefinitionPattern[] = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\b\s*)?(?:function\b|(?:<[^>]*>)?\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>|\(\s*$)/,
    'function',
  ],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^export\s+const\s+([A-Za-z_$][\w$]*)/, 'constant'],
  [/^const\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=/, 'constant'],
];

const PYTHON: Language = { comment: '#', quotes: ['"""', "'''", '"', "'"], definitions: PYTHON_DEFINITIONS };
const RUBY: Language = { comment: '#', quotes: ['"', "'"], definitions: [] };
const SCRIPT: Language = { comment: '//', quotes: ['"', "'", '`'], definitions: SCRIPT_DEFINITIONS, regexLiterals: true };
const GO: Language = { comment: '//', quotes: ['"', "'", '`'], definitions: [] };
const JVM: Language = { comment: '//', quotes: ['"""', '"', "'"], definitions: [] };
const RUST: Language = { comment: '//', quotes: ['"'], definitions: [], charLiterals: true };

const LANGUAGES: Record<string, Language> = {
  '.py': PYTHON,
  '.rb': RUBY,
  '.ts': SCRIPT,
  '.tsx': SCRIPT,
  '.js': SCRIPT,
  '.jsx': SCRIPT,
  '.mjs': SCRIPT,
  '.cjs': SCRIPT,
  '.go': GO,
  '.java': JVM,
  '.kt': JVM,
  '.swift': JVM,
  '.rs': RUST,
};

const CODE_PATHSPECS = Object.keys(LANGUAGES).map((extension) => `*${extension}`);
const MULTILINE_QUOTES = new Set(['"""', "'''", '`']);
const GENERATED_DIRECTORIES = new Set(['generated', '__generated__', 'vendor', 'node_modules', 'dist', 'build', 'idl']);
const GENERATED_SUFFIXES = ['.gen.ts', '.d.ts', '.d.mts', '.d.cts', '_pb2.py', '_pb2_grpc.py', '.pb.go', '.min.js'];
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$|(^|\/)(test_[^/]*|conftest)\.py$|_test\.(py|go)$/;

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const CHAR_LITERAL = /^'(?:\\.[^'\s]{0,8}|[^'\\])'/;
const REGEX_PRECEDER = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\b(?:return|typeof|case|do|else|in|of|void|yield|await))\s*$/;
const BLOCK_COMMENT_CONTINUATION = /^\s*\*(?:\s|\/|$)(?!.*[;,]\s*$)/;
const COMMENT_MARKER = /^(?:#+|\/{2,}|\/\*+|\*+)\s*/;
const DIRECTIVE_COMMENT = /^(?:#!|\/\/go:|\/\/\/\s*<reference)/;
const DIRECTIVE_BODY =
  /^(?:-\*-\s*coding|noqa|type:\s*ignore|pragma|pylint:|ruff:|fmt:|isort:|mypy:|pyright:|nosec|eslint-disable|eslint-enable|@ts-expect-error|@ts-ignore|@ts-nocheck|prettier-ignore|istanbul ignore|c8 ignore|biome-ignore|\+build)/i;
const LINEAR_URL = /linear\.app\b/i;
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,9})-\d+\b/g;
const NOT_ISSUE_PREFIXES = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'AES', 'RSA', 'HTTP', 'TLS', 'SSL', 'CVE', 'GPT', 'ES', 'PEP', 'WCAG', 'HS', 'RS', 'PS', 'EC', 'ECMA', 'IPV', 'MD', 'UUID', 'BASE', 'CP']);
const PLAIN_DECORATOR = /^@(?:property|staticmethod|classmethod|cached_property|functools\.\w+|lru_cache|cache|wraps|override|abstractmethod|abc\.abstractmethod|\w+\.setter)\b/;
const TRIVIAL_LINE =
  /^[\s{}()[\];,.:]*$|^(?:else|try|finally|pass|return|break|continue|end|"""|''')[:;]?$|^\}?\s*else\s*\{?$|^(?:import|from)\s|^export\s.*\bfrom\s|=\s*require\(|^(?:#|\/\/|\/\*|\*)/;
const BARE_DECLARATION = /^\**[A-Za-z_$][\w$]*\??\s*(?::\s*[\w$.[\]|, "'<>?]+)?(?:\s*=\s*[\w$."']+)?$/;

const MAX_TEXT_LENGTH = 160;
const MAX_NAMES = 40;
const MAX_BLOCKS = 20;
const BLOCK_LINES = 40;
const MIN_DUPLICATE_LINES = 6;
const MIN_ANCHOR_LENGTH = 12;
const MIN_ANCHOR_HITS = 3;
const MAX_FILES_PER_BLOCK = 5;
const MAX_FILES_READ = 30;
const TRUSTED_GREP_OUTPUT = 1_000_000;
const GIT_TIMEOUT_MS = 60_000;
const GIT_FAILED = 128;
const GREP_FOUND_NOTHING = 1;

export function findRuleViolations(diffU0: string, opts: { skip?: SkipFile } = {}): RuleViolation[] {
  return checkedRuns(diffU0, opts.skip).flatMap(violationsInRun);
}

export function addedDefinitions(diffU0: string): AddedDefinition[] {
  return parseAddedRuns(diffU0).flatMap(definitionsInRun).map(({ file, line, name, kind }) => ({ file, line, name, kind }));
}

export async function checkOwnerRules(
  worktree: string,
  base: string,
  opts: { skip?: SkipFile; git?: GitRunner } = {},
): Promise<OwnerRulesResult> {
  const runGit = withoutThrowing(opts.git ?? gitWithTimeout);
  const diff = await runGit(worktree, ['-c', 'core.quotePath=false', 'diff', '-U0', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', `${base}...HEAD`, '--', ...CODE_PATHSPECS]);
  if (diff.code !== 0 || diff.timedOut) return { violations: [], notes: [] };
  const runs = checkedRuns(diff.stdout, opts.skip);
  const [uncalled, duplicates] = await Promise.all([
    findUncalledNotes(runGit, worktree, runs.flatMap(definitionsInRun)),
    findDuplicateNotes(runGit, worktree, blocksIn(runs)),
  ]);
  return { violations: runs.flatMap(violationsInRun), notes: [...uncalled, ...duplicates] };
}

export function renderOwnerRules(result: OwnerRulesResult): string {
  const sections: string[] = [];
  const forbidden = result.violations.filter((violation) => violation.rule === 'linear');
  const comments = result.violations.filter((violation) => violation.rule === 'comment');
  if (forbidden.length) {
    sections.push(
      [
        '## Owner rules',
        '',
        "These added lines break the owner's code rule: do not mention Linear in code. Remove the reference.",
        '',
        ...forbidden.map((v) => `- ${inlineCode(`${v.file}:${v.line}`)} ${v.rule}: ${inlineCode(v.text)}`),
      ].join('\n'),
    );
  }
  if (comments.length || result.notes.length) {
    sections.push(
      [
        '## Owner rules to check by hand',
        '',
        'A script found these candidates. They are advisory: confirm each one before acting on it.',
        '',
        ...comments.map((v) => `- ${inlineCode(`${v.file}:${v.line}`)} comment ${inlineCode(v.text)}: keep it only when it explains why the code cannot express`),
        ...result.notes.map((n) => `- ${inlineCode(`${n.file}:${n.line}`)} ${n.rule} ${inlineCode(n.text)}: ${n.detail}`),
      ].join('\n'),
    );
  }
  return sections.length ? `${sections.join('\n\n')}\n` : '';
}

function gitWithTimeout(cwd: string, args: string[]): Promise<GitResult> {
  return git(cwd, args, GIT_TIMEOUT_MS);
}

function withoutThrowing(runGit: GitRunner): GitRunner {
  return async (cwd, args) => {
    try {
      return await runGit(cwd, args);
    } catch (err) {
      return { code: GIT_FAILED, stdout: '', stderr: String(err) };
    }
  };
}

function inlineCode(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

function languageOf(file: string): Language | undefined {
  return LANGUAGES[path.posix.extname(file)];
}

function isGeneratedPath(file: string): boolean {
  return file.split('/').slice(0, -1).some((dir) => GENERATED_DIRECTORIES.has(dir)) || GENERATED_SUFFIXES.some((suffix) => file.endsWith(suffix));
}

function isTestFile(file: string): boolean {
  return TEST_FILE.test(file);
}

function checkedRuns(diffU0: string, skip?: SkipFile): AddedRun[] {
  return parseAddedRuns(diffU0).filter((run) => !!languageOf(run.file) && !isGeneratedPath(run.file) && !skip?.(run.file));
}

function parseAddedRuns(diffU0: string): AddedRun[] {
  const runs: AddedRun[] = [];
  let file: string | null = null;
  let run: AddedRun = { file: '', lines: [] };
  let oldLeft = 0;
  let newLeft = 0;
  let next = 0;
  for (const raw of diffU0.split('\n')) {
    if (oldLeft > 0 || newLeft > 0) {
      if (raw.startsWith('+')) {
        run.lines.push({ line: next++, text: raw.slice(1) });
        newLeft--;
      } else if (raw.startsWith('-')) oldLeft--;
      continue;
    }
    if (raw.startsWith('diff --git ')) file = null;
    else if (raw.startsWith('+++ ')) file = pathAfterPlus(raw.slice(4));
    const header = HUNK_HEADER.exec(raw);
    if (!header) continue;
    oldLeft = Number(header[1] ?? 1);
    next = Number(header[2]);
    newLeft = Number(header[3] ?? 1);
    run = { file: file ?? '', lines: [] };
    if (file && newLeft > 0) runs.push(run);
  }
  return runs;
}

function pathAfterPlus(raw: string): string | null {
  const unquoted = raw.trim().replace(/^"(.*)"$/, '$1');
  if (unquoted === '/dev/null') return null;
  return unquoted.startsWith('b/') ? unquoted.slice(2) : unquoted;
}

function violationsInRun(run: AddedRun): RuleViolation[] {
  const language = languageOf(run.file)!;
  const state: ScanState = { blockComment: false, openString: null };
  return run.lines.flatMap((added, index) => {
    if (index === 0 && language.comment === '//' && BLOCK_COMMENT_CONTINUATION.test(added.text)) state.blockComment = true;
    return lineViolations(run.file, added, findComment(added.text, language, state));
  });
}

function lineViolations(file: string, added: AddedLine, comment: string | null): RuleViolation[] {
  const rules: RuleViolation['rule'][] = [];
  if (comment !== null && !isDirective(comment)) rules.push('comment');
  if (LINEAR_URL.test(added.text) || (comment !== null && mentionsIssueKey(comment))) rules.push('linear');
  const text = added.text.trim().slice(0, MAX_TEXT_LENGTH);
  return rules.map((rule) => ({ file, line: added.line, rule, text }));
}

function isDirective(comment: string): boolean {
  return DIRECTIVE_COMMENT.test(comment) || DIRECTIVE_BODY.test(comment.replace(COMMENT_MARKER, ''));
}

function mentionsIssueKey(comment: string): boolean {
  return [...comment.matchAll(ISSUE_KEY)].some((key) => !NOT_ISSUE_PREFIXES.has(key[1]));
}

function findComment(text: string, language: Language, state: ScanState): string | null {
  let comment: string | null = null;
  let i = 0;
  while (i < text.length) {
    if (state.blockComment) {
      const inside = text.slice(i).trim();
      if (inside) comment ??= inside;
      const end = text.indexOf('*/', i);
      if (end < 0) return comment;
      state.blockComment = false;
      i = end + 2;
    } else if (state.openString) {
      i = skipStringBody(text, i, state);
    } else if (text.startsWith(language.comment, i)) {
      return comment ?? text.slice(i).trim();
    } else if (language.comment === '//' && text.startsWith('/*', i)) {
      comment ??= text.slice(i).trim();
      state.blockComment = true;
      i += 2;
    } else {
      i = skipCode(text, i, language, state);
    }
  }
  if (state.openString && !MULTILINE_QUOTES.has(state.openString) && !text.endsWith('\\')) state.openString = null;
  return comment;
}

function skipStringBody(text: string, from: number, state: ScanState): number {
  const quote = state.openString!;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text.startsWith(quote, i)) {
      state.openString = null;
      return i + quote.length;
    }
  }
  return text.length;
}

function skipCode(text: string, i: number, language: Language, state: ScanState): number {
  const quote = language.quotes.find((q) => text.startsWith(q, i));
  if (quote) {
    state.openString = quote;
    return i + quote.length;
  }
  if (language.charLiterals && text[i] === "'") return i + (CHAR_LITERAL.exec(text.slice(i))?.[0].length ?? 1);
  if (language.regexLiterals && text[i] === '/' && REGEX_PRECEDER.test(text.slice(0, i))) return skipRegexLiteral(text, i);
  return i + 1;
}

function skipRegexLiteral(text: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '[') inClass = true;
    else if (text[i] === ']') inClass = false;
    else if (text[i] === '/' && !inClass) return i + 1;
  }
  return start + 1;
}

function definitionsInRun(run: AddedRun): FoundDefinition[] {
  const patterns = languageOf(run.file)?.definitions ?? [];
  if (!patterns.length || isTestFile(run.file)) return [];
  return run.lines.flatMap((added, index) => {
    const found = matchDefinition(added.text, patterns);
    if (!found || isExemptName(found.name)) return [];
    return [{ file: run.file, line: added.line, ...found, entryPoint: isEntryPoint(run.lines, index) }];
  });
}

function matchDefinition(text: string, patterns: DefinitionPattern[]): { name: string; kind: DefinitionKind } | null {
  for (const [pattern, kind] of patterns) {
    const name = pattern.exec(text)?.[1];
    if (name) return { name, kind };
  }
  return null;
}

function isExemptName(name: string): boolean {
  return name.startsWith('test_') || name.startsWith('Test') || /^__\w+__$/.test(name);
}

function isEntryPoint(lines: AddedLine[], index: number): boolean {
  return /\bexport\s+default\b/.test(lines[index].text) || decoratorsAbove(lines, index).some((decorator) => !PLAIN_DECORATOR.test(decorator));
}

function decoratorsAbove(lines: AddedLine[], index: number): string[] {
  const decorators: string[] = [];
  for (let i = index - 1; i >= 0 && lines[i].text.trim().startsWith('@'); i--) decorators.push(lines[i].text.trim());
  return decorators;
}

async function grepAtHead(runGit: GitRunner, worktree: string, flags: string[], patterns: string[]): Promise<{ matches: GrepMatch[]; complete: boolean } | null> {
  if (!patterns.length) return { matches: [], complete: true };
  const args = ['grep', '--full-name', '-n', '-z', '-o', '-F', '-I', ...flags, ...patterns.flatMap((p) => ['-e', p]), 'HEAD', '--', ':/'];
  const r = await runGit(worktree, args);
  if (r.timedOut || (r.code !== 0 && r.code !== GREP_FOUND_NOTHING)) return null;
  return { matches: parseGrepMatches(r.stdout), complete: r.stdout.length < TRUSTED_GREP_OUTPUT };
}

function parseGrepMatches(stdout: string): GrepMatch[] {
  const prefix = 'HEAD:';
  return stdout.split('\n').flatMap((record) => {
    const [location, line, match] = record.split('\0');
    if (match === undefined || !location.startsWith(prefix)) return [];
    return [{ file: location.slice(prefix.length), line: Number(line), match }];
  });
}

async function findUncalledNotes(runGit: GitRunner, worktree: string, definitions: FoundDefinition[]): Promise<RuleNote[]> {
  const candidates = definitions.filter((d) => !d.entryPoint);
  const names = [...new Set(candidates.map((d) => d.name))].slice(0, MAX_NAMES);
  const uses = await findUses(runGit, worktree, names, definitions);
  return candidates.flatMap((d) => {
    const found = uses.get(d.name);
    return found && !hasProductionUse(found) ? [uncalledNote(d, found)] : [];
  });
}

async function findUses(runGit: GitRunner, worktree: string, names: string[], definitions: FoundDefinition[]): Promise<Map<string, GrepMatch[]>> {
  const uses = new Map<string, GrepMatch[]>();
  const batch = await grepAtHead(runGit, worktree, ['-w'], names);
  if (!batch) return uses;
  const recheck: string[] = [];
  for (const name of names) {
    const found = usesOf(name, batch.matches, definitions);
    if (batch.complete || hasProductionUse(found)) uses.set(name, found);
    else recheck.push(name);
  }
  const rechecked = await Promise.all(recheck.map((name) => grepAtHead(runGit, worktree, ['-w'], [name])));
  recheck.forEach((name, i) => {
    const own = rechecked[i];
    if (own?.complete) uses.set(name, usesOf(name, own.matches, definitions));
  });
  return uses;
}

function usesOf(name: string, matches: GrepMatch[], definitions: FoundDefinition[]): GrepMatch[] {
  return matches.filter((m) => m.match === name && !definitions.some((d) => d.name === name && d.file === m.file && d.line === m.line));
}

function hasProductionUse(uses: GrepMatch[]): boolean {
  return uses.some((use) => !isTestFile(use.file));
}

function uncalledNote(definition: FoundDefinition, uses: GrepMatch[]): RuleNote {
  const detail = uses.length ? `only tests use this ${definition.kind}` : `nothing uses this ${definition.kind}`;
  return { file: definition.file, line: definition.line, rule: 'uncalled', text: definition.name, detail };
}

function normalizeCode(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[;,]$/, '');
}

function codeLines(lines: AddedLine[]): CodeLine[] {
  return lines.map((l) => ({ line: l.line, text: l.text.trim(), code: normalizeCode(l.text) })).filter((l) => !isTrivialCode(l.code));
}

function isTrivialCode(code: string): boolean {
  return TRIVIAL_LINE.test(code) || BARE_DECLARATION.test(code);
}

function blocksIn(runs: AddedRun[]): Block[] {
  return runs
    .filter((run) => !isTestFile(run.file))
    .flatMap((run) => splitIntoBlocks(run.file, codeLines(run.lines)))
    .slice(0, MAX_BLOCKS);
}

function splitIntoBlocks(file: string, lines: CodeLine[]): Block[] {
  if (lines.length < MIN_DUPLICATE_LINES) return [];
  const step = BLOCK_LINES - (MIN_DUPLICATE_LINES - 1);
  const blocks: Block[] = [];
  for (let start = 0; ; start += step) {
    blocks.push({ file, lines: lines.slice(start, start + BLOCK_LINES) });
    if (start + BLOCK_LINES >= lines.length) return blocks;
  }
}

function anchorsOf(block: Block): string[] {
  return block.lines.filter((l) => l.code.length >= MIN_ANCHOR_LENGTH).map((l) => l.text);
}

async function findDuplicateNotes(runGit: GitRunner, worktree: string, blocks: Block[]): Promise<RuleNote[]> {
  const grep = await grepAtHead(runGit, worktree, [], [...new Set(blocks.flatMap(anchorsOf))]);
  if (!grep) return [];
  const candidates = blocks.map((block) => candidateFiles(block, grep.matches));
  const filesToRead = [...new Set([...blocks.map((block) => block.file), ...candidates.flat()])].slice(0, MAX_FILES_READ);
  const contents = await readCodeAtHead(runGit, worktree, filesToRead);
  const copies = blocks.flatMap((block, i) => findFirstCopy(block, candidates[i], contents));
  return withoutOverlaps(copies).map((copy) => ({
    file: copy.file,
    line: copy.line,
    rule: 'duplicate',
    text: copy.text.slice(0, MAX_TEXT_LENGTH),
    detail: `${copy.length} lines also at ${copy.otherFile}:${copy.otherLine}`,
  }));
}

function candidateFiles(block: Block, matches: GrepMatch[]): string[] {
  const anchors = new Set(anchorsOf(block));
  const hitsPerFile = new Map<string, Set<string>>();
  for (const m of matches) {
    if (!anchors.has(m.match) || m.file === block.file) continue;
    hitsPerFile.set(m.file, (hitsPerFile.get(m.file) ?? new Set()).add(m.match));
  }
  const needed = Math.min(MIN_ANCHOR_HITS, anchors.size);
  const otherFiles = [...hitsPerFile]
    .filter(([, hits]) => needed > 0 && hits.size >= needed)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, MAX_FILES_PER_BLOCK)
    .map(([file]) => file);
  return [block.file, ...otherFiles];
}

async function readCodeAtHead(runGit: GitRunner, worktree: string, files: string[]): Promise<Map<string, CodeLine[]>> {
  const blobs = await Promise.all(files.map((file) => runGit(worktree, ['cat-file', 'blob', `HEAD:${file}`])));
  const contents = new Map<string, CodeLine[]>();
  files.forEach((file, i) => {
    if (blobs[i].code === 0) contents.set(file, codeLines(blobs[i].stdout.split('\n').map((text, n) => ({ line: n + 1, text }))));
  });
  return contents;
}

function findFirstCopy(block: Block, files: string[], contents: Map<string, CodeLine[]>): Copy[] {
  for (const file of files) {
    const copy = findCopy(block, file, contents.get(file) ?? []);
    if (copy) return [copy];
  }
  return [];
}

function findCopy(block: Block, otherFile: string, otherLines: CodeLine[]): Copy | null {
  const positions = positionsByCode(otherLines);
  for (let b = 0; b + MIN_DUPLICATE_LINES <= block.lines.length; b++) {
    for (const o of positions.get(block.lines[b].code) ?? []) {
      if (otherFile === block.file && otherLines[o].line === block.lines[b].line) continue;
      const length = commonLength(block.lines, b, otherLines, o);
      if (length < MIN_DUPLICATE_LINES) continue;
      const first = block.lines[b];
      return { file: block.file, line: first.line, endLine: block.lines[b + length - 1].line, text: first.text, otherFile, otherLine: otherLines[o].line, length };
    }
  }
  return null;
}

function positionsByCode(lines: CodeLine[]): Map<string, number[]> {
  const positions = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const known = positions.get(l.code);
    if (known) known.push(i);
    else positions.set(l.code, [i]);
  });
  return positions;
}

function commonLength(a: CodeLine[], i: number, b: CodeLine[], j: number): number {
  let length = 0;
  while (i + length < a.length && j + length < b.length && a[i + length].code === b[j + length].code) length++;
  return length;
}

function withoutOverlaps(copies: Copy[]): Copy[] {
  const kept: Copy[] = [];
  for (const copy of copies) {
    if (!kept.some((k) => overlaps(k, copy.file, copy.line, copy.endLine) || overlaps(k, copy.otherFile, copy.otherLine, copy.otherLine))) kept.push(copy);
  }
  return kept;
}

function overlaps(copy: Copy, file: string, line: number, endLine: number): boolean {
  return copy.file === file && copy.line <= endLine && line <= copy.endLine;
}
