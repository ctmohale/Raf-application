import { db, initializeDatabase } from './db.js';

try {
  await initializeDatabase({ retries: 1 });
  const result = await db.prepare('SELECT DATABASE() AS database_name, VERSION() AS version').get();
  console.log(`MySQL connected: ${result.database_name} (${result.version})`);
} catch (error) {
  console.error(`MySQL connection failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
