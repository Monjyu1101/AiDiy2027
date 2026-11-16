// AiDiy: Keep snapshot filenames short; scoped settings preserve suffixes and paths.
#![cfg(test)]

use super::*;
use crate::history_cell::HistoryCell;

#[test]
fn nfs_migration_warning() {
    let cell = StartupWarningsCell::new(vec![NFS_MIGRATION_WARNING.to_string()]);
    let lines = cell.transcript_lines(/*width*/ 80);
    let text = lines
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join("\n");
    insta::with_settings!({prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(text);
    });
}
