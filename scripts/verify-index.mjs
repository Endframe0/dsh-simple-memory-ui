// Verify the real readIndex/renderRow round-trip against the live index.
// This is the exact code path that once rewrote every row as "undefined".
import { readIndex, renderRow, paths, resolveDshHome } from 'file:///D:/deepseekwork/dsh-simple-memory-ui/lib/memory.js';

const p = paths(resolveDshHome());
const idx = readIndex(p);
console.log('found       =', idx.found);
console.log('rows        =', idx.rows.length);
console.log('kinds       =', idx.rows.map((r) => r.kind).join(','));
console.log('files       =', idx.rows.map((r) => r.file).join(', '));

const reRendered = idx.rows.map((r) => renderRow(r));
let mismatches = 0;
for (let i = 0; i < reRendered.length; i += 1) {
	if (reRendered[i] !== idx.rows[i].raw) {
		mismatches += 1;
		console.log('MISMATCH row', i);
		console.log('  on disk:', JSON.stringify(idx.rows[i].raw));
		console.log('  render :', JSON.stringify(reRendered[i]));
	}
}
console.log('round-trip identical =', reRendered.length - mismatches, '/', reRendered.length);
console.log('any undefined        =', reRendered.some((s) => s.includes('undefined')));
console.log('pre ends with        =', JSON.stringify(idx.pre.slice(-40)));
console.log('post starts with     =', JSON.stringify(idx.post.slice(0, 40)));
