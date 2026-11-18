#![cfg(not(debug_assertions))]

use crate::legacy_core::config::Config;

pub(crate) use crate::updates_cache::dismiss_version;

/// AiDiy: upstream releases are not updates for this locally compiled fork.
/// Do not query release services, spawn a refresh task, or read/write the shared
/// ~/.codex/version.json cache, even when startup checks are enabled in config.
pub fn get_upgrade_version(_config: &Config) -> Option<String> {
    None
}

/// AiDiy: a cached upstream release must not reopen the update popup either.
pub fn get_upgrade_version_for_popup(_config: &Config) -> Option<String> {
    None
}
