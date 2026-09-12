import { cp, mkdir } from 'node:fs/promises';
await mkdir('public/counter', { recursive: true });
for (const directory of ['keys', 'zkir']) {
  await cp(`managed/counter/${directory}`, `public/counter/${directory}`, { recursive: true });
}
