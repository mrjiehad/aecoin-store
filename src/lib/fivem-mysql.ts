import mysql from 'mysql2/promise';

interface FiveMDBConfig {
  host: string;
  user: string;
  password?: string;
  database: string;
  port?: number;
}

export async function insertRedeemCode(config: FiveMDBConfig, code: string, credit: number): Promise<void> {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: config.host,
      user: config.user,
      password: config.password,
      database: config.database,
      port: config.port,
      connectTimeout: 10000, // 10 seconds timeout for connection
    });

    const query = 'INSERT INTO ak4y_donatesystem_codes (code, credit) VALUES (?, ?)';
    await connection.execute(query, [code, credit]);

    console.log(`Successfully inserted code '${code}' with credit '${credit}' into FiveM DB.`);
  } catch (error) {
    console.error(`Failed to insert code '${code}' into FiveM DB:`, error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}
