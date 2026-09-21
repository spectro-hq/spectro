import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const sql = postgres(
  process.env.SPECTRO_POSTGRES_URL ?? 'postgres://spectro:spectro_local@127.0.0.1:5432/spectro',
  { max: 1 },
);
const migrationsUrl = new URL('../migrations/', import.meta.url);

try {
  await sql`
    CREATE TABLE IF NOT EXISTS control_plane_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const names = (await readdir(migrationsUrl)).filter((name) => name.endsWith('.sql'));
  // oxlint-disable-next-line unicorn/no-array-sort -- the configured TypeScript lib predates toSorted.
  names.sort();
  for (const name of names) {
    // oxlint-disable-next-line no-await-in-loop -- migrations must observe the ordered ledger state.
    const [existing] = await sql<{ readonly exists: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM control_plane_migrations WHERE name = ${name}) AS exists
    `;
    if (existing?.exists) continue;
    // oxlint-disable-next-line no-await-in-loop -- migration files are intentionally applied in order.
    const source = await readFile(fileURLToPath(new URL(name, migrationsUrl)), 'utf8');
    // oxlint-disable-next-line no-await-in-loop -- concurrent schema migrations would violate ordering.
    await sql.begin(async (transaction) => {
      await transaction.unsafe(source);
      await transaction`INSERT INTO control_plane_migrations (name) VALUES (${name})`;
    });
  }
} finally {
  await sql.end();
}
