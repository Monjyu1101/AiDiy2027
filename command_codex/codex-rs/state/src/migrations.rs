use std::borrow::Cow;
use std::collections::HashMap;

use crate::sqlite::SqliteWriteQueryExt;
use sqlx::AssertSqlSafe;
use sqlx::SqlSafeStr;
use sqlx::migrate::Migration;
use sqlx::migrate::Migrator;
use sqlx_sqlite::SqlitePool;

pub(crate) static STATE_MIGRATOR: Migrator = sqlx_macros::migrate!("./migrations");
pub(crate) static LOGS_MIGRATOR: Migrator = sqlx_macros::migrate!("./logs_migrations");
pub(crate) static GOALS_MIGRATOR: Migrator = sqlx_macros::migrate!("./goals_migrations");
pub(crate) static MEMORIES_MIGRATOR: Migrator = sqlx_macros::migrate!("./memory_migrations");
pub(crate) static QUEUE_MIGRATOR: Migrator = sqlx_macros::migrate!("./queue_migrations");
pub(crate) static THREAD_HISTORY_MIGRATOR: Migrator =
    sqlx_macros::migrate!("./thread_history_migrations");

/// Allow an older Codex binary to open a database that has already been
/// migrated by a newer binary running in parallel.
///
/// We intentionally ignore applied migration versions that are newer than the
/// embedded migration set. Known migration versions are still validated by
/// checksum, so this only relaxes the "database is ahead of me" case.
fn runtime_migrator(base: &'static Migrator) -> Migrator {
    Migrator {
        migrations: Cow::Borrowed(base.migrations.as_ref()),
        ignore_missing: true,
        locking: base.locking,
        no_tx: base.no_tx,
        table_name: base.table_name.clone(),
        create_schemas: base.create_schemas.clone(),
    }
}

pub(crate) fn runtime_state_migrator() -> Migrator {
    runtime_migrator(&STATE_MIGRATOR)
}

pub(crate) fn runtime_logs_migrator() -> Migrator {
    runtime_migrator(&LOGS_MIGRATOR)
}

pub(crate) fn runtime_goals_migrator() -> Migrator {
    runtime_migrator(&GOALS_MIGRATOR)
}

pub(crate) fn runtime_memories_migrator() -> Migrator {
    runtime_migrator(&MEMORIES_MIGRATOR)
}

pub(crate) fn runtime_queue_migrator() -> Migrator {
    runtime_migrator(&QUEUE_MIGRATOR)
}

// The paginated history projector will call this when it takes ownership of opening the database.
#[allow(dead_code)]
pub(crate) fn runtime_thread_history_migrator() -> Migrator {
    runtime_migrator(&THREAD_HISTORY_MIGRATOR)
}

/// AiDiy: 公式 Codex の Windows 版は CRLF 改行の SQL で checksum を記録する。
/// 同梱ソースは LF のため、改行だけが異なる適用済みマイグレーションは DB の checksum を採用し、
/// Windows で新たに適用するものは CRLF の checksum で記録して、公式版と同じ `~/.codex` を共有する。
/// 改行以外が異なる場合はそのまま SQLx の不一致エラーにする。
pub(crate) async fn align_line_ending_checksums(
    pool: &SqlitePool,
    migrator: &Migrator,
) -> anyhow::Result<Migrator> {
    let table_exists = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(migrator.table_name.as_ref())
    .fetch_optional(pool)
    .await?
    .is_some();
    let applied: HashMap<i64, Vec<u8>> = if table_exists {
        sqlx::query_as::<_, (i64, Vec<u8>)>(AssertSqlSafe(format!(
            "SELECT version, checksum FROM \"{}\"",
            migrator.table_name
        )))
        .fetch_all(pool)
        .await?
        .into_iter()
        .collect()
    } else {
        HashMap::new()
    };
    let migrations = migrator
        .migrations
        .iter()
        .map(|migration| {
            let mut migration = migration.clone();
            let lf = migration.sql.as_str().replace("\r\n", "\n");
            let crlf = lf.replace('\n', "\r\n");
            let crlf_checksum = sql_checksum(&migration, crlf);
            match applied.get(&migration.version) {
                Some(recorded)
                    if *recorded == crlf_checksum || *recorded == sql_checksum(&migration, lf) =>
                {
                    migration.checksum = Cow::Owned(recorded.clone());
                }
                None if cfg!(windows) => migration.checksum = Cow::Owned(crlf_checksum),
                _ => {}
            }
            migration
        })
        .collect::<Vec<_>>();
    Ok(Migrator {
        migrations: Cow::Owned(migrations),
        ignore_missing: migrator.ignore_missing,
        locking: migrator.locking,
        no_tx: migrator.no_tx,
        table_name: migrator.table_name.clone(),
        create_schemas: migrator.create_schemas.clone(),
    })
}

fn sql_checksum(migration: &Migration, sql: String) -> Vec<u8> {
    Migration::new(
        migration.version,
        migration.description.clone(),
        migration.migration_type,
        AssertSqlSafe(sql).into_sql_str(),
        migration.no_tx,
    )
    .checksum
    .into_owned()
}

pub(crate) async fn repair_legacy_recency_migration_version(
    pool: &SqlitePool,
    migrator: &Migrator,
) -> anyhow::Result<()> {
    let Some(recency_migration) = migrator
        .migrations
        .iter()
        .find(|migration| migration.version == 39)
    else {
        return Ok(());
    };
    let migrations_table_exists = sqlx::query_scalar::<_, i64>(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'",
    )
    .fetch_optional(pool)
    .await?
    .is_some();
    if !migrations_table_exists {
        return Ok(());
    }

    let legacy_recency_needs_repair = sqlx::query_scalar::<_, i64>(
        r#"
SELECT 1
FROM _sqlx_migrations
WHERE version = ?
  AND checksum = ?
  AND NOT EXISTS (
      SELECT 1 FROM _sqlx_migrations WHERE version = ?
  )
        "#,
    )
    .bind(38_i64)
    .bind(recency_migration.checksum.as_ref())
    .bind(recency_migration.version)
    .fetch_optional(pool)
    .await?
    .is_some();
    if !legacy_recency_needs_repair {
        return Ok(());
    }

    sqlx::query(
        r#"
UPDATE _sqlx_migrations
SET version = ?, description = ?
WHERE version = ?
  AND checksum = ?
  AND NOT EXISTS (
      SELECT 1 FROM _sqlx_migrations WHERE version = ?
  )
        "#,
    )
    .bind(recency_migration.version)
    .bind(recency_migration.description.as_ref())
    .bind(38_i64)
    .bind(recency_migration.checksum.as_ref())
    .bind(recency_migration.version)
    .execute_with_busy_retry(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
#[path = "migrations_tests.rs"]
mod tests;
