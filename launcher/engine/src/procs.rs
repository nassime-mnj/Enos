//! Processus : l'application est-elle en cours d'exécution ? (jamais de fermeture forcée : on ne fait qu'observer.)
use crate::signals::Signals;
use std::path::Path;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

fn kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet)
}

fn snapshot(pids: Option<&[Pid]>) -> System {
    let mut sys = System::new();
    match pids {
        Some(p) => sys.refresh_processes_specifics(ProcessesToUpdate::Some(p), true, kind()),
        None => sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind()),
    };
    sys
}

/// Le nom d'un processus peut être tronqué (15 caractères sous Linux) : on accepte l'égalité, ou un préfixe d'un nom tronqué.
fn name_matches(candidate: &str, wanted: &str) -> bool {
    let (c, w) = (candidate.to_ascii_lowercase(), wanted.to_ascii_lowercase());
    !c.is_empty() && (c == w || (c.len() >= 15 && w.starts_with(&c)))
}

fn process_matches(p: &sysinfo::Process, exe_name: &str) -> bool {
    name_matches(&p.name().to_string_lossy(), exe_name) || p.exe().and_then(|e| e.file_name()).map(|n| name_matches(&n.to_string_lossy(), exe_name)).unwrap_or(false)
}

pub fn is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let pid = Pid::from_u32(pid);
    snapshot(Some(&[pid])).process(pid).is_some()
}

/// Le processus `pid` existe ET porte ce nom d'exécutable (un PID réutilisé par un autre programme ne compte pas).
pub fn matches_name(pid: u32, exe_name: &str) -> bool {
    if pid == 0 || exe_name.is_empty() {
        return false;
    }
    let p = Pid::from_u32(pid);
    let sys = snapshot(Some(&[p]));
    sys.process(p).map(|pr| process_matches(pr, exe_name)).unwrap_or(false)
}

fn under(dir: &Path, exe: &Path) -> bool {
    match (dir.canonicalize(), exe.canonicalize()) {
        (Ok(d), Ok(e)) => e.starts_with(d),
        _ => exe.starts_with(dir),
    }
}

/// L'application tourne-t-elle ? Oui si `running.json` est valide (PID vivant, de ce nom, lancé depuis `install_dir`),
/// ou, à défaut de signal (ancienne version de l'application), si un processus `run` s'exécute depuis `install_dir`.
pub fn app_running(sig: &Signals, product: &str, install_dir: &Path, run: &str) -> bool {
    if let Some(r) = sig.read_running(product) {
        let pid = Pid::from_u32(r.pid);
        let sys = snapshot(Some(&[pid]));
        if let Some(p) = sys.process(pid) {
            if process_matches(p, &r.exe) && p.exe().map(|e| under(install_dir, e)).unwrap_or(true) {
                return true;
            }
        }
    }
    if run.is_empty() {
        return false;
    }
    let name = Path::new(run).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let sys = snapshot(None);
    sys.processes().values().any(|p| process_matches(p, &name) && p.exe().map(|e| under(install_dir, e)).unwrap_or(false))
}

/// Attend la fin du processus ; retourne vrai s'il s'est arrêté avant le délai. Ne le tue jamais.
pub fn wait_exit(pid: u32, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if !is_alive(pid) {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}
