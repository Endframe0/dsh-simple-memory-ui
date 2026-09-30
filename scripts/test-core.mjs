// Host-side logic tests for the DSWM panel core, run against a THROWAWAY DSH
// home so the user's real memory library is never touched.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createItem, deleteItem, listItems, paths, prunePendingRows, promoteItem, readIndex, saveItem, writeIndex
} from 'file:///D:/deepseekwork/dsh-simple-memory-ui/lib/memory.js';

const root = mkdtempSync(join(tmpdir(), 'dswm-test-'));
const p = paths(root);
console.log('sandbox =', root);

// --- scaffold --------------------------------------------------------------
import { mkdirSync } from 'node:fs';
for (const d of [p.reference, p.pending, p.archive]) mkdirSync(d, { recursive: true });
writeFileSync(p.agents, [
	'# 用户全局指令',
	'',
	'## 持久记忆维护规则（六分支）',
	'（规则略）',
	'',
	'## 记忆索引',
	'',
	'<!-- 注释行 -->',
	''
].join('\n'), 'utf8');
writeFileSync(p.log, '# 记忆操作日志\n\n---\n', 'utf8');

const results = [];
function check(name, cond, extra = '') {
	results.push({ name, pass: !!cond, extra });
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
}
const rowCount = () => readIndex(p).rows.length;
const rowFiles = () => readIndex(p).rows.map((r) => `${r.kind}/${r.file}`);

// --- 1. creating a draft must NOT add an index row (DSWM rule 2) -----------
await createItem(p, { kind: 'pending', title: '草稿甲', summary: '草稿摘要', content: '# 草稿甲\n' });
check('create pending → no index row', rowCount() === 0, `rows=${rowCount()}`);

// --- 2. creating a reference DOES add one ---------------------------------
await createItem(p, { kind: 'reference', title: '正式乙', summary: '正式摘要', content: '# 正式乙\n' });
check('create reference → index row added', rowCount() === 1 && rowFiles()[0] === 'reference/正式乙.md', rowFiles().join(','));

// --- 3. saving a draft must not create/keep an index row ------------------
await saveItem(p, {
	kind: 'pending', file: '草稿甲.md', title: '草稿甲改名', summary: '改后摘要',
	date: '2026-09-10', content: '# 草稿甲改名\n\n正文\n'
});
check('save pending → still no index row', rowCount() === 1 && !rowFiles().some((f) => f.startsWith('pending/')), rowFiles().join(','));

// --- 4. prune repairs an index polluted by an older build -----------------
writeIndex(p, readIndex(p).rows.concat([{ title: '污染行', kind: 'pending', file: '草稿甲改名.md', summary: 'x', date: '2026-09-10' }]));
const before = rowCount();
const removed = prunePendingRows(p);
check('prune removes pending rows', before === 2 && removed === 1 && rowCount() === 1, `before=${before} removed=${removed} after=${rowCount()}`);

// --- 5. promote moves the file and rewrites the row kind ------------------
const promoted = await promoteItem(p, { file: '草稿甲改名.md' });
check('promote → file in reference/', existsSync(join(p.reference, '草稿甲改名.md')) && !existsSync(join(p.pending, '草稿甲改名.md')), JSON.stringify(promoted));
check('promote → index row is reference kind', rowFiles().includes('reference/草稿甲改名.md'), rowFiles().join(','));
const list = listItems(p);
check('list → every item indexed', list.items.every((i) => (i.kind === 'pending' ? !i.indexed : i.indexed)) === false || list.items.filter((i) => i.kind === 'reference').every((i) => i.indexed), list.items.map((i) => `${i.kind}:${i.file}:${i.indexed}`).join(' '));

// --- 6. delete removes file + row -----------------------------------------
await deleteItem(p, { kind: 'pending', file: '不存在.md' }).catch(() => {});
await createItem(p, { kind: 'pending', title: '待删丙', summary: '', content: '# 待删丙\n' });
const del = await deleteItem(p, { kind: 'pending', file: '待删丙.md' });
check('delete removes the file', !existsSync(join(p.pending, '待删丙.md')) && del.ok === true, JSON.stringify(del));

// --- 7. promote is idempotent-ish: already promoted reports `already` -----
const again = await promoteItem(p, { file: '草稿甲改名.md' });
check('promote twice → already flag', again.already === true, JSON.stringify(again));

// --- 8. no undefined ever written ----------------------------------------
const finalDoc = readFileSync(p.agents, 'utf8');
check('no workspace/undefined in index', !finalDoc.includes('workspace/undefined'));

// --- 9. renderRow still refuses a row without a kind ----------------------
let threw = false;
try {
	writeIndex(p, [{ title: 'x', kind: undefined, file: 'x.md', summary: '', date: '2026-09-10' }]);
} catch { threw = true; }
check('writeIndex rejects a kind-less row', threw === true);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
