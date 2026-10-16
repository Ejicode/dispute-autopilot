import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: () => unknown;
}

/** All pending changes and their ledger entries commit together under a write lock. */
export function migrate(db: Database.Database, migrations: Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1 || !migration.name) throw new Error('Invalid migration sequence');
  });
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    )`);
    const applied = db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all() as {version:number;name:string}[];
    applied.forEach((row, index) => {
      if (row.version !== index + 1 || migrations[index]?.version !== row.version || migrations[index]?.name !== row.name) {
        throw new Error('Database migration history is incompatible with this application version');
      }
    });
    for (const migration of migrations.slice(applied.length)) {
      migration.up();
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
        .run(migration.version, migration.name, new Date().toISOString());
    }
    if ((db.pragma('foreign_key_check') as unknown[]).length) throw new Error('Database foreign key integrity check failed');
  }).immediate();
}
