import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Substitutes the build-time BACKEND_URL variable into the Angular
// environment file before `ng build` runs. The compose file passes
// BACKEND_URL as a build arg; the Dockerfile forwards it here.
//
// Fallback: when BACKEND_URL is not set (e.g. a plain `ng build`
// outside Docker), the app is served from the same origin and /api/v1
// is proxied to the backend.
const backendBaseUrl = process.env.BACKEND_URL ?? '';

const target = join(process.cwd(), 'src/environments/environment.prod.ts');
let content = readFileSync(target, 'utf8');
content = content.replace(
  /apiUrl:\s*'[^']*'/,
  `apiUrl: '${backendBaseUrl.replace(/\/+$/, '')}/api/v1'`
);
writeFileSync(target, content);

console.log(`Rewrote ${target} with apiUrl=${backendBaseUrl.replace(/\/+$/, '')}/api/v1`);
