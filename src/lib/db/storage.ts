import fs from 'node:fs';
import path from 'node:path';

export function dataDirectory(): string {
  const directory = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}
