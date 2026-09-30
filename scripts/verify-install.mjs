#!/usr/bin/env node
/**
 * Post-install self-check for dsh-simple-memory-ui.
 *
 * Why this exists: `dsh plugin add` is not reliably atomic about the profile
 * manifest. On a first install it can write the package into `dependencies`
 * while leaving `dsh.profile.bundles` untouched — the plugin then loads as a
 * dependency but is NEVER composed into the plugin tree, and every /dswm/api
 * route answers 404 with no error anywhere. Running `add` a second time fixes
 * it (the command then reports "Already up to date" and syncs bundles), but a
 * user following the README once would just see a missing settings page.
 *
 * This script inspects the manifest, reports exactly what is wrong, and can
 * repair it in place.
 *
 * Usage:
 *   node scripts/verify-install.mjs                 # report only
 *   node scripts/verify-install.mjs --fix           # repair missing bundles entry
 *   node scripts/verify-install.mjs --profile web   # target another profile
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PKG = 'dsh-simple-memory-ui';

function arg(name, fallback) {
	const i = process.argv.indexOf(name);
	return i === -1 || i + 1 >= process.argv.length ? fallback : process.argv[i + 1];
}

const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
const profile = arg('--profile', 'web');
const fix = process.argv.includes('--fix');
const manifestPath = join(dshHome, 'profiles', profile, 'package.json');

const problems = [];
const notes = [];
let inBundlesFixed = false;

console.log(`DSH_HOME = ${dshHome}`);
console.log(`profile  = ${profile}`);
console.log(`manifest = ${manifestPath}`);
console.log('');

if (!existsSync(manifestPath)) {
	console.error(`✗ 找不到 profile 清单：${manifestPath}`);
	console.error('  请确认 DSH 安装位置（或用 DSH_HOME 指定），以及该 profile 是否已创建。');
	process.exit(1);
}

const raw = readFileSync(manifestPath, 'utf8');
if (raw.charCodeAt(0) === 0xfeff) {
	problems.push('清单文件带 UTF-8 BOM —— dsh 用 JSON.parse 读取，会直接启动失败（删除 BOM 即可）。');
}

let manifest;
try {
	manifest = JSON.parse(raw.replace(/^\uFEFF/, ''));
} catch (error) {
	console.error(`✗ 清单不是合法 JSON：${error.message}`);
	process.exit(1);
}

const inDeps = Object.prototype.hasOwnProperty.call(manifest.dependencies ?? {}, PKG);
const bundles = manifest.dsh?.profile?.bundles ?? [];
const inBundles = bundles.includes(PKG);

console.log(`依赖已声明 (dependencies)      : ${inDeps ? '✓ 是' : '✗ 否'}`);
console.log(`已登记插件树 (profile.bundles) : ${inBundles ? '✓ 是' : '✗ 否'}`);
console.log('');

if (!inDeps) problems.push(`dependencies 里没有 ${PKG} —— 插件还没装（先跑 dsh plugin --profile ${profile} add ...）。`);
if (inDeps && !inBundles) {
	problems.push(
		`包装上了但没登记进 dsh.profile.bundles —— 插件不会被装配，面板不会出现、/dswm/api 返回 404。\n`
		+ `    修法（任选）：重新执行一次同一条 add（会提示 Already up to date 并补登记），或运行本脚本加 --fix。`
	);
}

// The client half needs a settings slot section; a missing host bundle is the
// usual cause, but a stale dsh build without client slots also breaks the page.
notes.push('安装/升级后必须重启 dsh web 并刷新浏览器页面（客户端 bundle 元数据有缓存）。');
notes.push('验证接口：curl http://127.0.0.1:<port>/dswm/api/ping');

if (fix && problems.length > 0 && inDeps && !inBundles) {
	manifest.dsh ??= {};
	manifest.dsh.profile ??= {};
	manifest.dsh.profile.bundles = [...bundles, PKG];
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	console.log(`✓ 已补登记 ${PKG} 到 dsh.profile.bundles`);
	// The finding is resolved now — don't keep reporting it as a failure.
	problems.length = 0;
	inBundlesFixed = true;
	console.log('');
}

const remaining = problems.filter((p) => !(inBundlesFixed && p.startsWith('包装上了但没登记')));
if (remaining.length === 0) {
	console.log(inBundlesFixed ? '✓ 修复完成，重启 dsh web 后生效。' : '✓ 安装看起来是完整的。');
} else {
	for (const p of remaining) console.log(`✗ ${p}`);
}
console.log('');

for (const n of notes) console.log(`· ${n}`);

// After a successful repair the manifest is correct, so this is not a failure.
process.exit(remaining.length === 0 ? 0 : 1);
