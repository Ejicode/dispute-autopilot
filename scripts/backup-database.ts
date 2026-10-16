import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Online SQLite backup includes committed WAL records. Destination must be new.
async function main() {
  const [source, destination, ...extra] = process.argv.slice(2);
  if (!source || !destination || extra.length) throw new Error('Usage: npm run db:backup -- SOURCE.db NEW_BACKUP.db');
  const input = path.resolve(source), output = path.resolve(destination);
  if (input === output) throw new Error('Source and destination must differ');
  const db = new Database(input, { readonly: true, fileMustExist: true });
  let reserved = false;
  try {
    fs.closeSync(fs.openSync(output, 'wx', 0o600)); reserved = true;
    await db.backup(output);
    const backup = new Database(output, { readonly: true, fileMustExist: true });
    try {
      if (backup.pragma('integrity_check', { simple: true }) !== 'ok' || (backup.pragma('foreign_key_check') as unknown[]).length) throw new Error('Backup integrity check failed');
    } finally { backup.close(); }
    console.log('Verified SQLite backup created: ' + output);
  } catch (error) {
    if (reserved) fs.unlinkSync(output);
    throw error;
  } finally { db.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
