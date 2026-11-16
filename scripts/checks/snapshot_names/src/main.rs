use std::path::Path;
fn main() {
    let root_arg = std::env::args().nth(1).expect("repository root");
    let root = Path::new(&root_arg);
    let entries: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("scripts/checks/codex_snapshot_renames.json")).unwrap(),
    )
    .unwrap();
    let mut count = 0;
    for entry in entries.as_array().unwrap() {
        let path = root.join(entry["new"].as_str().unwrap());
        let snapshot = insta::Snapshot::from_file(&path).unwrap();
        let value = match snapshot.contents() {
            insta::internals::SnapshotContents::Text(value) => value.to_string(),
            _ => panic!("non-text snapshot: {}", path.display()),
        };
        let stem = path.file_stem().unwrap().to_str().unwrap();
        let (name, suffix) = stem
            .split_once('@')
            .map(|(a, b)| (a, Some(b)))
            .unwrap_or((stem, None));
        let mut settings = insta::Settings::clone_current();
        settings.set_snapshot_path(path.parent().unwrap());
        settings.set_prepend_module_to_snapshot(false);
        if let Some(suffix) = suffix {
            settings.set_snapshot_suffix(suffix);
        }
        settings.bind(|| insta::assert_snapshot!(name, value));
        count += 1;
    }
    println!("Verified {count} snapshot lookups with insta 1.46.3 (including OS suffixes)");
}

#[cfg(test)]
mod tests {
    fn settings() -> insta::Settings {
        let mut settings = insta::Settings::clone_current();
        settings.set_snapshot_path(concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures"));
        settings
    }

    #[test]
    fn automatic_short_name() {
        settings().bind(|| {
            insta::with_settings!({prepend_module_to_snapshot => false}, {
                insta::assert_snapshot!("first assertion");
            });
            insta::with_settings!({prepend_module_to_snapshot => false}, {
                insta::assert_snapshot!("second assertion");
            });
        });
    }

    #[test]
    fn inherited_suffix_and_path() {
        for platform in ["windows", "unix"] {
            let mut settings = settings();
            settings.set_snapshot_suffix(platform);
            settings.bind(|| {
                insta::with_settings!({prepend_module_to_snapshot => false}, {
                    insta::assert_snapshot!("platform_name", platform);
                });
            });
        }
    }
    #[test]
    fn fallible_value() -> Result<(), std::string::FromUtf8Error> {
        let snapshot_value = String::from_utf8(b"fallible".to_vec())?;
        settings().bind(|| {
            insta::with_settings!({prepend_module_to_snapshot => false}, {
                insta::assert_snapshot!("fallible_value", snapshot_value);
            });
        });
        Ok(())
    }

    #[test]
    fn awaited_value() {
        use std::future::Future;
        let future = async {
            let snapshot_value = std::future::ready("awaited").await;
            settings().bind(|| {
                insta::with_settings!({prepend_module_to_snapshot => false}, {
                    insta::assert_snapshot!("awaited_value", snapshot_value);
                });
            });
        };
        let mut future = std::pin::pin!(future);
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        assert!(future.as_mut().poll(&mut context).is_ready());
    }

    #[test]
    fn settings_restore_after_assertion() {
        let before = insta::Settings::clone_current().prepend_module_to_snapshot();
        insta::with_settings!({prepend_module_to_snapshot => false}, {
            assert!(!insta::Settings::clone_current().prepend_module_to_snapshot());
        });
        assert_eq!(
            insta::Settings::clone_current().prepend_module_to_snapshot(),
            before
        );
    }
}
