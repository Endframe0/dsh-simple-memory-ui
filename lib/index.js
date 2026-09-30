/**
 * dsh-simple-memory-ui — host half.
 *
 * Keeps every behaviour of the upstream dsh-simple-wiki-memory plugin
 * (AGENTS.md skeleton sync, workspace scaffold + git init, per-turn auto
 * commit, pending report at the first user turn) and adds an HTTP surface for
 * the Web GUI memory panel:
 *
 *   GET  /dswm/api/list                  → all reference + pending items
 *   GET  /dswm/api/get?kind=&file=       → one item (content + index row)
 *   POST /dswm/api/save                  → update body + index row (+commit)
 *   POST /dswm/api/create                → new item + index row (+commit)
 *   POST /dswm/api/archive               → move item to archive/ (+commit)
 *   GET  /dswm/api/ping                  → health / capability probe
 *
 * The window exposes no credentials and binds to loopback by default; the
 * browser that owns the GUI is the same user, so the panel talks to these
 * routes directly with fetch().
 *
 * Source: extends dsh-simple-wiki-memory (MIT) by rainow.
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveItem, createItem, deleteItem, ensureDirs, getItem, listItems, paths, promoteItem, resolveDshHome, saveItem } from './memory.js';

export const name = 'dsh-simple-memory-ui';

/** Files the plugin ships (relative to this package root). */
const AGENTS_TEMPLATE = 'assets/AGENTS.md.template';
const LOG_TEMPLATE = 'assets/memory-log.md.template';

/** Marker that fences the plugin-owned rules section inside AGENTS.md. */
const RULES_HEAD = '## 持久记忆维护规则（六分支）';
const RULES_START = '## 持久记忆维护规则';
const INDEX_HEAD = '## 记忆索引';

/** Path of the plugin package root. */
function packageRoot() {
	return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Merge the plugin-owned rules section into the user's AGENTS.md.
 * Never overwrites user content: everything from "## 记忆索引" down is user data.
 */
function mergeAgentsTemplate(dshHome) {
	const target = join(dshHome, 'AGENTS.md');
	if (!existsSync(target)) {
		writeFileSync(target, readFileSync(join(packageRoot(), AGENTS_TEMPLATE), 'utf8'));
		return;
	}
	const current = readFileSync(target, 'utf8');
	if (current.includes(RULES_HEAD)) return;
	const template = readFileSync(join(packageRoot(), AGENTS_TEMPLATE), 'utf8');
	const rulesBlock = template.slice(template.indexOf(RULES_START), template.indexOf(INDEX_HEAD)).trimEnd();
	const idx = current.indexOf(INDEX_HEAD);
	const updated = idx === -1
		? `${current.trimEnd()}\n\n${rulesBlock}\n\n${INDEX_HEAD}\n`
		: `${current.slice(0, idx).trimEnd()}\n\n${rulesBlock}\n\n${current.slice(idx)}`;
	writeFileSync(target, updated);
}

/** Scaffold workspace dirs, memory-log, and the git repo. Idempotent. */
function scaffoldWorkspace(dshHome) {
	const p = paths(dshHome);
	ensureDirs(p);
	if (!existsSync(p.log)) writeFileSync(p.log, readFileSync(join(packageRoot(), LOG_TEMPLATE), 'utf8'));
	// Initialize the backup repo on first run. DSWM rule 5 makes the workspace a
	// git repo and every panel write commits into it — without this step a fresh
	// machine gets `no-git` on every save and the memory library has no history
	// at all (which is exactly the safety net the archive flow relies on).
	if (!existsSync(join(p.ws, '.git'))) {
		try {
			execFileSync('git', ['init', '-q'], { cwd: p.ws, stdio: 'ignore' });
			console.log(`[simple-memory-ui] initialized memory git repo at ${p.ws}`);
		} catch (error) {
			console.warn(`[simple-memory-ui] git init 失败（记忆仍可用，只是没有版本历史）：${error?.message ?? error}`);
		}
	}
	return p;
}

/** Commit pending git changes in the workspace, if any. Never throws. */
async function maybeCommit(p) {
	try {
		if (!existsSync(join(p.ws, '.git'))) return;
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		const run = promisify(execFile);
		const dirty = await run('git', ['status', '--porcelain'], { cwd: p.ws });
		if (String(dirty.stdout).trim() === '') return;
		await run('git', ['add', '-A'], { cwd: p.ws });
		await run('git', ['-c', 'user.name=dsh-memory', '-c', 'user.email=memory@dsh.local',
			'commit', '-m', `memory: auto checkpoint ${new Date().toISOString().slice(0, 16)}`], { cwd: p.ws });
	} catch {
		/* commit failure is non-fatal */
	}
}

/**
 * Report pending items as a short user-visible summary (null when none).
 * @param p - resolved DSWM paths.
 * @returns the message text the model reads plus the one-line source summary.
 */
function pendingReport(p) {
	try {
		if (!existsSync(p.pending)) return null;
		const items = readdirSync(p.pending).filter((f) => f.endsWith('.md'));
		if (items.length === 0) return null;
		return {
			text: `【DSWM】有 ${items.length} 条待确认记忆（~/.dsh/workspace/pending/）：\n${items.map((f) => `- ${f}`).join('\n')}\n说"存档/确认"可晋升到正式记忆，或忽略。`,
			notice: `DSWM 待确认记忆 ${items.length} 条`
		};
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------- HTTP */

const MAX_BODY = 8 * 1024 * 1024;

/** Read a JSON request body (bounded). */
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY) throw new Error('请求体过大');
		chunks.push(chunk);
	}
	if (chunks.length === 0) return {};
	const text = Buffer.concat(chunks).toString('utf8');
	return text.trim() === '' ? {} : JSON.parse(text);
}

/** Send a JSON response. */
function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'content-length': Buffer.byteLength(body)
	});
	res.end(body);
}

/**
 * Build the request handler for the /dswm/api prefix.
 * @param p - resolved DSWM paths.
 * @returns a node:http handler owning its full response lifecycle.
 */
function makeApiHandler(p) {
	return async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://dswm.internal');
		const route = url.pathname.replace(/^\/dswm\/api\/?/, '').replace(/\/$/, '');
		try {
			if (route === '' || route === 'ping') {
				sendJson(res, 200, {
					ok: true,
					plugin: name,
					dshHome: p.dshHome,
					workspace: p.ws,
					agents: p.agents,
					kinds: ['reference', 'pending'],
					indexFound: existsSync(p.agents)
				});
				return;
			}
			if (route === 'list') {
				sendJson(res, 200, { ok: true, ...listItems(p) });
				return;
			}
			if (route === 'get') {
				const kind = url.searchParams.get('kind') ?? '';
				const file = url.searchParams.get('file') ?? '';
				sendJson(res, 200, { ok: true, ...getItem(p, kind, file) });
				return;
			}
			if (req.method !== 'POST') {
				sendJson(res, 405, { ok: false, error: `不支持的方法：${req.method}` });
				return;
			}
			const body = await readJsonBody(req);
			if (route === 'save') {
				sendJson(res, 200, await saveItem(p, body));
				return;
			}
			if (route === 'create') {
				sendJson(res, 200, await createItem(p, body));
				return;
			}
			if (route === 'archive') {
				sendJson(res, 200, await archiveItem(p, body));
				return;
			}
			if (route === 'promote') {
				sendJson(res, 200, await promoteItem(p, body));
				return;
			}
			if (route === 'delete') {
				sendJson(res, 200, await deleteItem(p, body));
				return;
			}
			sendJson(res, 404, { ok: false, error: `未知接口：${route}` });
		} catch (error) {
			sendJson(res, 400, { ok: false, error: error?.message ?? String(error) });
		}
	};
}

/** Plugin entry. Never throws — a memory plugin must never brick the harness. */
export function apply(ctx, config = {}) {
	let p;
	try {
		const dshHome = resolveDshHome();
		p = scaffoldWorkspace(dshHome);
		mergeAgentsTemplate(dshHome);
	} catch (error) {
		console.warn(`[simple-memory-ui] init failed (memory plugin disabled): ${error?.message ?? error}`);
		return;
	}
	const reported = new WeakSet();

	// HTTP surface for the Web GUI settings panel (prefix route: /dswm/api/...).
	const webServer = ctx.webServer;
	if (webServer !== void 0 && typeof webServer.register === 'function') {
		try {
			ctx.effect(() => webServer.register({
				kind: 'prefix',
				path: '/dswm/api',
				handler: makeApiHandler(p)
			}), 'simple-memory-ui: api routes');
			console.log('[simple-memory-ui] memory panel API mounted at /dswm/api');
		} catch (error) {
			console.warn(`[simple-memory-ui] 路由注册失败：${error?.message ?? error}`);
		}
	} else {
		console.warn('[simple-memory-ui] webServer 服务不可用，Web 面板接口未挂载');
	}

	// Auto-commit after each turn (debounced per session via WeakMap of timers).
	const timers = new WeakMap();
	ctx.on('session/event', (session, event) => {
		if (event?.type !== 'turn/end') return;
		const old = timers.get(session);
		if (old !== void 0) clearTimeout(old);
		timers.set(session, setTimeout(() => {
			timers.delete(session);
			void maybeCommit(p);
		}, 1500));
	});

	// Pending report: inject once per session at the first user turn.
	ctx.on('agent/pre-step', async (payload, next) => {
		const decision = await next();
		if (decision?.kind !== 'enter') return decision;
		const agent = payload?.agent;
		if (agent === void 0 || reported.has(agent)) return decision;
		const report = pendingReport(p);
		if (report === null) return decision;
		reported.add(agent);
		// Source shape: session format v4 (dsh >= 0.2) admits **producer-owned**
		// source kinds only — `{kind: 'plugin', plugin}` is the retired v3 wrapper
		// and `assertV4MessageSources` refuses it ("format v4 message requires a
		// producer-owned source kind"), which would fail the very step this report
		// is injected into. So the kind names the producing plugin and the payload
		// is described by the shared ContextFormed variants, exactly as
		// dsh-time-context does it. Pre-0.2 runtimes do not validate the source at
		// all, so one shape works on both.
		const message = createUserMessage({
			content: [{ type: 'text', text: report.text }],
			source: { kind: name, form: 'notice', summary: report.notice }
		});
		return { ...decision, messages: [...decision.messages, message] };
	}, { prepend: true });
}

export default { name, apply };
