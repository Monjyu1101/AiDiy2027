// Compile the actual release-only TUI entry points without the full workspace.
#![allow(dead_code, unused_imports)]
mod legacy_core {
    pub mod config {
        pub struct Config {
            pub check_for_update_on_startup: bool,
            pub codex_home: std::path::PathBuf,
        }
    }
}
mod updates_cache {
    pub fn dismiss_version() {}
}
#[path = "../../command_codex/codex-rs/tui/src/updates.rs"]
mod updates;

#[test]
fn startup_setting_cannot_enable_upstream_checks() {
    // No Tokio runtime or HTTP client is provided: any background refresh must
    // fail this test rather than silently connecting to upstream.
    for enabled in [false, true] {
        let config = legacy_core::config::Config {
            check_for_update_on_startup: enabled,
            codex_home: std::path::PathBuf::from("nonexistent-codex-test-home"),
        };
        assert_eq!(updates::get_upgrade_version(&config), None);
        assert_eq!(updates::get_upgrade_version_for_popup(&config), None);
    }
}

#[test]
fn cached_upstream_release_is_ignored_and_unchanged() {
    let dir = std::env::temp_dir().join(format!("aidiy-updates-test-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let cache = dir.join("version.json");
    let data = r#"{"latest_version":"99.99.99","last_checked_at":"2000-01-01T00:00:00Z"}"#;
    std::fs::write(&cache, data).unwrap();
    let config = legacy_core::config::Config {
        check_for_update_on_startup: true,
        codex_home: dir.clone(),
    };
    assert_eq!(updates::get_upgrade_version(&config), None);
    assert_eq!(updates::get_upgrade_version_for_popup(&config), None);
    assert_eq!(std::fs::read_to_string(&cache).unwrap(), data);
    std::fs::remove_file(cache).unwrap();
    std::fs::remove_dir(dir).unwrap();
}
