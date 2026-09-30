/**
 * dsh-simple-memory-ui — memory library core (host side).
 *
 * Pure-ish module: knows the DSWM on-disk contract and nothing about HTTP.
 *   - workspace:  <dshHome>/workspace/{reference,pending,archive}/ + memory-log.md
 *   - index:      <dshHome>/AGENTS.md, section "## 记忆索引", one line per entry:
 *                 - [标题](~/.dsh/workspace/reference/标题.md) — 摘要（日期）
 *   - git:        the workspace is a repo; every mutation commits.
 *
 * Attachments/UTF-8: every write is UTF-8 **without BOM** and LF newlines, so
 * the files stay diffable and never grow a BOM when edited from the GUI.
 *
 * Source: extends dsh-simple-wiki-memory (MIT) by rainow.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The kinds of item the panel manages. */
export const KINDS = ['reference', 'pending'];

/** Resolve the DSH home dir (~/.dsh unless DSH_HOME overrides). */
export function resolveDshHome(env = process.env, home = homedir()) {
	const raw = env.DSH_HOME;
	if (raw !== void 0 && raw.trim() !== '') {
		const expanded = raw.startsWith('~/') ? join(home, raw.slice(2)) : raw;
		return expanded;
	}
	return join(home, '.dsh');
}

/** Where the index lives inside AGENTS.md. */
const INDEX_HEAD = '## 记忆索引';
const RULES_START = '## 持久记忆维护规则';

/** Paths of one DSWM installation. */
export function paths(dshHome = resolveDshHome()) {
	const ws = join(dshHome, 'workspace');
	return {
		dshHome,
		ws,
		reference: join(ws, 'reference'),
		pending: join(ws, 'pending'),
		archive: join(ws, 'archive'),
		log: join(ws, 'memory-log.md'),
		agents: join(dshHome, 'AGENTS.md')
	};
}

/** Ensure the standard directories exist. */
export function ensureDirs(p) {
	for (const dir of [p.ws, p.reference, p.pending, p.archive]) mkdirSync(dir, { recursive: true });
}

/** Read a text file, returning '' when absent. Strips a UTF-8 BOM if present. */
function readText(file) {
	if (!existsSync(file)) return '';
	const raw = readFileSync(file, 'utf8');
	return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

/**
 * Write UTF-8 without BOM, creating parent dirs.
 *
 * The dominant newline style of the existing file is preserved (and a file with
 * mixed endings is normalized to that style). Forcing LF would silently rewrite
 * a whole document that was authored with CRLF, and — worse — reading such a
 * file back with a CRLF-blind parser is what once made every index row
 * unparseable. Keeping the author's style removes that whole failure class.
 */
function writeText(file, text) {
	mkdirSync(join(file, '..'), { recursive: true });
	const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const eol = existsSync(file) && detectEol(readFileSync(file, 'utf8'));
	writeFileSync(file, eol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized, { encoding: 'utf8' });
}

/** The newline style a document is predominantly written with. */
function detectEol(raw) {
	const crlf = (raw.match(/\r\n/g) ?? []).length;
	const lf = (raw.match(/(?<!\r)\n/g) ?? []).length;
	return crlf > lf ? '\r\n' : '\n';
}

/** Timestamp used in log lines and archive prefixes. */
export function stamp(date = new Date()) {
	const pad = (n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Date-only stamp for index rows. */
function dayStamp(date = new Date()) {
	return stamp(date).slice(0, 10);
}

/* ------------------------------------------------------------------ index */

/**
 * Parse the index section of AGENTS.md.
 *
 * Returns the raw document split into three parts so callers can rewrite only
 * the index while preserving everything else byte-for-byte:
 *   { head, rows, tail } where head ends right before the first row and tail
 *   begins at the first character after the last row.
 *
 * Rows keep their raw text plus the parsed fields; unknown/garbage lines in the
 * index region are preserved verbatim in a `passthrough` field order.
 */
export function readIndex(p) {
	// Normalize newlines before parsing: a CRLF file would otherwise defeat the
	// row regex (its `$` anchor meets the trailing "\r"), and a mixed-ending file
	// is common right after an external editor touched the document.
	const doc = readText(p.agents).replace(/\r\n?/g, '\n');
	const head = doc.indexOf(INDEX_HEAD);
	if (head === -1) return { doc, found: false, pre: doc, rows: [], post: '\n', passthrough: [] };
	const afterHead = head + INDEX_HEAD.length;
	// Rows are every line between the heading and the next "## " heading (or EOF).
	const rest = doc.slice(afterHead);
	const nextHeading = rest.search(/\n## (?!记忆索引)/);
	const bodyEnd = nextHeading === -1 ? rest.length : nextHeading + 1;
	const body = rest.slice(0, bodyEnd);
	const after = rest.slice(bodyEnd);

	const lines = body.split('\n');
	const rows = [];
	const passthrough = [];
	const rowRe = /^\s*-\s*\[([^\]]*)\]\(([^)]*)\)\s*(?:—|-)?\s*(.*)$/;
	const order = [];
	lines.forEach((line, i) => {
		if (line.trim() === '') return;
		const m = lineRe_m(line, rowRe);
		order.push({ i, line, parsed: m });
	});
	// Only treat a contiguous trailing run of rows as the row block so the
	// explanatory blockquote / HTML comment above them is preserved.
	let firstRow = -1;
	let lastRow = -1;
	for (const item of order) {
		if (item.parsed !== null) {
			if (firstRow === -1) firstRow = item.i;
			lastRow = item.i;
		}
	}
	const preBody = firstRow === -1 ? body : lines.slice(0, firstRow).join('\n');
	const rowLines = firstRow === -1 ? [] : lines.slice(firstRow, lastRow + 1);
	const postBody = firstRow === -1 ? '' : lines.slice(lastRow + 1).join('\n');
	for (const line of rowLines) {
		const parsed = rowRe.exec(line);
		if (parsed === null) {
			passthrough.push(line);
			continue;
		}
		const [, title, target, tail] = parsed;
		const cleanTarget = target.trim();
		const file = cleanTarget.split('/').pop() ?? '';
		const dateMatch = /（(\d{4}-\d{2}-\d{2})）\s*$/.exec(tail);
		rows.push({
			title: title.trim(),
			target: cleanTarget,
			// The kind MUST be recovered here: writeIndex() re-renders every row,
			// so a row that reaches it without a valid kind would be written back
			// as "workspace/undefined/<file>.md" and silently destroy the index.
			kind: kindOfTarget(cleanTarget),
			file,
			summary: dateMatch === null ? tail.trim() : tail.slice(0, dateMatch.index).trim(),
			date: dateMatch === null ? '' : dateMatch[1],
			raw: line
		});
	}
	return {
		doc,
		found: true,
		pre: doc.slice(0, afterHead) + preBody,
		rows,
		post: postBody + after,
		passthrough
	};
}

function lineRe_m(line, re) {
	if (line.trim().startsWith('<!--')) return null;
	if (line.trim().startsWith('>')) return null;
	return re.test(line) ? line : null;
}

/** The kinds an index row may point at (archive is not addressable by design). */
const KNOWN_KINDS = ['reference', 'pending'];

/**
 * Recover the kind from an index target such as
 * `~/.dsh/workspace/reference/foo.md` → `reference`.
 * @returns the kind, or '' when the path does not carry a known one.
 */
function kindOfTarget(target) {
	const parts = String(target).split(/[\\/]/).filter((s) => s !== '');
	for (let i = parts.length - 1; i >= 0; i -= 1) {
		if (KNOWN_KINDS.includes(parts[i])) return parts[i];
	}
	return '';
}

/**
 * Normalize a row to a valid kind, falling back to where the file actually
 * lives on disk. Throws when the kind cannot be established — a wrong index is
 * worse than a refused write.
 * @param row - a row object (as produced by readIndex or by the callers).
 * @param p - resolved DSWM paths, used for the on-disk fallback.
 * @returns the row with a guaranteed-valid kind.
 */
function withKind(row, p) {
	if (KNOWN_KINDS.includes(row.kind)) return row;
	const fromTarget = kindOfTarget(row.target ?? '');
	if (fromTarget !== '') return { ...row, kind: fromTarget };
	const file = row.file ?? '';
	if (file !== '') {
		if (existsSync(join(p.reference, file))) return { ...row, kind: 'reference' };
		if (existsSync(join(p.pending, file))) return { ...row, kind: 'pending' };
	}
	throw new Error(`无法确定索引条目「${row.title ?? file}」的类别，已拒绝重写索引以免写出 undefined`);
}

/** Render one index row in the canonical DSWM format. */
export function renderRow({ title, kind, file, summary, date }) {
	if (!KNOWN_KINDS.includes(kind)) {
		throw new Error(`索引行缺少有效类别（${kind ?? 'undefined'}）：「${title ?? file}」`);
	}
	const target = `~/.dsh/workspace/${kind}/${file}`;
	const tail = summary && summary.trim() !== '' ? `${summary.trim()}（${date}）` : `（${date}）`;
	return `- [${title}](${target}) — ${tail}`;
}

/**
 * Write back an index whose row block was replaced.
 *
 * Every row is normalized to a valid kind first (see {@link withKind}) so a
 * render can never emit `workspace/undefined/...`. Rows handed in as raw strings
 * are passed through untouched — they came from disk and are not re-derived.
 */
export function writeIndex(p, rows) {
	const idx = readIndex(p);
	if (!idx.found) throw new Error(`AGENTS.md 中找不到「${INDEX_HEAD}」段落`);
	const body = rows
		.map((r) => (typeof r === 'string' ? r : renderRow(withKind(r, p))))
		.join('\n');
	if (body.includes('workspace/undefined')) {
		throw new Error('拒绝写入：渲染结果含 workspace/undefined（索引行缺少类别）');
	}
	const doc = `${idx.pre}${idx.pre.endsWith('\n') || idx.pre === '' ? '' : '\n'}${body}\n${idx.post.replace(/^\n+/, '\n')}`;
	writeText(p.agents, doc);
}

/** Locate the index row that points at `file` in `kind`. */
export function findRow(idx, kind, file) {
	return idx.rows.find((r) => r.kind === kind && r.file === file) ?? idx.rows.find((r) => r.file === file);
}

/* ------------------------------------------------------------------ items */

/** Derive a filesystem-safe file name (no extension) from a title. */
export function slugify(title) {
	const cleaned = String(title)
		.replace(/[\\/:*?"<>|#^[\]]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '')
		.trim();
	return cleaned === '' ? `entry-${Date.now()}` : cleaned.slice(0, 80);
}

/** First markdown heading of a document, or '' when it has none. */
function firstHeading(text) {
	const m = /^#\s+(.+?)\s*$/m.exec(text.replace(/^\uFEFF/, ''));
	return m === null ? '' : m[1].trim();
}

/** One-line preview for the list. */
function preview(text, max = 90) {
	const body = text
		.replace(/^#.*$/m, '')
		.replace(/^\s*[-*]\s+/gm, '')
		.replace(/[*`>#]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	return body.length > max ? `${body.slice(0, max)}…` : body;
}

/** List every item of one kind (or both) with metadata for the list view. */
export function listItems(p, kinds = KINDS) {
	ensureDirs(p);
	// Self-heal an index polluted with draft rows before reporting state, so the
	// panel never shows "尚未写入索引" against a rule that says drafts are absent.
	try {
		prunePendingRows(p);
	} catch {
		/* repair is best-effort; listing must still work */
	}
	const idx = readIndex(p);
	const items = [];
	for (const kind of kinds) {
		const dir = p[kind];
		if (!existsSync(dir)) continue;
		for (const name of readdirSync(dir)) {
			if (!name.toLowerCase().endsWith('.md')) continue;
			const file = join(dir, name);
			const st = statSync(file);
			const content = readText(file);
			const row = idx.rows.find((r) => r.file === name);
			items.push({
				kind,
				file: name,
				path: file,
				title: firstHeading(content) || (row?.title ?? name.replace(/\.md$/, '')),
				indexTitle: row?.title ?? '',
				summary: row?.summary ?? '',
				date: row?.date ?? '',
				indexed: row !== void 0,
				bytes: st.size,
				mtime: st.mtime.toISOString(),
				preview: preview(content),
				chars: content.length
			});
		}
	}
	// reference first, then pending; each newest-first.
	items.sort((a, b) => (a.kind === b.kind ? b.mtime.localeCompare(a.mtime) : a.kind === 'reference' ? -1 : 1));
	return { items, indexFound: idx.found, total: items.length };
}

/** Read one item: content plus its index row (when present). */
export function getItem(p, kind, file) {
	const dir = p[kind];
	if (!dir) throw new Error(`未知类别：${kind}`);
	const path = join(dir, basename(file));
	if (!existsSync(path)) throw new Error(`条目不存在：${kind}/${file}`);
	const idx = readIndex(p);
	const row = idx.rows.find((r) => r.file === basename(file));
	return {
		kind,
		file: basename(file),
		content: readText(path),
		indexTitle: row?.title ?? '',
		summary: row?.summary ?? '',
		date: row?.date ?? '',
		indexed: row !== void 0,
		agentsPath: p.agents
	};
}

/* ---------------------------------------------------------------- mutations */

/** Append one memory-log line (never throws — logging must not fail a save). */
export function appendLog(p, action, target, note = '') {
	try {
		ensureDirs(p);
		const line = `${stamp()} | ${action} | ${target} | ${note}\n`;
		const prev = readText(p.log);
		writeText(p.log, `${prev.endsWith('\n') || prev === '' ? prev : `${prev}\n`}${line}`);
		return true;
	} catch {
		return false;
	}
}

/** git add -A && commit in the workspace; resolves to a short status string. */
export async function gitCommit(p, message) {
	try {
		if (!existsSync(join(p.ws, '.git'))) return 'no-git';
		const dirty = await execFileAsync('git', ['status', '--porcelain'], { cwd: p.ws });
		if (String(dirty.stdout).trim() === '') return 'clean';
		await execFileAsync('git', ['add', '-A'], { cwd: p.ws });
		await execFileAsync('git', ['-c', 'user.name=dsh-memory', '-c', 'user.email=memory@dsh.local', 'commit', '-q', '-m', message], { cwd: p.ws });
		return 'committed';
	} catch (error) {
		return `error: ${error?.message ?? error}`;
	}
}

/**
 * Save an existing item: rewrite its body, upsert its index row, log, commit.
 *
 * `next` = { title, summary, date, content, kind }. When the title changes the
 * file is renamed to keep the index target meaningful; the index row follows.
 */
export async function saveItem(p, { kind, file, title, summary, date, content }) {
	if (!KINDS.includes(kind)) throw new Error(`未知类别：${kind}`);
	const dir = p[kind];
	const from = join(dir, basename(file));
	if (!existsSync(from)) throw new Error(`条目不存在：${kind}/${file}`);
	const cleanTitle = String(title ?? '').trim() === '' ? basename(file, '.md') : String(title).trim();
	const cleanSummary = String(summary ?? '').trim();
	const cleanDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? '')) ? date : dayStamp();
	const nextFile = `${slugify(cleanTitle)}.md`;
	const body = String(content ?? '');

	// Body first (write, then rename so a title change keeps history).
	writeText(from, body);
	if (nextFile !== basename(file)) {
		const to = join(dir, nextFile);
		if (existsSync(to)) throw new Error(`目标文件名已存在：${nextFile}`);
		renameSync(from, to);
	}

	// Index row: upsert for reference entries, REMOVE for pending ones (rule 2 —
	// drafts never live in the index, even if an older write put them there).
	const idx = readIndex(p);
	const at = idx.rows.findIndex((r) => r.file === basename(file));
	const rows = idx.rows.slice();
	if (kind === 'pending') {
		if (at !== -1) {
			rows.splice(at, 1);
			writeIndex(p, rows);
		}
	} else {
		const row = { title: cleanTitle, kind, file: nextFile, summary: cleanSummary, date: cleanDate };
		if (at === -1) rows.push(row);
		else rows[at] = row;
		writeIndex(p, rows);
	}

	appendLog(p, 'update', `${kind}/${nextFile}`, cleanSummary === '' ? 'WebUI 编辑正文' : `WebUI 编辑：${cleanSummary}`);
	const git = await gitCommit(p, `memory(webui): update ${kind}/${nextFile}`);
	return { ok: true, file: nextFile, renamed: nextFile !== basename(file), git };
}

/**
 * Promote a pending item to reference — the panel's 「确认加入记忆」.
 *
 * Mirrors the DSWM rule: the body moves from pending/ to reference/, the index
 * row is updated in place (kind + file), a `promote` line is logged, and the
 * workspace is committed. Pending items are not in the index by design, so the
 * row is appended when it is somehow absent.
 */
export async function promoteItem(p, { file }) {
	const name = basename(String(file ?? ''));
	if (name === '') throw new Error('缺少文件名');
	const from = join(p.pending, name);
	if (!existsSync(from)) {
		// Already promoted? Say so plainly instead of failing obscurely.
		if (existsSync(join(p.reference, name))) return { ok: true, file: name, kind: 'reference', already: true, git: 'clean' };
		throw new Error(`条目不存在：pending/${name}`);
	}
	ensureDirs(p);
	const to = join(p.reference, name);
	if (existsSync(to)) throw new Error(`reference/ 已存在同名文件：${name}（先改名或归档其一）`);
	renameSync(from, to);

	const content = readText(to);
	const idx = readIndex(p);
	const prev = idx.rows.find((r) => r.file === name);
	const title = prev?.title || firstHeading(content) || name.replace(/\.md$/, '');
	const row = {
		title,
		kind: 'reference',
		file: name,
		summary: prev?.summary ?? '',
		date: /^\d{4}-\d{2}-\d{2}$/.test(prev?.date ?? '') ? prev.date : dayStamp()
	};
	const rows = idx.rows.filter((r) => r.file !== name);
	rows.push(row);
	writeIndex(p, rows);

	appendLog(p, 'promote', `reference/${name}`, `${row.summary || 'WebUI 确认晋升'}（由 pending/ 晋升）`);
	const git = await gitCommit(p, `memory(webui): promote pending/${name} -> reference/${name}`);
	return { ok: true, file: name, kind: 'reference', renamed: false, git };
}

/** Create a new item (reference or pending) plus its index row. */
export async function createItem(p, { kind, title, summary, content }) {
	if (!KINDS.includes(kind)) throw new Error(`未知类别：${kind}`);
	const cleanTitle = String(title ?? '').trim();
	if (cleanTitle === '') throw new Error('标题不能为空');
	ensureDirs(p);
	const file = `${slugify(cleanTitle)}.md`;
	const path = join(p[kind], file);
	if (existsSync(path)) throw new Error(`已存在同名条目：${file}`);
	const body = String(content ?? '').trim() === '' ? `# ${cleanTitle}\n` : String(content);
	writeText(path, body);
	const idx = readIndex(p);
	const rows = idx.rows.slice();
	// DSWM rule 2: `pending/` is the unconfirmed staging area and deliberately
	// does NOT appear in the index — only reference entries are pointers there.
	// (Earlier versions pushed a row for every create, which put drafts into
	// AGENTS.md and made every new session see unconfirmed notes as memory.)
	if (kind === 'reference') {
		rows.push({ title: cleanTitle, kind, file, summary: String(summary ?? '').trim(), date: dayStamp() });
		writeIndex(p, rows);
	}
	appendLog(p, kind === 'pending' ? 'stage' : 'create', `${kind}/${file}`, String(summary ?? '').trim() || 'WebUI 新建');
	const git = await gitCommit(p, `memory(webui): create ${kind}/${file}`);
	return { ok: true, file, git };
}

/**
 * Drop index rows that point into `pending/` — they violate DSWM rule 2.
 *
 * Two writers can produce them: the older `createItem`, and a `saveItem` on a
 * draft (whose upsert adds a row). Rather than only preventing new ones, this
 * repairs an index that already carries them, so a polluted AGENTS.md heals on
 * the next read. Returns the number of rows removed.
 */
export function prunePendingRows(p) {
	const idx = readIndex(p);
	if (!idx.found) return 0;
	const kept = idx.rows.filter((r) => !(r.kind === 'pending' || /[/\\]pending[/\\]/.test(r.target ?? '')));
	const removed = idx.rows.length - kept.length;
	if (removed === 0) return 0;
	writeIndex(p, kept);
	appendLog(p, 'update', 'AGENTS.md', `清理 ${removed} 条指向 pending/ 的索引行（草稿区不进索引）`);
	return removed;
}

/**
 * Delete an item outright (file removed, index row dropped) — for throwaway
 * drafts. Unlike {@link archiveItem} this is not recoverable except through git.
 */
export async function deleteItem(p, { kind, file }) {
	if (!KINDS.includes(kind)) throw new Error(`未知类别：${kind}`);
	const path = join(p[kind], basename(file));
	if (!existsSync(path)) throw new Error(`条目不存在：${kind}/${file}`);
	unlinkSync(path);
	const idx = readIndex(p);
	writeIndex(p, idx.rows.filter((r) => r.file !== basename(file)));
	appendLog(p, 'update', `${kind}/${basename(file)}`, 'WebUI 删除条目（可 git 恢复）');
	const git = await gitCommit(p, `memory(webui): delete ${kind}/${file}`);
	return { ok: true, file: basename(file), git };
}

/**
 * Archive an item: move it into archive/ with a timestamp prefix and drop its
 * index row (DSWM rule 4 — superseded memory is archived, not deleted).
 */
export async function archiveItem(p, { kind, file }) {
	if (!KINDS.includes(kind)) throw new Error(`未知类别：${kind}`);
	const from = join(p[kind], basename(file));
	if (!existsSync(from)) throw new Error(`条目不存在：${kind}/${file}`);
	ensureDirs(p);
	const prefix = stamp().replace(/[: ]/g, '-');
	const to = join(p.archive, `${prefix}-${basename(file)}`);
	renameSync(from, to);
	const idx = readIndex(p);
	writeIndex(p, idx.rows.filter((r) => r.file !== basename(file)));
	appendLog(p, 'archive', `archive/${basename(to)}`, `从 ${kind}/ 归档（WebUI）`);
	const git = await gitCommit(p, `memory(webui): archive ${kind}/${file}`);
	return { ok: true, archived: basename(to), git };
}

export { readText, writeText, INDEX_HEAD, RULES_START };
