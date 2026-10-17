//! Tests des mises à jour en arrière-plan : manifeste « files », staging différentiel, fichiers-signal, application avec retour arrière, flux du Launcher.
use dp_engine::apply::{self, Options};
use dp_engine::manifest::{self, Manifest};
use dp_engine::signals::{self, Apply, Ready, Running, Signals};
use dp_engine::staging::{self, Staged};
use dp_engine::store::{Installed, Settings, Store};
use dp_engine::updater::{self, ApplyOutcome, Ctx, Plan};
use dp_engine::{download, procs, Error};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Response, Server, StatusCode};

const NOW: u64 = 1_700_000_000;

fn sha(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

// ---------------------------------------------------------------- faux serveur : GET /<version>/<chemin>, compte les requêtes
#[derive(Clone)]
struct Srv {
    base: String,
    bodies: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    hits: Arc<Mutex<HashMap<String, usize>>>,
    ranges: Arc<Mutex<Vec<String>>>,
    cut: Arc<Mutex<HashMap<String, usize>>>, // coupe UNE réponse après n octets
}

impl Srv {
    fn new() -> Srv {
        let server = Server::http("127.0.0.1:0").unwrap();
        let s = Srv {
            base: format!("http://127.0.0.1:{}", server.server_addr().to_ip().unwrap().port()),
            bodies: Default::default(),
            hits: Default::default(),
            ranges: Default::default(),
            cut: Default::default(),
        };
        let t = s.clone();
        thread::spawn(move || {
            for rq in server.incoming_requests() {
                let key = rq.url().trim_start_matches('/').to_string();
                *t.hits.lock().unwrap().entry(key.clone()).or_default() += 1;
                let Some(body) = t.bodies.lock().unwrap().get(&key).cloned() else {
                    let _ = rq.respond(Response::empty(StatusCode(404)));
                    continue;
                };
                let range = rq.headers().iter().find(|x| x.field.equiv("Range")).map(|x| x.value.to_string());
                let start: usize = range.as_ref().map(|v| v.trim_start_matches("bytes=").trim_end_matches('-').parse().unwrap_or(0)).unwrap_or(0);
                if let Some(v) = &range {
                    t.ranges.lock().unwrap().push(format!("{key} {v}"));
                }
                if start >= body.len() && start > 0 {
                    let _ = rq.respond(Response::empty(StatusCode(416)));
                    continue;
                }
                let code = if start > 0 { 206 } else { 200 };
                let mut slice = body[start..].to_vec();
                let full = slice.len();
                if let Some(k) = t.cut.lock().unwrap().remove(&key) {
                    slice.truncate(k);
                }
                let _ = rq.respond(Response::new(StatusCode(code), vec![Header::from_bytes("Content-Length", full.to_string()).unwrap()], std::io::Cursor::new(slice), Some(full), None));
            }
        });
        s
    }
    fn add(&self, version: &str, path: &str, body: &[u8]) {
        self.bodies.lock().unwrap().insert(format!("{version}/{path}"), body.to_vec());
    }
    fn hits_for(&self, version: &str, path: &str) -> usize {
        *self.hits.lock().unwrap().get(&format!("{version}/{path}")).unwrap_or(&0)
    }
    fn total_hits(&self) -> usize {
        self.hits.lock().unwrap().values().sum()
    }
}

fn mk_json(version: &str, files: &[(&str, &[u8])]) -> Value {
    json!({"product":"enos","channel":"stable","version":version,"mode":"files","run":"ENOS.exe","notes":"Notes de test",
        "files": files.iter().map(|(p, b)| json!({"path":p,"sha256":sha(b),"size":b.len(),"key":format!("enos/stable/{version}/{p}")})).collect::<Vec<_>>()})
}

fn mk(version: &str, files: &[(&str, &[u8])]) -> Manifest {
    manifest::parse(&mk_json(version, files)).unwrap()
}

fn v1_files() -> Vec<(&'static str, &'static [u8])> {
    vec![("ENOS.exe", b"exe-v1"), ("lib/core.dll", b"core-v1"), ("a.txt", b"a-v1"), ("old.txt", b"old-v1")]
}
fn v2_files() -> Vec<(&'static str, &'static [u8])> {
    vec![("ENOS.exe", b"exe-v2"), ("lib/core.dll", b"core-v1"), ("a.txt", b"a-v2"), ("new/n.txt", b"n-v2")]
}

struct World {
    _t: tempfile::TempDir,
    install: PathBuf,
    root: PathBuf,
    sig: Signals,
    store_dir: PathBuf,
    srv: Srv,
    current: BTreeMap<String, String>,
}

impl World {
    /// Installation v1 sur disque (+ données utilisateur) ; v2 publiée sur le faux serveur.
    fn new() -> World {
        let t = tempfile::tempdir().unwrap();
        let (install, root, sigdir, store_dir) = (t.path().join("install"), t.path().join("staging"), t.path().join("signals"), t.path().join("launcher"));
        fs::create_dir_all(&install).unwrap();
        let mut current = BTreeMap::new();
        for (p, b) in v1_files() {
            write(&install, p, b);
            current.insert(p.to_string(), sha(b));
        }
        write(&install, "data/user.db", b"MES DONNEES");
        write(&install, "data/sub/notes.txt", b"notes");
        write(&install, "nasko_config.json", b"{\"cle\":1}");
        let srv = Srv::new();
        for (p, b) in v2_files() {
            srv.add("1.1.0", p, b);
        }
        World { sig: Signals::new(&sigdir), _t: t, install, root, store_dir, srv, current }
    }
    fn stage(&self, m: &Manifest) -> dp_engine::Result<Staged> {
        let base = self.srv.base.clone();
        staging::stage(m, &self.current, &self.root, &mut |i| Ok(format!("{base}/{}/{}", m.version, m.files[i].path)), &AtomicBool::new(false), &mut |_| {})
    }
    fn stage_v2(&self) -> Staged {
        self.stage(&mk("1.1.0", &v2_files())).unwrap()
    }
    fn apply(&self, opts: &Options) -> dp_engine::Result<apply::Applied> {
        apply::apply(&self.sig, &self.root, "enos", &self.install, opts)
    }
    fn store(&self) -> Store {
        let st = Store::new(&self.store_dir).unwrap();
        st.set("enos", self.installed()).unwrap();
        st
    }
    fn installed(&self) -> Installed {
        Installed { version: "1.0.0".into(), channel: "stable".into(), dir: self.install.to_string_lossy().into(), run: "ENOS.exe".into(), installed_at: 1, files: self.current.clone(), mode: "files".into() }
    }
    fn ctx<'a>(&'a self, st: &'a Store, now: u64, opts: &'a Options) -> Ctx<'a> {
        Ctx { signals: &self.sig, store: st, staging_root: &self.root, product: "enos", now, opts }
    }
}

fn write(dir: &Path, rel: &str, bytes: &[u8]) {
    let p = rel.split('/').fold(dir.to_path_buf(), |a, c| a.join(c));
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, bytes).unwrap();
}

/// Photographie complète d'un dossier : chemin -> (contenu ou cible du lien, droits).
fn snapshot(dir: &Path) -> BTreeMap<String, (String, u32)> {
    fn walk(base: &Path, cur: &Path, out: &mut BTreeMap<String, (String, u32)>) {
        for e in fs::read_dir(cur).unwrap().flatten() {
            let p = e.path();
            let rel = p.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
            let md = fs::symlink_metadata(&p).unwrap();
            #[cfg(unix)]
            let mode = std::os::unix::fs::PermissionsExt::mode(&md.permissions());
            #[cfg(not(unix))]
            let mode = 0;
            if md.file_type().is_symlink() {
                out.insert(rel, (format!("-> {}", fs::read_link(&p).unwrap().display()), mode));
            } else if md.is_dir() {
                out.insert(format!("{rel}/"), (String::new(), 0));
                walk(base, &p, out);
            } else {
                let b = fs::read(&p).unwrap();
                out.insert(rel, (if b.len() > 4096 { format!("sha:{}", sha(&b)) } else { String::from_utf8_lossy(&b).into_owned() }, mode));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn no_leftovers(install: &Path) {
    for k in snapshot(install).keys() {
        assert!(!k.contains(".update-"), "reste du mécanisme de mise à jour : {k}");
    }
}

fn read(dir: &Path, rel: &str) -> String {
    fs::read_to_string(rel.split('/').fold(dir.to_path_buf(), |a, c| a.join(c))).unwrap()
}

// ---------------------------------------------------------------- manifeste « files »
#[test]
fn manifest_mode_defaults_to_installer_and_files_mode_is_strict() {
    let fx: Value = serde_json::from_str(include_str!("fixtures/manifest_fixture.json")).unwrap();
    assert_eq!(manifest::parse(&fx["manifest"]).unwrap().mode, "installer");
    assert_eq!(mk("1.0.0", &v1_files()).mode, "files");
    let base = mk_json("1.0.0", &v1_files());
    let with = |f: &dyn Fn(&mut Value)| {
        let mut m = base.clone();
        f(&mut m);
        manifest::parse(&m)
    };
    assert!(with(&|m| m["mode"] = json!("autre")).is_err());
    assert!(with(&|m| m["run"] = json!("")).is_err(), "run obligatoire");
    assert!(with(&|m| m["run"] = json!("absent.exe")).is_err(), "run doit être un des fichiers");
    assert!(with(&|m| m["launch"] = json!("ENOS.exe")).is_err(), "launch doit rester vide");
    for bad in ["../x.txt", "/abs.txt", "data/x.bin", "Data/x.bin", "DATA/sub/y", "nasko_config.json", "NASKO_CONFIG.JSON", ".update-journal.json", "sub/.update-x", "a.update-new", "b.part", "a/../b"] {
        let r = with(&|m| {
            let f = m["files"].as_array_mut().unwrap();
            let mut e = f[0].clone();
            e["path"] = json!(bad);
            f.push(e);
        });
        assert!(matches!(r, Err(Error::Manifest(_))), "doit être refusé : {bad}");
    }
    assert!(manifest::is_protected("data") && manifest::is_protected("data/x") && !manifest::is_protected("database/x") && !manifest::is_protected("lib/data/x"));
    assert!(manifest::PROTECTED_DIRS.contains(&"data") && manifest::PROTECTED_FILES.contains(&"nasko_config.json"));
}

// ---------------------------------------------------------------- staging
#[test]
fn staging_downloads_only_changed_files() {
    let w = World::new();
    let m = mk("1.1.0", &v2_files());
    let mut cur = w.current.clone();
    cur.insert("data/user.db".into(), sha(b"x")); // une donnée protégée connue du store ne doit JAMAIS être candidate à la suppression
    let base = w.srv.base.clone();
    let mut last = (0, 0);
    let s = staging::stage(&m, &cur, &w.root, &mut |i| Ok(format!("{base}/1.1.0/{}", m.files[i].path)), &AtomicBool::new(false), &mut |o| last = (o.done, o.total)).unwrap();
    assert_eq!(s.changed, vec!["ENOS.exe", "a.txt", "new/n.txt"]);
    assert_eq!(s.removed, vec!["old.txt"]);
    assert_eq!(s.size, (6 + 4 + 4) as u64);
    assert_eq!(last, (14, 14));
    assert_eq!(w.srv.hits_for("1.1.0", "lib/core.dll"), 0, "fichier inchangé : aucune requête");
    assert_eq!(w.srv.total_hits(), 3);
    assert_eq!(read(&staging::files_dir(&w.root, &m), "new/n.txt"), "n-v2");
    assert!(!staging::files_dir(&w.root, &m).join("lib").exists());
    let again = staging::staged(&w.root, "enos").expect("prêt");
    assert_eq!(again, s);
    // même version déjà complète : rien à refaire
    let hits = w.srv.total_hits();
    assert_eq!(w.stage(&m).unwrap(), s);
    assert_eq!(w.srv.total_hits(), hits);
}

#[test]
fn staging_replaces_older_version_and_refuses_newer_or_wrong_mode() {
    let w = World::new();
    w.srv.add("1.0.5", "ENOS.exe", b"exe-v105");
    w.srv.add("1.2.0", "ENOS.exe", b"exe-v120");
    let m105 = mk("1.0.5", &[("ENOS.exe", b"exe-v105"), ("a.txt", b"a-v1"), ("lib/core.dll", b"core-v1"), ("old.txt", b"old-v1")]);
    w.stage(&m105).unwrap();
    assert!(staging::files_dir(&w.root, &m105).exists());
    w.stage_v2();
    assert!(!staging::files_dir(&w.root, &m105).exists(), "l'ancien staging est supprimé");
    assert_eq!(staging::staged(&w.root, "enos").unwrap().manifest.version, "1.1.0");
    // plus récent déjà prêt : refus d'installer une version plus ancienne par-dessus
    assert!(w.stage(&m105).is_err());
    assert_eq!(staging::staged(&w.root, "enos").unwrap().manifest.version, "1.1.0");
    // mode installer refusé
    let fx: Value = serde_json::from_str(include_str!("fixtures/manifest_fixture.json")).unwrap();
    let inst = manifest::parse(&fx["manifest"]).unwrap();
    assert!(matches!(staging::stage(&inst, &BTreeMap::new(), &w.root, &mut |_| Ok(String::new()), &AtomicBool::new(false), &mut |_| {}), Err(Error::Manifest(_))));
    staging::discard(&w.root, "enos");
    assert!(staging::staged(&w.root, "enos").is_none());
}

#[test]
fn staging_resumes_after_a_network_cut_and_never_reports_ready_early() {
    let w = World::new();
    let big: Vec<u8> = (0..400_000).map(|i| (i * 7 % 251) as u8).collect();
    let files: Vec<(&str, &[u8])> = vec![("ENOS.exe", &big), ("a.txt", b"a-v1")];
    let m = mk("1.1.0", &files);
    w.srv.add("1.1.0", "ENOS.exe", &big);
    w.srv.cut.lock().unwrap().insert("1.1.0/ENOS.exe".into(), 150_000);
    assert!(w.stage(&m).is_err(), "coupure signalée");
    assert!(staging::staged(&w.root, "enos").is_none(), "pas de ready.json tant que tout n'est pas vérifié");
    assert!(!staging::product_dir(&w.root, "enos").join("ready.json").exists());
    let part = download::part_path(&staging::files_dir(&w.root, &m).join("ENOS.exe"));
    let have = fs::metadata(&part).unwrap().len();
    assert!(have > 0 && have < big.len() as u64);
    let s = w.stage(&m).unwrap();
    assert_eq!(fs::read(staging::files_dir(&w.root, &m).join("ENOS.exe")).unwrap(), big);
    assert!(w.srv.ranges.lock().unwrap().last().unwrap().ends_with(&format!("bytes={have}-")), "reprise par Range");
    assert_eq!(s.changed, vec!["ENOS.exe"]);
}

#[test]
fn staging_cancel_keeps_partial_and_corrupt_file_is_refused() {
    let w = World::new();
    let m = mk("1.1.0", &v2_files());
    let r = staging::stage(&m, &w.current, &w.root, &mut |_| Ok(format!("{}/1.1.0/ENOS.exe", w.srv.base)), &AtomicBool::new(true), &mut |_| {});
    assert!(matches!(r, Err(Error::Cancelled)));
    assert!(staging::staged(&w.root, "enos").is_none());
    // le serveur sert un contenu qui ne correspond pas à l'empreinte
    let w2 = World::new();
    w2.srv.add("1.1.0", "a.txt", b"a-v9");
    let r = w2.stage(&m);
    assert!(matches!(r, Err(Error::Hash(_))), "{r:?}");
    assert!(staging::staged(&w2.root, "enos").is_none());
}

// ---------------------------------------------------------------- fichiers-signal
#[test]
fn ready_signal_roundtrip_corrupt_and_oversized() {
    let t = tempfile::tempdir().unwrap();
    let sig = Signals::new(t.path());
    assert!(sig.read_ready("enos").is_none());
    let r = Ready { product: "enos".into(), channel: "stable".into(), version: "1.1.0".into(), notes: "é".repeat(20_000), staged_at: NOW, size: 99 };
    sig.write_ready(&r).unwrap();
    let f = t.path().join("enos").join("update-ready.json");
    assert!(fs::metadata(&f).unwrap().len() <= 16 * 1024, "notes tronquées pour tenir dans 16 Ko");
    assert!(!t.path().join("enos").join("update-ready.json.tmp").exists());
    let got = sig.read_ready("enos").unwrap();
    assert_eq!((got.version.as_str(), got.size, got.staged_at), ("1.1.0", 99, NOW));
    let raw: Value = serde_json::from_slice(&fs::read(&f).unwrap()).unwrap();
    let mut keys: Vec<_> = raw.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["channel", "notes", "product", "size", "staged_at", "version"]);
    fs::write(&f, b"{pas du json").unwrap();
    assert!(sig.read_ready("enos").is_none(), "corrompu = absent");
    fs::write(&f, vec![b' '; 20_000]).unwrap();
    assert!(sig.read_ready("enos").is_none(), "trop gros = absent");
    fs::write(&f, serde_json::to_vec(&json!({"product":"enos","channel":"s","version":"1","staged_at":1,"size":1})).unwrap()).unwrap();
    assert!(sig.read_ready("enos").is_some(), "notes facultatives en lecture");
    sig.clear_ready("enos");
    assert!(sig.read_ready("enos").is_none());
    sig.clear_ready("enos"); // idempotent
}

#[test]
fn booby_trapped_product_names_never_touch_the_filesystem() {
    let t = tempfile::tempdir().unwrap();
    let sig = Signals::new(t.path().join("sig"));
    for bad in ["../evil", "..", "a/b", "a\\b", "", "ENOS", "-x", "x.y", "/etc"] {
        let r = Ready { product: bad.into(), channel: "s".into(), version: "1".into(), notes: String::new(), staged_at: 1, size: 1 };
        assert!(sig.write_ready(&r).is_err(), "{bad}");
        assert!(sig.write_apply(bad, &Apply { requested_at: 1, pid: 1 }).is_err());
        assert!(sig.write_applied(bad, "1", 1).is_err());
        assert!(sig.read_ready(bad).is_none() && sig.read_running(bad).is_none() && sig.read_apply(bad, NOW).is_none());
        assert!(signals::dir(bad).is_none() && sig.dir(bad).is_none());
    }
    assert!(!t.path().join("evil").exists() && !t.path().join("sig").exists());
}

fn dead_pid() -> u32 {
    let mut c = if cfg!(windows) { std::process::Command::new("cmd").args(["/C", "exit", "0"]).spawn().unwrap() } else { std::process::Command::new("true").spawn().unwrap() };
    let pid = c.id();
    c.wait().unwrap();
    pid
}

fn my_exe_name() -> String {
    std::env::current_exe().unwrap().file_name().unwrap().to_string_lossy().into_owned()
}

#[test]
fn running_signal_is_ignored_when_stale() {
    let t = tempfile::tempdir().unwrap();
    let sig = Signals::new(t.path());
    let me = std::process::id();
    sig.write_running("enos", &Running { pid: me, started_at: NOW, exe: my_exe_name() }).unwrap();
    assert_eq!(sig.read_running("enos").unwrap().pid, me, "processus vivant de ce nom");
    sig.write_running("enos", &Running { pid: me, started_at: NOW, exe: "AUTRE.exe".into() }).unwrap();
    assert!(sig.read_running("enos").is_none(), "PID réutilisé par un autre programme = périmé");
    sig.write_running("enos", &Running { pid: dead_pid(), started_at: NOW, exe: my_exe_name() }).unwrap();
    assert!(sig.read_running("enos").is_none(), "PID mort = périmé");
    for bad_exe in ["../x.exe", "a/b.exe", ""] {
        sig.write_running("enos", &Running { pid: me, started_at: NOW, exe: bad_exe.into() }).unwrap();
        assert!(sig.read_running("enos").is_none());
    }
    let f = t.path().join("enos").join("running.json");
    fs::write(&f, b"[1,2").unwrap();
    assert!(sig.read_running("enos").is_none());
    sig.clear_running("enos");
    assert!(procs::is_alive(me) && !procs::is_alive(0) && !procs::is_alive(dead_pid()));
    assert!(procs::matches_name(me, &my_exe_name()) && !procs::matches_name(me, "nope.exe"));
}

#[test]
fn apply_signal_expires_after_ten_minutes_with_injected_clock() {
    let t = tempfile::tempdir().unwrap();
    let sig = Signals::new(t.path());
    assert!(sig.read_apply("enos", NOW).is_none());
    sig.write_apply("enos", &Apply { requested_at: NOW, pid: 42 }).unwrap();
    assert_eq!(sig.read_apply("enos", NOW + 5).unwrap(), Apply { requested_at: NOW, pid: 42 });
    assert!(sig.read_apply("enos", NOW + 600).is_some(), "10 min pile : encore valide");
    assert!(sig.read_apply("enos", NOW + 601).is_none(), "périmé");
    assert!(sig.read_apply_raw("enos").is_some());
    assert!(sig.read_apply("enos", NOW - 10_000).is_none(), "date très lointaine dans le futur : refusée");
    fs::write(t.path().join("enos").join("update-apply.json"), b"\xff\xfe").unwrap();
    assert!(sig.read_apply_raw("enos").is_none());
    sig.write_applied("enos", "1.1.0", NOW).unwrap();
    assert_eq!(sig.read_applied("enos").unwrap().version, "1.1.0");
    let raw: Value = serde_json::from_slice(&fs::read(t.path().join("enos").join("update-applied.json")).unwrap()).unwrap();
    assert_eq!(raw, json!({"version":"1.1.0","applied_at":NOW}));
}

// ---------------------------------------------------------------- apply
#[test]
fn apply_replaces_removes_and_keeps_user_data() {
    let w = World::new();
    w.stage_v2();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(w.install.join("ENOS.exe"), fs::Permissions::from_mode(0o751)).unwrap();
    }
    let data_before = (read(&w.install, "data/user.db"), read(&w.install, "data/sub/notes.txt"), read(&w.install, "nasko_config.json"));
    let done = w.apply(&Options::default()).unwrap();
    assert_eq!(done.version, "1.1.0");
    assert_eq!(done.removed, vec!["old.txt"]);
    assert_eq!(done.files.len(), 4);
    assert_eq!(done.files["a.txt"], sha(b"a-v2"));
    assert_eq!(done.files["lib/core.dll"], sha(b"core-v1"));
    assert_eq!(read(&w.install, "ENOS.exe"), "exe-v2");
    assert_eq!(read(&w.install, "a.txt"), "a-v2");
    assert_eq!(read(&w.install, "new/n.txt"), "n-v2");
    assert_eq!(read(&w.install, "lib/core.dll"), "core-v1");
    assert!(!w.install.join("old.txt").exists());
    assert_eq!(data_before, (read(&w.install, "data/user.db"), read(&w.install, "data/sub/notes.txt"), read(&w.install, "nasko_config.json")));
    no_leftovers(&w.install);
    assert!(staging::staged(&w.root, "enos").is_none() && !staging::product_dir(&w.root, "enos").exists(), "staging supprimé");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(w.install.join("ENOS.exe")).unwrap().permissions().mode() & 0o777, 0o751, "droits conservés");
    }
    assert!(w.apply(&Options::default()).is_err(), "plus rien de prêt");
}

#[test]
fn every_injected_failure_rolls_back_completely() {
    let mut ok_at = None;
    for n in 0..40 {
        let w = World::new();
        w.stage_v2();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(w.install.join("a.txt"), fs::Permissions::from_mode(0o700)).unwrap();
        }
        let before = snapshot(&w.install);
        match w.apply(&Options { fail_after: Some(n) }) {
            Err(e) => {
                assert!(e.to_string().contains("injected"), "{e}");
                assert_eq!(snapshot(&w.install), before, "échec à l'opération {n} : l'installation doit être strictement identique (aucun fichier perdu ni demi-écrit)");
                assert!(staging::staged(&w.root, "enos").is_some(), "le staging reste utilisable pour une nouvelle tentative");
                assert!(w.apply(&Options::default()).is_ok(), "la nouvelle tentative réussit");
                assert_eq!(read(&w.install, "a.txt"), "a-v2");
            }
            Ok(_) => {
                ok_at = Some(n);
                break;
            }
        }
    }
    assert!(ok_at.unwrap() >= 8, "il y a au moins 8 opérations testées, trouvé {ok_at:?}");
}

#[test]
fn tampered_staging_is_refused_before_anything_changes() {
    let w = World::new();
    w.stage_v2();
    let before = snapshot(&w.install);
    let staged_file = staging::files_dir(&w.root, &mk("1.1.0", &v2_files())).join("a.txt");
    fs::write(&staged_file, b"a-v9").unwrap(); // même taille, contenu altéré
    assert!(matches!(w.apply(&Options::default()), Err(Error::Hash(_))));
    assert_eq!(snapshot(&w.install), before);
    fs::write(&staged_file, b"trop long").unwrap();
    assert!(w.apply(&Options::default()).is_err() || staging::staged(&w.root, "enos").is_none());
    assert_eq!(snapshot(&w.install), before);
}

fn tamper_ready(w: &World, f: impl Fn(&mut Value)) {
    let p = w.root.join("enos").join("ready.json");
    let mut v: Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
    f(&mut v);
    fs::write(&p, serde_json::to_vec(&v).unwrap()).unwrap();
}

#[test]
fn hostile_paths_in_the_staging_state_are_refused() {
    for (why, bad) in [("dotdot", "../evil.txt"), ("absolu", "/tmp/evil.txt"), ("données", "data/user.db"), ("config", "nasko_config.json"), ("journal", ".update-journal.json"), ("profond", "a/../../evil")] {
        for key in ["changed", "removed"] {
            let w = World::new();
            w.stage_v2();
            let outside = w.install.parent().unwrap().join("evil.txt");
            fs::write(&outside, b"intact").unwrap();
            let before = snapshot(&w.install);
            tamper_ready(&w, |v| {
                v[key].as_array_mut().unwrap().push(json!(bad));
            });
            let r = w.apply(&Options::default());
            assert!(r.is_err(), "{why}/{key} doit être refusé");
            assert_eq!(snapshot(&w.install), before, "{why}/{key}");
            assert_eq!(fs::read(&outside).unwrap(), b"intact");
        }
    }
}

#[cfg(unix)]
#[test]
fn symlinks_are_never_followed_when_overwriting() {
    use std::os::unix::fs::symlink;
    // 1) un dossier du chemin est un lien vers l'extérieur
    let w = World::new();
    let outside = w.install.parent().unwrap().join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::remove_file(w.install.join("lib/core.dll")).unwrap();
    fs::remove_dir(w.install.join("lib")).unwrap();
    symlink(&outside, w.install.join("lib")).unwrap();
    let m = mk("1.1.0", &[("ENOS.exe", b"exe-v2"), ("lib/core.dll", b"core-v2"), ("a.txt", b"a-v1"), ("old.txt", b"old-v1")]);
    w.srv.add("1.1.0", "lib/core.dll", b"core-v2");
    let mut cur = w.current.clone();
    cur.remove("lib/core.dll");
    let base = w.srv.base.clone();
    staging::stage(&m, &cur, &w.root, &mut |i| Ok(format!("{base}/1.1.0/{}", m.files[i].path)), &AtomicBool::new(false), &mut |_| {}).unwrap();
    let before = snapshot(&w.install);
    let r = w.apply(&Options::default());
    assert!(r.is_err());
    assert_eq!(fs::read_dir(&outside).unwrap().count(), 0, "rien n'a été écrit à travers le lien");
    assert_eq!(snapshot(&w.install), before);

    // 2) le fichier cible est un lien vers un fichier extérieur : le lien est remplacé, la cible reste intacte
    let w = World::new();
    w.stage_v2();
    let target = w.install.parent().unwrap().join("target.txt");
    fs::write(&target, b"CIBLE").unwrap();
    fs::remove_file(w.install.join("a.txt")).unwrap();
    symlink(&target, w.install.join("a.txt")).unwrap();
    w.apply(&Options::default()).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"CIBLE");
    assert!(!fs::symlink_metadata(w.install.join("a.txt")).unwrap().file_type().is_symlink());
    assert_eq!(read(&w.install, "a.txt"), "a-v2");

    // 3) un lien piégé à l'emplacement du fichier temporaire
    let w = World::new();
    w.stage_v2();
    let target = w.install.parent().unwrap().join("t2.txt");
    fs::write(&target, b"CIBLE2").unwrap();
    symlink(&target, w.install.join("a.txt.update-new")).unwrap();
    w.apply(&Options::default()).unwrap();
    assert_eq!(fs::read(&target).unwrap(), b"CIBLE2");
    assert_eq!(read(&w.install, "a.txt"), "a-v2");

    // 4) échec injecté avec un lien : le lien d'origine est restauré tel quel
    let w = World::new();
    w.stage_v2();
    let target = w.install.parent().unwrap().join("t3.txt");
    fs::write(&target, b"CIBLE3").unwrap();
    fs::remove_file(w.install.join("a.txt")).unwrap();
    symlink(&target, w.install.join("a.txt")).unwrap();
    let before = snapshot(&w.install);
    for n in 0..30 {
        match w.apply(&Options { fail_after: Some(n) }) {
            Err(_) => assert_eq!(snapshot(&w.install), before, "n={n}"),
            Ok(_) => break,
        }
    }
}

// ---------------------------------------------------------------- recover
fn journal(state: &str, ops: Value) -> Value {
    json!({"state":state,"product":"enos","version":"1.1.0","started_at":NOW,"ops":ops})
}

#[test]
fn recover_restores_after_a_simulated_crash() {
    let w = World::new();
    let before = snapshot(&w.install);
    // plantage au milieu de la phase 2 : a.txt déjà remplacé, ENOS.exe déplacé sans remplaçant, new/n.txt créé, old.txt déplacé, restes .update-new
    let rb = w.install.join(".update-rollback").join("1.1.0");
    fs::create_dir_all(&rb).unwrap();
    fs::rename(w.install.join("a.txt"), rb.join("a.txt")).unwrap();
    write(&w.install, "a.txt", b"a-v2");
    fs::rename(w.install.join("ENOS.exe"), rb.join("ENOS.exe")).unwrap();
    write(&w.install, "ENOS.exe.update-new", b"exe-v2");
    write(&w.install, "new/n.txt", b"n-v2");
    fs::rename(w.install.join("old.txt"), rb.join("old.txt")).unwrap();
    fs::write(
        w.install.join(".update-journal.json"),
        serde_json::to_vec(&journal("in_progress", json!([{"path":"ENOS.exe","kind":"replace"},{"path":"a.txt","kind":"replace"},{"path":"new/n.txt","kind":"add"},{"path":"old.txt","kind":"remove"},{"path":"../evil","kind":"replace"}]))).unwrap(),
    )
    .unwrap();
    assert!(apply::recover(&w.install).unwrap());
    assert_eq!(snapshot(&w.install), before);
    assert!(!apply::recover(&w.install).unwrap(), "idempotent");
}

#[test]
fn recover_cleans_a_finished_journal_and_apply_recovers_first() {
    let w = World::new();
    let before = snapshot(&w.install);
    fs::create_dir_all(w.install.join(".update-rollback/1.1.0")).unwrap();
    fs::write(w.install.join(".update-journal.json"), serde_json::to_vec(&journal("done", json!([]))).unwrap()).unwrap();
    assert!(!apply::recover(&w.install).unwrap());
    assert_eq!(snapshot(&w.install), before);
    // journal corrompu : on ne devine pas, et apply refuse de continuer
    fs::write(w.install.join(".update-journal.json"), b"{trunc").unwrap();
    assert!(apply::recover(&w.install).is_err());
    w.stage_v2();
    assert!(w.apply(&Options::default()).is_err());
    assert_eq!(read(&w.install, "a.txt"), "a-v1");
    fs::remove_file(w.install.join(".update-journal.json")).unwrap();
    // journal « en cours » laissé par un plantage, puis apply : restaure d'abord, applique ensuite
    let rb = w.install.join(".update-rollback").join("1.1.0");
    fs::create_dir_all(&rb).unwrap();
    fs::rename(w.install.join("a.txt"), rb.join("a.txt")).unwrap();
    fs::write(w.install.join(".update-journal.json"), serde_json::to_vec(&journal("in_progress", json!([{"path":"a.txt","kind":"replace"}]))).unwrap()).unwrap();
    w.apply(&Options::default()).unwrap();
    assert_eq!(read(&w.install, "a.txt"), "a-v2");
    no_leftovers(&w.install);
}

// ---------------------------------------------------------------- application en marche
/// Faux « application » : une copie du binaire de test nommée ENOS.exe dans le dossier d'installation, qui dort.
#[test]
#[ignore]
fn __sleeper() {
    thread::sleep(std::time::Duration::from_secs(60));
}

struct Child(std::process::Child);
impl Drop for Child {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn spawn_fake_app(install: &Path) -> Child {
    let exe = install.join("ENOS.exe");
    fs::copy(std::env::current_exe().unwrap(), &exe).unwrap();
    let c = std::process::Command::new(&exe).args(["--ignored", "--exact", "__sleeper", "--nocapture"]).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
    let pid = c.id();
    for _ in 0..100 {
        if procs::matches_name(pid, "ENOS.exe") {
            break;
        }
        thread::sleep(std::time::Duration::from_millis(50));
    }
    Child(c)
}

/// Monde dont l'installation v1 contient la vraie « application » qui tourne (le contenu de ENOS.exe change donc : on recalcule `current`).
fn world_with_running_app() -> (World, Child) {
    let mut w = World::new();
    let child = spawn_fake_app(&w.install);
    w.current.insert("ENOS.exe".into(), download::sha256_file(&w.install.join("ENOS.exe")).unwrap());
    (w, child)
}

#[test]
fn apply_refuses_while_the_application_runs() {
    let (w, mut child) = world_with_running_app();
    w.stage_v2();
    let before = snapshot(&w.install);
    // par running.json
    w.sig.write_running("enos", &Running { pid: child.0.id(), started_at: NOW, exe: "ENOS.exe".into() }).unwrap();
    assert!(procs::app_running(&w.sig, "enos", &w.install, "ENOS.exe"));
    let e = w.apply(&Options::default()).unwrap_err();
    assert!(e.to_string().contains("is running"), "{e}");
    assert_eq!(snapshot(&w.install), before);
    // sans running.json (ancienne version de l'application) : détecté par le processus lui-même
    w.sig.clear_running("enos");
    assert!(procs::app_running(&w.sig, "enos", &w.install, "ENOS.exe"));
    assert!(w.apply(&Options::default()).is_err());
    // PID de ce processus de test (running.json valide) mais lancé hors du dossier d'installation = autre copie, ne bloque pas
    w.sig.write_running("enos", &Running { pid: std::process::id(), started_at: NOW, exe: my_exe_name() }).unwrap();
    let me_dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
    assert!(procs::app_running(&w.sig, "enos", &me_dir, ""), "PID du test, depuis son propre dossier : en marche");
    // fermeture : wait_exit puis l'application peut être appliquée
    w.sig.clear_running("enos");
    assert!(!procs::wait_exit(child.0.id(), std::time::Duration::from_millis(200)), "wait_exit ne tue pas et expire");
    child.0.kill().unwrap();
    child.0.wait().unwrap();
    assert!(procs::wait_exit(child.0.id(), std::time::Duration::from_secs(5)));
    assert!(!procs::app_running(&w.sig, "enos", &w.install, "ENOS.exe"));
    w.apply(&Options::default()).unwrap();
    assert_eq!(read(&w.install, "ENOS.exe"), "exe-v2");
}

// ---------------------------------------------------------------- plan
#[test]
fn plan_covers_every_case() {
    let inst = |v: &str| Installed { version: v.into(), channel: "stable".into(), dir: "/x".into(), run: "ENOS.exe".into(), installed_at: 0, files: BTreeMap::new(), mode: "files".into() };
    let latest = mk("1.1.0", &v2_files());
    let staged = |v: &str, ch: &str| {
        let mut m = mk(v, &v2_files());
        m.channel = ch.into();
        Staged { manifest: m, changed: vec![], removed: vec![], size: 0, staged_at: 1 }
    };
    assert_eq!(updater::plan(None, &latest, None), Plan::Nothing, "non installé");
    assert_eq!(updater::plan(Some(&inst("1.0.0")), &latest, None), Plan::Stage);
    assert_eq!(updater::plan(Some(&inst("1.1.0")), &latest, None), Plan::Nothing, "même version");
    assert_eq!(updater::plan(Some(&inst("1.2.0")), &latest, None), Plan::Nothing, "installé plus récent");
    assert_eq!(updater::plan(Some(&inst("1.0.0")), &latest, Some(&staged("1.1.0", "stable"))), Plan::AlreadyStaged);
    assert_eq!(updater::plan(Some(&inst("1.0.0")), &latest, Some(&staged("1.2.0", "stable"))), Plan::AlreadyStaged, "plus récent déjà prêt");
    assert_eq!(updater::plan(Some(&inst("1.0.0")), &latest, Some(&staged("1.0.5", "stable"))), Plan::Stage, "ancien staging : à remplacer");
    assert_eq!(updater::plan(Some(&inst("1.0.0")), &latest, Some(&staged("1.1.0", "dev"))), Plan::Stage, "autre canal");
    assert_eq!(updater::plan(Some(&inst("dev")), &latest, None), Plan::Nothing, "version installée illisible");
    assert_eq!(updater::plan(Some(&inst("1.9.0")), &mk("1.10.0", &v2_files()), None), Plan::Stage, "comparaison numérique");
    let fx: Value = serde_json::from_str(include_str!("fixtures/manifest_fixture.json")).unwrap();
    let installer = manifest::parse(&fx["manifest"]).unwrap();
    assert_eq!(updater::plan(Some(&inst("0.0.1")), &installer, None), Plan::Nothing, "mode installer : hors du flux arrière-plan");
}

// ---------------------------------------------------------------- tick_apply / prepare_launch
fn ready_world() -> (World, Store) {
    let w = World::new();
    let s = w.stage_v2();
    updater::announce(&w.sig, &s).unwrap();
    let st = w.store();
    (w, st)
}

#[test]
fn tick_without_apply_flag_touches_nothing() {
    let (w, st) = ready_world();
    let before = snapshot(&w.install);
    let opts = Options::default();
    assert_eq!(updater::tick_apply(&w.ctx(&st, NOW, &opts)).unwrap(), ApplyOutcome::Nothing);
    assert_eq!(snapshot(&w.install), before);
    assert!(staging::staged(&w.root, "enos").is_some() && w.sig.read_ready("enos").is_some(), "« Plus tard » : la mise à jour reste prête");
    assert_eq!(st.get("enos").unwrap().version, "1.0.0");
}

#[test]
fn tick_with_flag_waits_while_running_then_applies_once_closed() {
    let (mut w, child) = world_with_running_app();
    let s = w.stage_v2();
    updater::announce(&w.sig, &s).unwrap();
    w.current.insert("ENOS.exe".into(), download::sha256_file(&w.install.join("ENOS.exe")).unwrap());
    let st = w.store();
    let opts = Options::default();
    w.sig.write_apply("enos", &Apply { requested_at: NOW, pid: child.0.id() }).unwrap();
    assert_eq!(updater::tick_apply(&w.ctx(&st, NOW + 2, &opts)).unwrap(), ApplyOutcome::Waiting);
    assert_eq!(updater::tick_apply(&w.ctx(&st, NOW + 4, &opts)).unwrap(), ApplyOutcome::Waiting);
    assert!(w.sig.read_apply_raw("enos").is_some(), "la demande est conservée tant que l'application tourne");
    assert_eq!(st.get("enos").unwrap().version, "1.0.0");
    drop(child); // l'application se ferme d'elle-même (ici : le test la termine)
    for _ in 0..50 {
        if !procs::app_running(&w.sig, "enos", &w.install, "ENOS.exe") {
            break;
        }
        thread::sleep(std::time::Duration::from_millis(50));
    }
    let out = updater::tick_apply(&w.ctx(&st, NOW + 6, &opts)).unwrap();
    assert_eq!(out, ApplyOutcome::Applied { relaunch: true, version: "1.1.0".into() });
    let i = st.get("enos").unwrap();
    assert_eq!((i.version.as_str(), i.mode.as_str(), i.run.as_str()), ("1.1.0", "files", "ENOS.exe"));
    assert_eq!(i.files.len(), 4);
    assert_eq!(i.files["a.txt"], sha(b"a-v2"));
    assert_eq!(w.sig.read_applied("enos").unwrap().version, "1.1.0");
    assert!(w.sig.read_ready("enos").is_none() && w.sig.read_apply_raw("enos").is_none());
    assert_eq!(read(&w.install, "a.txt"), "a-v2");
    assert_eq!(updater::tick_apply(&w.ctx(&st, NOW + 8, &opts)).unwrap(), ApplyOutcome::Nothing);
}

#[test]
fn tick_applies_directly_when_the_app_is_not_running() {
    let (w, st) = ready_world();
    let opts = Options::default();
    w.sig.write_apply("enos", &Apply { requested_at: NOW, pid: dead_pid() }).unwrap();
    assert_eq!(updater::tick_apply(&w.ctx(&st, NOW + 1, &opts)).unwrap(), ApplyOutcome::Applied { relaunch: true, version: "1.1.0".into() });
    assert_eq!(read(&w.install, "ENOS.exe"), "exe-v2");
    assert!(!w.install.join("old.txt").exists());
}

#[test]
fn tick_ignores_stale_or_pointless_requests_and_reports_failures_after_rollback() {
    // demande périmée : supprimée, rien appliqué
    let (w, st) = ready_world();
    let opts = Options::default();
    w.sig.write_apply("enos", &Apply { requested_at: NOW, pid: 1 }).unwrap();
    assert_eq!(updater::tick_apply(&w.ctx(&st, NOW + 601, &opts)).unwrap(), ApplyOutcome::Nothing);
    assert!(w.sig.read_apply_raw("enos").is_none());
    assert_eq!(read(&w.install, "a.txt"), "a-v1");
    // demande sans mise à jour prête : supprimée
    let w2 = World::new();
    let st2 = w2.store();
    w2.sig.write_apply("enos", &Apply { requested_at: NOW, pid: 1 }).unwrap();
    assert_eq!(updater::tick_apply(&w2.ctx(&st2, NOW + 1, &opts)).unwrap(), ApplyOutcome::Nothing);
    assert!(w2.sig.read_apply_raw("enos").is_none());
    // produit inconnu du store
    let w3 = World::new();
    let st3 = Store::new(&w3.store_dir).unwrap();
    w3.sig.write_apply("enos", &Apply { requested_at: NOW, pid: 1 }).unwrap();
    assert_eq!(updater::tick_apply(&w3.ctx(&st3, NOW + 1, &opts)).unwrap(), ApplyOutcome::Nothing);
    // échec à l'application : erreur, ancienne version intacte, demande effacée (pas de boucle), mise à jour toujours prête
    let (w4, st4) = ready_world();
    let before = snapshot(&w4.install);
    w4.sig.write_apply("enos", &Apply { requested_at: NOW, pid: 1 }).unwrap();
    let failing = Options { fail_after: Some(4) };
    assert!(updater::tick_apply(&w4.ctx(&st4, NOW + 1, &failing)).is_err());
    assert_eq!(snapshot(&w4.install), before);
    assert_eq!(st4.get("enos").unwrap().version, "1.0.0");
    assert!(w4.sig.read_apply_raw("enos").is_none() && staging::staged(&w4.root, "enos").is_some());
    // staging déjà installé (même version) : nettoyé
    let (w5, st5) = ready_world();
    st5.set("enos", Installed { version: "1.1.0".into(), ..w5.installed() }).unwrap();
    w5.sig.write_apply("enos", &Apply { requested_at: NOW, pid: 1 }).unwrap();
    assert_eq!(updater::tick_apply(&w5.ctx(&st5, NOW + 1, &opts)).unwrap(), ApplyOutcome::Nothing);
    assert!(staging::staged(&w5.root, "enos").is_none() && w5.sig.read_ready("enos").is_none());
}

#[test]
fn prepare_launch_applies_silently_only_when_not_running() {
    let (w, st) = ready_world();
    let opts = Options::default();
    assert_eq!(updater::prepare_launch(&w.ctx(&st, NOW, &opts)).unwrap(), ApplyOutcome::Applied { relaunch: true, version: "1.1.0".into() });
    assert_eq!(read(&w.install, "ENOS.exe"), "exe-v2");
    assert_eq!(updater::prepare_launch(&w.ctx(&st, NOW, &opts)).unwrap(), ApplyOutcome::Nothing, "plus rien de prêt");

    let (mut w, child) = world_with_running_app();
    let s = w.stage_v2();
    updater::announce(&w.sig, &s).unwrap();
    w.current.insert("ENOS.exe".into(), download::sha256_file(&w.install.join("ENOS.exe")).unwrap());
    let st = w.store();
    let before = snapshot(&w.install);
    assert_eq!(updater::prepare_launch(&w.ctx(&st, NOW, &opts)).unwrap(), ApplyOutcome::Waiting);
    assert_eq!(snapshot(&w.install), before);
    drop(child);
}

// ---------------------------------------------------------------- réglages
#[test]
fn settings_defaults_bounds_and_atomic_write() {
    let t = tempfile::tempdir().unwrap();
    let st = Store::new(t.path()).unwrap();
    assert_eq!(st.settings(), Settings { auto_update: false, check_interval_min: 30 });
    assert_eq!(st.set_settings(Settings { auto_update: true, check_interval_min: 1 }).unwrap().check_interval_min, 5);
    assert_eq!(st.set_settings(Settings { auto_update: true, check_interval_min: 99_999 }).unwrap().check_interval_min, 1440);
    assert_eq!(st.settings(), Settings { auto_update: true, check_interval_min: 1440 });
    assert!(!t.path().join("settings.json.tmp").exists());
    fs::write(t.path().join("settings.json"), br#"{"auto_update":true,"check_interval_min":0}"#).unwrap();
    assert_eq!(st.settings().check_interval_min, 5, "borné aussi à la lecture");
    fs::write(t.path().join("settings.json"), b"???").unwrap();
    assert_eq!(st.settings(), Settings::default());
    fs::write(t.path().join("settings.json"), br#"{"auto_update":true}"#).unwrap();
    assert_eq!(st.settings(), Settings { auto_update: true, check_interval_min: 30 });
    // un installed.json ancien (sans files/mode) se relit toujours
    fs::write(t.path().join("installed.json"), br#"{"enos":{"version":"1.0.0","channel":"stable","dir":"C:/x"}}"#).unwrap();
    let i = st.get("enos").unwrap();
    assert_eq!((i.mode.as_str(), i.files.len()), ("installer", 0));
}
