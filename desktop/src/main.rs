//! 番茄超市 - the desktop shell.
//!
//! This binary is deliberately thin. It owns exactly three things that cannot
//! live inside the shared core:
//!
//!   1. a runtime directory, so the single executable has somewhere to keep the
//!      device pool, the decrypted-image cache and the log file;
//!   2. a window, which points straight at the loopback origin;
//!   3. the embedded asset table, so a fresh machine needs nothing beside the
//!      executable.
//!
//! Everything else - every endpoint, the Web bridge, the static file rules and
//! the session capability - is `fqapi_core`, the same crate the Android edition
//! links through flutter_rust_bridge. Pointing the window at the loopback
//! origin rather than shipping a second copy of the UI through Tauri's asset
//! protocol keeps the browser context same-origin with the API, which is why no
//! CORS exception and no token ever reaches the page.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

include!(concat!(env!("OUT_DIR"), "/embedded_assets.rs"));

/// Mirrors the `port` the Android edition ships in `config.json`.
const DEFAULT_PORT: u16 = 8080;
/// How many consecutive ports to try before giving up on a stable origin.
const FALLBACK_PORTS: u16 = 8;

fn main() {
    tauri::Builder::default()
        // A second launch raises the existing window instead of starting a
        // second loopback listener and a second device pool on the same files.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let runtime = runtime_root()?;
            materialize(&runtime)?;
            fqapi_core::core_log::install(&runtime);
            log::info!("fqpc runtime dir: {}", runtime.display());

            let runtime_rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_name("fqapi")
                .build()?;
            let entry = runtime_rt.block_on(boot_core(&runtime))?;
            log::info!("fqpc core ready: {entry}");

            // Kept alive for the process lifetime: the core's tokio tasks run on
            // this runtime, and the graceful teardown at exit borrows it.
            app.manage(runtime_rt);

            tauri::WebviewWindowBuilder::new(
                app.handle(),
                "main",
                tauri::WebviewUrl::External(
                    entry
                        .parse()
                        .map_err(|e| format!("bad loopback url {entry}: {e}"))?,
                ),
            )
            .title("番茄超市")
            .inner_size(1280.0, 840.0)
            .min_inner_size(1024.0, 680.0)
            .center()
            .resizable(true)
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build fqpc")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                // Retire the pool before the process goes away: the core's
                // ownership hand-off waits for an in-flight commit, so a hard
                // exit here could truncate the pool file it is rewriting.
                if let Some(rt) = app_handle.try_state::<tokio::runtime::Runtime>() {
                    let _ = rt.block_on(fqapi_core::api::shutdown());
                }
            }
        });
}

/// Starts the shared core and returns the URL that opens the Web UI.
///
/// The loopback entry URL carries the per-launch capability; the adapter turns
/// it into an HttpOnly session cookie and redirects to `/`, so the capability
/// itself never has to be embedded in any page.
async fn boot_core(runtime: &Path) -> Result<String, String> {
    let config = path_arg(runtime, "config/config.json")?;
    let pool = path_arg(runtime, "config/device_pool.json")?;
    let filter = path_arg(runtime, "config/filter.json")?;
    let root = runtime.to_string_lossy().into_owned();

    fqapi_core::api::init(
        config.clone(),
        pool,
        filter,
        root,
        bind_port(&config),
        String::new(),
    )
    .await?;

    let base = fqapi_core::api::base_url().await;
    let capability = fqapi_core::api::session_capability().await;
    if base.is_empty() || capability.is_empty() {
        return Err("core did not report a loopback session".to_string());
    }
    Ok(format!("{base}/_session/{capability}"))
}

/// Picks the loopback port to listen on.
///
/// The window loads the UI from this origin, which makes the origin part of
/// the app's identity: a different port is a different origin, so the browser
/// hands out a fresh, empty localStorage and every reading position, shelf entry
/// and preference from the last session disappears. The configured port is
/// therefore tried first, then a short run of neighbours, and only if all of
/// them are taken does the OS get to choose - which costs persistence but must
/// never cost a launch.
fn bind_port(config_path: &str) -> u16 {
    let configured = std::fs::read_to_string(config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|cfg| cfg.get("port").and_then(|p| p.as_u64()))
        .and_then(|p| u16::try_from(p).ok())
        .filter(|p| *p != 0)
        .unwrap_or(DEFAULT_PORT);

    for offset in 0..FALLBACK_PORTS {
        let candidate = configured.saturating_add(offset);
        if is_free(candidate) {
            return candidate;
        }
    }
    log::warn!(
        "ports {}-{} are busy; falling back to an ephemeral port. Session state \
         (reading progress, shelf, preferences) will not carry over.",
        configured,
        configured + FALLBACK_PORTS - 1
    );
    0
}

fn is_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn path_arg(runtime: &Path, rel: &str) -> Result<String, String> {
    Ok(runtime.join(rel).to_string_lossy().into_owned())
}

/// Where the app keeps everything it writes.
///
/// Defaults to `%LOCALAPPDATA%\fqapp-pc` so the executable itself stays a single
/// portable file that can sit anywhere, including a read-only share. Set
/// `FQPC_HOME` to relocate it - that is what makes a USB-stick deployment work,
/// and it also makes "uninstall" a folder delete.
fn runtime_root() -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("FQPC_HOME") {
        let dir = dir.to_string_lossy().into_owned();
        if !dir.trim().is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|base| base.join("fqapp-pc"))
        .ok_or_else(|| "LOCALAPPDATA is not set and FQPC_HOME is not provided".to_string())
}

/// Writes the embedded assets into `root` and returns how many changed.
///
/// The core serves the Web UI off disk, so the files have to exist there. The
/// split matters: app-owned files (the UI and the filters) are refreshed when
/// their bytes differ, which makes an upgrade take effect and keeps a corrupted
/// copy from surviving; user-editable seeds are only created when missing, so
/// editing `config.json` is not silently undone on the next launch.
fn materialize(root: &Path) -> Result<usize, String> {
    let mut changed = 0usize;
    for (rel, bytes) in EMBEDDED_ASSETS {
        let dest = root.join(rel);
        let owned = OWNED_ASSETS.contains(rel);
        if dest.exists() {
            if !owned {
                continue;
            }
            if fs::read(&dest).map(|old| old == *bytes).unwrap_or(false) {
                continue;
            }
        }
        let parent = dest
            .parent()
            .ok_or_else(|| format!("no parent for {rel}"))?;
        fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {e}", parent.display()))?;
        // Write beside the target and rename, so an interrupted launch cannot
        // leave a half-written HTML file behind.
        let tmp = dest.with_extension("fqpc-tmp");
        fs::write(&tmp, bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &dest).map_err(|e| format!("rename {}: {e}", dest.display()))?;
        changed += 1;
    }
    Ok(changed)
}
