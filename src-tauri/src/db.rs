use anyhow::Result;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

/// Local persistence.
///
/// Holds provider metadata, usage snapshots, sessions, activities, projects,
/// preferences, and notification settings. It deliberately holds no
/// credentials: those live in the OS keychain (see `secrets.rs`), because a
/// SQLite file is readable by anything running as the user.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(dir: &PathBuf) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let conn = Connection::open(dir.join("control-center.sqlite3"))?;

        // WAL keeps the writer from blocking the panel's reads, and the panel
        // is latency-sensitive in a way a background writer is not.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS providers (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                connected     INTEGER NOT NULL DEFAULT 0,
                last_updated  INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS usage_snapshots (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_id   TEXT NOT NULL,
                used          INTEGER NOT NULL,
                cap           INTEGER,
                percentage    REAL NOT NULL,
                reset_at      INTEGER,
                source        TEXT NOT NULL,
                captured_at   INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_usage_captured
                ON usage_snapshots (captured_at DESC);

            CREATE TABLE IF NOT EXISTS sessions (
                id               TEXT PRIMARY KEY,
                provider_id      TEXT NOT NULL,
                project          TEXT NOT NULL,
                project_path     TEXT NOT NULL,
                status           TEXT NOT NULL,
                started_at       INTEGER NOT NULL,
                last_activity_at INTEGER NOT NULL,
                current_activity TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_activity
                ON sessions (last_activity_at DESC);

            CREATE TABLE IF NOT EXISTS activities (
                id           TEXT PRIMARY KEY,
                provider_id  TEXT NOT NULL,
                session_id   TEXT,
                project      TEXT,
                type         TEXT NOT NULL,
                message      TEXT NOT NULL,
                timestamp    INTEGER NOT NULL,
                source       TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_activities_ts
                ON activities (timestamp DESC);

            CREATE TABLE IF NOT EXISTS projects (
                id             TEXT PRIMARY KEY,
                name           TEXT NOT NULL,
                path           TEXT NOT NULL,
                last_active_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS preferences (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        )?;

        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Settings are stored as one JSON blob: they are read and written whole,
    /// and a column per preference would be migration churn for no gain.
    pub fn save_settings(&self, json: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO preferences (key, value) VALUES ('settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![json],
        )?;
        Ok(())
    }

    pub fn load_settings(&self) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM preferences WHERE key = 'settings'")?;
        let mut rows = stmt.query([])?;
        Ok(match rows.next()? {
            Some(row) => Some(row.get(0)?),
            None => None,
        })
    }

    /// Record one usage reading, for the history the panel plots.
    pub fn record_usage(
        &self,
        provider_id: &str,
        used: i64,
        cap: Option<i64>,
        percentage: f64,
        reset_at: Option<i64>,
        source: &str,
        captured_at: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO usage_snapshots
                (provider_id, used, cap, percentage, reset_at, source, captured_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![provider_id, used, cap, percentage, reset_at, source, captured_at],
        )?;
        Ok(())
    }

    /// Drop anything past the retention window. `days == 0` means keep all.
    pub fn prune(&self, days: i64, now_ms: i64) -> Result<()> {
        if days <= 0 {
            return Ok(());
        }
        let cutoff = now_ms - days * 86_400_000;
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM activities WHERE timestamp < ?1", params![cutoff])?;
        conn.execute(
            "DELETE FROM usage_snapshots WHERE captured_at < ?1",
            params![cutoff],
        )?;
        conn.execute(
            "DELETE FROM sessions WHERE last_activity_at < ?1",
            params![cutoff],
        )?;
        Ok(())
    }

    /// Clear everything the user generated, keeping their preferences.
    pub fn clear_local_data(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "DELETE FROM activities;
             DELETE FROM usage_snapshots;
             DELETE FROM sessions;
             DELETE FROM projects;
             VACUUM;",
        )?;
        Ok(())
    }
}
