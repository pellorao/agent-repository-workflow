import {join} from 'node:path';

/** @typedef {'main-to-agent'|'agent-to-main'} MessageDirection */
/** @typedef {'accepted'|'delivered'|'failed'|'unknown'} DeliveryStatus */
/** @typedef {'main'|'agent'|'provider-program'} MessageSource */
/** @typedef {'persisted'|'nonpersisted'} PersistenceStatus */
/** @typedef {{messageId:string,runId:string,sequence:number,direction:MessageDirection,source?:MessageSource,body:string,deliveryStatus:DeliveryStatus,acceptedAtMs:number,deliveredAtMs:number|null,threadId:string|null,turnId:string|null,persistenceStatus:PersistenceStatus}} StoredMessage */

/** @param {string} runtimeDirectory */
export const backgroundAgentMessageDatabasePaths = runtimeDirectory => {
  const database = join(runtimeDirectory, 'messages.sqlite');
  return {database, wal:`${database}-wal`, shm:`${database}-shm`, journal:`${database}-journal`};
};

/**
 * Message statements use the Agent store's connection and transaction. This
 * module neither opens a second database nor retains a second message queue.
 * @param {import('node:sqlite').DatabaseSync} database
 */
export function createBackgroundAgentMessageStatements(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES agents(run_id),
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      direction TEXT NOT NULL CHECK (direction IN ('main-to-agent','agent-to-main')),
      body TEXT NOT NULL,
      delivery_status TEXT NOT NULL CHECK (delivery_status IN ('accepted','delivered','failed','unknown')),
      accepted_at_ms INTEGER NOT NULL,
      delivered_at_ms INTEGER,
      thread_id TEXT,
      turn_id TEXT,
      source TEXT NOT NULL,
      UNIQUE (run_id,sequence)
    );
    CREATE INDEX IF NOT EXISTS messages_run_direction_sequence ON messages(run_id,direction,sequence);
    CREATE INDEX IF NOT EXISTS messages_delivered_at ON messages(delivered_at_ms);
  `);
  if(!database.prepare('PRAGMA table_info(messages)').all().some(column=>column.name==='source')) {
    database.exec("ALTER TABLE messages ADD COLUMN source TEXT NOT NULL DEFAULT 'main'; UPDATE messages SET source='agent' WHERE direction='agent-to-main'");
  }
  return {
    upsert: database.prepare(`INSERT INTO messages
      (message_id,run_id,sequence,direction,body,delivery_status,accepted_at_ms,delivered_at_ms,thread_id,turn_id,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(message_id) DO UPDATE SET body=excluded.body,delivery_status=excluded.delivery_status,
        delivered_at_ms=excluded.delivered_at_ms,thread_id=excluded.thread_id,turn_id=excluded.turn_id,source=excluded.source`),
    get: database.prepare('SELECT * FROM messages WHERE message_id=?'),
    latestSequence: database.prepare('SELECT MAX(sequence) AS sequence FROM messages WHERE run_id=?'),
    page: database.prepare(`SELECT message_id,run_id,sequence,direction,substr(body,1,100) AS preview,
      delivery_status,accepted_at_ms,delivered_at_ms,thread_id,turn_id,source FROM messages
      WHERE run_id=? AND direction=? AND sequence<? AND (delivered_at_ms IS NULL OR delivered_at_ms>?)
      ORDER BY sequence DESC LIMIT ?`),
    after: database.prepare(`SELECT * FROM messages WHERE run_id=? AND direction=? AND sequence>?
      AND (delivered_at_ms IS NULL OR delivered_at_ms>?) ORDER BY sequence ASC`),
    pending: database.prepare(`SELECT * FROM messages WHERE run_id=? AND direction=? AND delivery_status='accepted'
      AND (delivered_at_ms IS NULL OR delivered_at_ms>?) ORDER BY sequence ASC`),
    expired: database.prepare('SELECT 1 AS present FROM messages WHERE delivered_at_ms IS NOT NULL AND delivered_at_ms<=? LIMIT 1'),
    nextExpiry: database.prepare('SELECT MIN(delivered_at_ms) AS time FROM messages WHERE delivered_at_ms>?'),
    deleteExpired: database.prepare('DELETE FROM messages WHERE delivered_at_ms IS NOT NULL AND delivered_at_ms<=?'),
  };
}
