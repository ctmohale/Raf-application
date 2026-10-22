import { db, initializeDatabase } from './db.js';
import { config } from '../config.js';

try {
  await initializeDatabase({ retries: 1 });
  if (config.databaseDriver === 'mysql') {
    const result = await db.prepare('SELECT DATABASE() AS database_name, VERSION() AS version').get();
    console.log(`MySQL connected: ${result.database_name} (${result.version})`);
  } else {
    await db.prepare('SELECT 1 AS ok').get();
    console.log('SQLite connected');
  }
} catch (error) {
  console.error(`Database connection failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
