import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const backendBaseUrl = process.env.BACKEND_URL ?? '';

const target = join(process.cwd(), 'src/environments/environment.prod.ts');
let content = readFileSync(target, 'utf8');
content = content.replace(
  /apiUrl:\s*'[^']*'/,
  `apiUrl: '${backendBaseUrl.replace(/\/+$/, '')}/api/v1'`
);
writeFileSync(target, content);

console.log(`Rewrote ${target} with apiUrl=${backendBaseUrl.replace(/\/+$/, '')}/api/v1`);
