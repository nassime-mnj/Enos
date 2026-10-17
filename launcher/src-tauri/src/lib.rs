//! Dual Pulse Launcher — couche native (Tauri 2). L'interface (launcher/ui) fait les appels API ; ici : coffre d'identifiants Windows,
//! installation / mise à jour (via `dp-engine`), lancement des applications. Aucune confiance accordée au serveur : le manifeste est re-vérifié ici.
use dp_engine::manifest::MODE_FILES;
use dp_engine::updater::{self, ApplyOutcome, Plan};
use dp_engine::{apply, install, launch, manifest, signals, staging, store, Error as EngineError};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

/// Clé publique des manifestes (la même que l'OTA d'E.N.O.S., `ota_pubkey.txt`) : livrée AVEC le Launcher.
const MANIFEST_PUBKEY: &str = include_str!("../manifest_pubkey.txt");
const KEYRING_SERVICE: &str = "studio.dualpulse.launcher";

#[derive(Default)]
struct Job {
    cancel: Arc<AtomicBool>,
    running: Mutex<bool>,
}

/// État de l'arrière-plan : réglage « mises à jour automatiques » (lu à la fermeture de la fenêtre), téléchargements de staging en cours, verrou d'application.
#[derive(Default)]
struct Bg {
    auto_update: AtomicBool,
    staging: Mutex<HashMap<String, Arc<AtomicBool>>>,
    apply_lock: Mutex<()>,
}

#[derive(Deserialize)]
struct StageReq {
    server: String,
    token: String,
    product: String,
    channel: String,
    manifest: Value,
    signature: String,
    /// facultatif : identifiant Inno Setup, pour retrouver le dossier d'une installation faite hors du Launcher
    #[serde(default)]
    app_id: String,
}

#[derive(Deserialize)]
struct InstallReq {
    server: String,
    token: String,
    product: String,
    channel: String,
    manifest: Value,
    signature: String,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

fn err_text(e: &EngineError) -> (String, bool) {
    match e {
        EngineError::Http(401) => ("Your session has expired. Reconnecting…".into(), true),
        other => (other.to_string(), false),
    }
}

/// Seuls les noms d'exécutables simples sont acceptés (pas de chemin).
fn simple_exe(name: &str) -> bool {
    !name.is_empty() && name.len() < 80 && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b' ')) && !name.starts_with('.')
}

// ------------------------------------------------------------------ commandes
#[tauri::command]
fn native_info(app: AppHandle) -> Value {
    json!({ "native": true, "version": app.package_info().version.to_string(), "platform": std::env::consts::OS })
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    match keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    match keyring::Entry::new(KEYRING_SERVICE, &key).map_err(|e| e.to_string())?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Version installée d'un produit : registre Windows (installation Inno Setup, même faite hors Launcher), sinon l'état local du Launcher.
#[tauri::command]
fn product_state(app: AppHandle, product: String, app_id: String) -> Result<Value, String> {
    if let Some(f) = launch::locate(&app_id) {
        return Ok(json!({ "installed": { "version": f.version, "dir": f.dir.to_string_lossy(), "source": "registry" } }));
    }
    let st = store::Store::new(&data_dir(&app)?).map_err(|e| e.to_string())?;
    Ok(match st.get(&product) {
        Some(i) => json!({ "installed": { "version": i.version, "dir": i.dir, "source": "launcher" } }),
        None => json!({ "installed": null }),
    })
}

#[tauri::command]
fn install_product(app: AppHandle, job: State<'_, Job>, req: InstallReq) -> Result<(), String> {
    {
        let mut running = job.running.lock().map_err(|_| "verrou".to_string())?;
        if *running {
            return Err("An installation is already in progress.".into());
        }
        *running = true;
    }
    job.cancel.store(false, Ordering::Relaxed);
    let cancel = job.cancel.clone();
    let base = data_dir(&app)?;
    let handle = app.clone();
    std::thread::spawn(move || {
        let product = req.product.clone();
        let emit = |phase: &str, done: u64, total: u64| {
            let _ = handle.emit("install-progress", json!({ "product": product, "phase": phase, "done": done, "total": total }));
        };
        let result = (|| -> Result<(manifest::Manifest, Option<launch::Found>), EngineError> {
            emit("verify", 0, 0);
            let m = manifest::open(&req.manifest, &req.signature, MANIFEST_PUBKEY)?;
            if m.product != req.product || m.channel != req.channel {
                return Err(EngineError::Manifest("the manifest does not match the request".into()));
            }
            let server = req.server.trim_end_matches('/').to_string();
            let mut link = |i: usize| -> Result<String, EngineError> {
                let url = format!("{server}/launcher/v1/download/{}/{}/{}/{i}", m.product, m.channel, m.version);
                match ureq::get(&url).set("Authorization", &format!("Bearer {}", req.token)).call() {
                    Ok(r) => r.into_json::<Value>().ok().and_then(|v| v["url"].as_str().map(String::from)).ok_or_else(|| EngineError::Net("invalid link response".into())),
                    Err(ureq::Error::Status(c, _)) => Err(EngineError::Http(c)),
                    Err(e) => Err(EngineError::Net(e.to_string())),
                }
            };
            let dl = base.join("downloads");
            let dir = install::fetch_files(&m, &dl, &mut link, &cancel, &mut |o| emit("download", o.done, o.total))?;
            emit("install", 0, 0);
            install::run_installer(&m, &dir, &install::SystemRunner)?;
            let found = launch::locate(&m.app_id);
            Ok((m, found))
        })();
        match result {
            Ok((m, found)) => {
                let (dir, version) = found.map(|f| (f.dir.to_string_lossy().into_owned(), f.version)).unwrap_or_else(|| (String::new(), m.version.clone()));
                if let Ok(st) = store::Store::new(&base) {
                    let _ = st.set(&m.product, store::Installed { version: m.version.clone(), channel: m.channel.clone(), dir: dir.clone(), run: m.run.clone(),
                        installed_at: signals::now(), files: BTreeMap::new(), mode: manifest::MODE_INSTALLER.into() });
                }
                let _ = handle.emit("install-done", json!({ "product": m.product, "version": version, "dir": dir }));
            }
            Err(e) => {
                let (message, token_expired) = err_text(&e);
                let cancelled = matches!(e, EngineError::Cancelled);
                let _ = handle.emit("install-error", json!({ "product": req.product, "message": message, "token_expired": token_expired, "cancelled": cancelled }));
            }
        }
        if let Some(j) = handle.try_state::<Job>() {
            if let Ok(mut r) = j.running.lock() {
                *r = false;
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn cancel_install(job: State<'_, Job>) {
    job.cancel.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn launch_product(app: AppHandle, product: String, app_id: String, run: String) -> Result<(), String> {
    let st = store::Store::new(&data_dir(&app)?).map_err(|e| e.to_string())?;
    // mise à jour prête et application arrêtée : on l'applique d'abord (silencieux). Un échec restaure l'ancienne version, qu'on lance quand même.
    if st.get(&product).map(|i| !i.dir.is_empty()).unwrap_or(false) && signals::valid_product(&product) {
        let bg = app.state::<Bg>();
        let _guard = bg.apply_lock.lock();
        match with_ctx(&app, &product, |c| updater::prepare_launch(c)) {
            Ok(Ok(ApplyOutcome::Applied { version, .. })) => {
                let _ = app.emit("update-applied", json!({ "product": product, "version": version, "relaunched": false }));
            }
            Ok(Err(e)) => {
                let _ = app.emit("update-apply-failed", json!({ "product": product, "message": format!("The update could not be applied (the previous version was kept): {e}") }));
            }
            _ => {}
        }
    }
    let saved = st.get(&product);
    let (dir, exe) = match (launch::locate(&app_id), &saved) {
        (Some(f), s) => (f.dir, s.as_ref().map(|x| x.run.clone()).filter(|r| !r.is_empty()).unwrap_or(run)),
        (None, Some(s)) if !s.dir.is_empty() => (PathBuf::from(&s.dir), if s.run.is_empty() { run } else { s.run.clone() }),
        _ => return Err("This product is not installed.".into()),
    };
    if !simple_exe(&exe) {
        return Err("Executable name rejected.".into());
    }
    launch::spawn(&dir, &exe).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------ mises à jour en arrière-plan (mode « files »)
fn staging_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("staging"))
}

/// Construit le contexte du moteur pour un produit et exécute `f`.
fn with_ctx<R>(app: &AppHandle, product: &str, f: impl FnOnce(&updater::Ctx) -> R) -> Result<R, String> {
    let st = store::Store::new(&data_dir(app)?).map_err(|e| e.to_string())?;
    let sig = signals::Signals::from_env();
    let root = staging_root(app)?;
    let opts = apply::Options::default();
    Ok(f(&updater::Ctx { signals: &sig, store: &st, staging_root: &root, product, now: signals::now(), opts: &opts }))
}

/// Produit installé avec un dossier connu : état du Launcher, sinon registre Windows (installation Inno Setup faite hors du Launcher), enregistrée au passage.
fn resolve_installed(st: &store::Store, product: &str, app_id: &str, channel: &str, run: &str) -> Option<store::Installed> {
    if let Some(i) = st.get(product).filter(|i| !i.dir.is_empty()) {
        return Some(i);
    }
    let f = launch::locate(app_id)?;
    let i = store::Installed { version: f.version, channel: channel.to_string(), dir: f.dir.to_string_lossy().into_owned(), run: run.to_string(), installed_at: signals::now(), files: BTreeMap::new(), mode: manifest::MODE_INSTALLER.into() };
    st.set(product, i.clone()).ok()?;
    Some(i)
}

fn settings_json(s: &store::Settings) -> Value {
    json!({ "auto_update": s.auto_update, "check_interval_min": s.check_interval_min })
}

#[tauri::command]
fn settings_get(app: AppHandle) -> Result<Value, String> {
    let st = store::Store::new(&data_dir(&app)?).map_err(|e| e.to_string())?;
    Ok(settings_json(&st.settings()))
}

/// JS : `invoke('settings_set', { auto_update: true })` (noms en snake_case ; `check_interval_min` facultatif, borné 5–1440).
#[tauri::command(rename_all = "snake_case")]
fn settings_set(app: AppHandle, bg: State<'_, Bg>, auto_update: Option<bool>, check_interval_min: Option<u32>) -> Result<Value, String> {
    let st = store::Store::new(&data_dir(&app)?).map_err(|e| e.to_string())?;
    let mut s = st.settings();
    if let Some(a) = auto_update {
        s.auto_update = a;
    }
    if let Some(i) = check_interval_min {
        s.check_interval_min = i;
    }
    let s = st.set_settings(s).map_err(|e| e.to_string())?;
    bg.auto_update.store(s.auto_update, Ordering::Relaxed);
    ensure_tray(&app, s.auto_update);
    Ok(settings_json(&s))
}

fn ready_json(s: &staging::Staged) -> Value {
    json!({ "product": s.manifest.product, "channel": s.manifest.channel, "version": s.manifest.version, "notes": s.manifest.notes, "size": s.size, "staged_at": s.staged_at, "changed": s.changed.len(), "removed": s.removed.len() })
}

/// Télécharge en silence, dans le dossier de staging, les seuls fichiers modifiés (même si l'application tourne), puis écrit `update-ready.json`.
#[tauri::command]
fn stage_update(app: AppHandle, bg: State<'_, Bg>, req: StageReq) -> Result<(), String> {
    let m = manifest::open(&req.manifest, &req.signature, MANIFEST_PUBKEY).map_err(|e| e.to_string())?;
    if m.product != req.product || m.channel != req.channel {
        return Err("The manifest does not match the request.".into());
    }
    if m.mode != MODE_FILES {
        return Err("This manifest is not a files update.".into());
    }
    if !signals::valid_product(&m.product) {
        return Err("Invalid product name.".into());
    }
    let base = data_dir(&app)?;
    let st = store::Store::new(&base).map_err(|e| e.to_string())?;
    let inst = resolve_installed(&st, &req.product, &req.app_id, &req.channel, &m.run).ok_or_else(|| "This product is not installed (installation folder unknown).".to_string())?;
    let root = base.join("staging");
    let sig = signals::Signals::from_env();
    let already = staging::staged(&root, &m.product);
    match updater::plan(Some(&inst), &m, already.as_ref()) {
        Plan::Nothing => return Err("No update to prepare: the installed version is up to date.".into()),
        Plan::AlreadyStaged => {
            let s = already.expect("staged");
            updater::announce(&sig, &s).map_err(|e| e.to_string())?;
            let _ = app.emit("stage-ready", json!({ "product": m.product, "version": s.manifest.version, "notes": s.manifest.notes }));
            return Ok(());
        }
        Plan::Stage => {}
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = bg.staging.lock().map_err(|_| "verrou".to_string())?;
        if running.contains_key(&m.product) {
            return Err("An update download is already in progress.".into());
        }
        running.insert(m.product.clone(), cancel.clone());
    }
    sig.clear_ready(&m.product); // l'ancienne annonce ne correspond plus à ce qui sera en staging
    let handle = app.clone();
    std::thread::spawn(move || {
        let product = m.product.clone();
        let emit = |phase: &str, done: u64, total: u64| {
            let _ = handle.emit("stage-progress", json!({ "product": product, "phase": phase, "done": done, "total": total }));
        };
        emit("verify", 0, 0);
        let result = (|| -> Result<staging::Staged, EngineError> {
            let server = req.server.trim_end_matches('/').to_string();
            let mut link = |i: usize| -> Result<String, EngineError> {
                let url = format!("{server}/launcher/v1/download/{}/{}/{}/{i}", m.product, m.channel, m.version);
                match ureq::get(&url).set("Authorization", &format!("Bearer {}", req.token)).call() {
                    Ok(r) => r.into_json::<Value>().ok().and_then(|v| v["url"].as_str().map(String::from)).ok_or_else(|| EngineError::Net("invalid link response".into())),
                    Err(ureq::Error::Status(c, _)) => Err(EngineError::Http(c)),
                    Err(e) => Err(EngineError::Net(e.to_string())),
                }
            };
            let current = updater::current_files(&inst);
            let (mut last, mut last_pct) = (Instant::now(), u64::MAX);
            let s = staging::stage(&m, &current, &root, &mut link, &cancel, &mut |o| {
                let pct = if o.total == 0 { 100 } else { o.done * 100 / o.total };
                if pct != last_pct && (last.elapsed() > Duration::from_millis(150) || pct == 100) {
                    last = Instant::now();
                    last_pct = pct;
                    emit("download", o.done, o.total);
                }
            })?;
            updater::announce(&signals::Signals::from_env(), &s)?;
            Ok(s)
        })();
        match result {
            Ok(s) => {
                let _ = handle.emit("stage-ready", json!({ "product": product, "version": s.manifest.version, "notes": s.manifest.notes }));
            }
            Err(e) => {
                let (message, token_expired) = err_text(&e);
                let cancelled = matches!(e, EngineError::Cancelled);
                let _ = handle.emit("stage-error", json!({ "product": product, "message": message, "token_expired": token_expired, "cancelled": cancelled }));
            }
        }
        if let Some(b) = handle.try_state::<Bg>() {
            if let Ok(mut r) = b.staging.lock() {
                r.remove(&product);
            }
        }
    });
    Ok(())
}

/// Mise à jour prête pour ce produit (ou null).
#[tauri::command]
fn staged_info(app: AppHandle, product: String) -> Result<Value, String> {
    Ok(staging::staged(&staging_root(&app)?, &product).map(|s| ready_json(&s)).unwrap_or(Value::Null))
}

/// Abandonne la mise à jour : arrête un téléchargement en cours, supprime le staging et `update-ready.json`.
#[tauri::command]
fn discard_staged(app: AppHandle, bg: State<'_, Bg>, product: String) -> Result<(), String> {
    if !signals::valid_product(&product) {
        return Err("Invalid product name.".into());
    }
    if let Some(c) = bg.staging.lock().map_err(|_| "verrou".to_string())?.get(&product) {
        c.store(true, Ordering::Relaxed);
    }
    let _guard = bg.apply_lock.lock();
    staging::discard(&staging_root(&app)?, &product);
    signals::Signals::from_env().clear_ready(&product);
    Ok(())
}

/// Applique tout de suite la mise à jour prête, si (et seulement si) l'application est arrêtée. Ne ferme jamais l'application.
#[tauri::command]
async fn apply_update(app: AppHandle, product: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !signals::valid_product(&product) {
            return Err("Invalid product name.".to_string());
        }
        let bg = app.state::<Bg>();
        let _guard = bg.apply_lock.lock().map_err(|_| "verrou".to_string())?;
        match with_ctx(&app, &product, |c| updater::prepare_launch(c))? {
            Ok(ApplyOutcome::Applied { version, .. }) => {
                let _ = app.emit("update-applied", json!({ "product": product, "version": version, "relaunched": false }));
                Ok(json!({ "version": version }))
            }
            Ok(ApplyOutcome::Waiting) => Err("The application is running. Close it (or use \"Restart to apply\" inside the application): the Launcher never closes it by force.".into()),
            Ok(ApplyOutcome::Nothing) => Err("No update is ready for this product.".into()),
            Err(e) => Err(format!("The update could not be applied (the previous version was kept): {e}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Surveillance : toutes les 2 s, honore les demandes « Redémarrer pour appliquer » (`update-apply.json`) dès que l'application est fermée, puis la relance.
fn watcher_tick(app: &AppHandle) {
    let Ok(base) = data_dir(app) else { return };
    let Ok(st) = store::Store::new(&base) else { return };
    let sig = signals::Signals::from_env();
    for (product, inst) in st.all() {
        if inst.dir.is_empty() || !signals::valid_product(&product) || sig.read_apply_raw(&product).is_none() {
            continue;
        }
        let Some(bg) = app.try_state::<Bg>() else { return };
        let _guard = bg.apply_lock.lock();
        match with_ctx(app, &product, |c| updater::tick_apply(c)) {
            Ok(Ok(ApplyOutcome::Applied { relaunch, version })) => {
                let mut relaunched = false;
                if relaunch {
                    if let Some(i) = st.get(&product).filter(|i| simple_exe(&i.run)) {
                        relaunched = launch::spawn(Path::new(&i.dir), &i.run).is_ok();
                    }
                }
                let _ = app.emit("update-applied", json!({ "product": product, "version": version, "relaunched": relaunched }));
            }
            Ok(Ok(_)) => {}
            Ok(Err(e)) => {
                let _ = app.emit("update-apply-failed", json!({ "product": product, "message": format!("The update could not be applied (the previous version was restored): {e}") }));
            }
            Err(_) => {}
        }
    }
}

fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        // plantage pendant une application précédente : on restaure l'ancienne version avant tout
        if let Some(st) = data_dir(&app).ok().and_then(|b| store::Store::new(&b).ok()) {
            for (product, inst) in st.all() {
                if inst.dir.is_empty() {
                    continue;
                }
                match apply::recover(Path::new(&inst.dir)) {
                    Ok(true) => {
                        let _ = app.emit("update-apply-failed", json!({ "product": product, "message": "A previous update was interrupted: the previous version was restored." }));
                    }
                    Ok(false) => {}
                    Err(e) => {
                        let _ = app.emit("update-apply-failed", json!({ "product": product, "message": format!("Could not restore after an interrupted update: {e}") }));
                    }
                }
            }
        }
        loop {
            std::thread::sleep(Duration::from_secs(2));
            watcher_tick(&app);
        }
    });
}

// ------------------------------------------------------------------ zone de notification
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Icône de la zone de notification : présente seulement quand les mises à jour automatiques sont activées (le Launcher reste alors actif fenêtre fermée).
fn ensure_tray(app: &AppHandle, enabled: bool) {
    const ID: &str = "dp-tray";
    if !enabled {
        let _ = app.remove_tray_by_id(ID);
        return;
    }
    if app.tray_by_id(ID).is_some() {
        return;
    }
    let build = || -> tauri::Result<()> {
        let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;
        let mut b = TrayIconBuilder::with_id(ID)
            .tooltip("Dual Pulse Launcher")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, ev| match ev.id.as_ref() {
                "open" => show_main(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, ev| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            b = b.icon(icon.clone());
        }
        b.build(app)?;
        Ok(())
    };
    if build().is_err() {
        // pas de zone de notification disponible : la fenêtre se fermera normalement (voir on_window_event)
        if let Some(bg) = app.try_state::<Bg>() {
            bg.auto_update.store(false, Ordering::Relaxed);
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Job::default())
        .manage(Bg::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let auto = data_dir(&handle).ok().and_then(|b| store::Store::new(&b).ok()).map(|st| st.settings().auto_update).unwrap_or(false);
            handle.state::<Bg>().auto_update.store(auto, Ordering::Relaxed);
            ensure_tray(&handle, auto);
            start_watcher(handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            // mises à jour automatiques activées : fermer la fenêtre la cache (le Launcher continue de surveiller) ; sinon fermer = quitter
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && window.app_handle().state::<Bg>().auto_update.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            native_info, secret_get, secret_set, secret_delete, product_state, install_product, cancel_install, launch_product,
            settings_get, settings_set, stage_update, staged_info, discard_staged, apply_update
        ])
        .run(tauri::generate_context!())
        .expect("error while starting the Launcher");
}
