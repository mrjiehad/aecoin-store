import { createClient } from '@libsql/client';

export interface DatabaseConfig {
  url: string;
  authToken?: string;
}

export function createDatabase(config: DatabaseConfig) {
  return createClient({
    url: config.url,
    authToken: config.authToken,
  });
}

// Database adapter that works with both Cloudflare D1 and Turso
export class DatabaseAdapter {
  private client: any;

  constructor(client: any) {
    this.client = client;
  }

  async prepare(query: string) {
    // Handle both D1 (Cloudflare) and Turso clients
    if (this.client.prepare) {
      // D1 style
      return this.client.prepare(query);
    } else {
      // Turso style
      return {
        bind: (...params: any[]) => ({
          first: async () => {
            const result = await this.client.execute({ sql: query, args: params });
            return result.rows[0] || null;
          },
          all: async () => {
            const result = await this.client.execute({ sql: query, args: params });
            return result.rows;
          },
          run: async () => {
            const result = await this.client.execute({ sql: query, args: params });
            return {
              meta: {
                last_row_id: result.lastInsertRowid,
                changes: result.rowsAffected
              }
            };
          }
        }),
        first: async () => {
          const result = await this.client.execute({ sql: query, args: [] });
          return result.rows[0] || null;
        },
        all: async () => {
          const result = await this.client.execute({ sql: query, args: [] });
          return result.rows;
        },
        run: async () => {
          const result = await this.client.execute({ sql: query, args: [] });
          return {
            meta: {
              last_row_id: result.lastInsertRowid,
              changes: result.rowsAffected
            }
          };
        }
      };
    }
  }
}

export function initDatabase(env: any) {
  if (env.DB) {
    // Cloudflare D1
    return new DatabaseAdapter(env.DB);
  } else if (env.DATABASE_URL) {
    // Turso
    const client = createDatabase({
      url: env.DATABASE_URL,
      authToken: env.DATABASE_AUTH_TOKEN,
    });
    return new DatabaseAdapter(client);
  } else {
    throw new Error('No database configuration found');
  }
}