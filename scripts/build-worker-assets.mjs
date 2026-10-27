import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { securityHeaders } from '../server/http-policy.mjs';

const root = process.cwd();
const output = join(root, 'worker-assets');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(root, 'index.html'), join(output, 'index.html'));
await cp(join(root, 'src'), join(output, 'src'), {
  recursive: true,
  filter(source) {
    return !source.endsWith('.test.js') && !source.endsWith('.integration.test.js');
  },
});

// Static files under /src/ are served by the asset layer without running the
// Worker, so they get the same security headers from a _headers file.
const headerLines = Object.entries(securityHeaders({ hsts: true }))
  .map(([name, value]) => `  ${name}: ${value}`);
await writeFile(join(output, '_headers'), `/*\n${headerLines.join('\n')}\n`);

console.log('Built static Worker assets in worker-assets/.');
