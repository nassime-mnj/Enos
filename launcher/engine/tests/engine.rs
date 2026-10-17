//! Tests d'intégration du moteur : compatibilité avec le serveur Python, téléchargements (reprise, corruption, annulation), installation.
use dp_engine::download::{download, part_path, sha256_file};
use dp_engine::install::{fetch_files, run_installer, Runner};
use dp_engine::manifest::{self, Manifest};
use dp_engine::{canon, Error};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tiny_http::{Header, Response, Server, StatusCode};

fn sha(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/manifest_fixture.json")).unwrap()
}

// ---------------------------------------------------------------- compatibilité serveur Python
#[test]
fn canonical_json_is_byte_identical_to_the_python_server() {
    let fx = fixture();
    assert_eq!(String::from_utf8(canon::canonical(&fx["manifest"])).unwrap(), fx["canonical"].as_str().unwrap());
}

#[test]
fn signature_made_by_the_python_server_code_verifies() {
    let fx = fixture();
    let m = manifest::open(&fx["manifest"], fx["signature"].as_str().unwrap(), fx["pubkey"].as_str().unwrap()).expect("signature valide");
    assert_eq!((m.product.as_str(), m.channel.as_str(), m.version.as_str()), ("enos", "dev", "3.2.0"));
    assert_eq!(m.run, "ENOS.exe");
    assert_eq!(m.files[0].size, 12345);
}

#[test]
fn any_tampering_or_wrong_key_is_rejected() {
    let fx = fixture();
    let (sig, pk) = (fx["signature"].as_str().unwrap(), fx["pubkey"].as_str().unwrap());
    let mut tampered = fx["manifest"].clone();
    tampered["version"] = json!("9.9.9");
    assert!(matches!(manifest::open(&tampered, sig, pk), Err(Error::BadSignature)));
    let mut sha_swap = fx["manifest"].clone();
    sha_swap["files"][0]["sha256"] = json!("b".repeat(64));
    assert!(matches!(manifest::open(&sha_swap, sig, pk), Err(Error::BadSignature)));
    let other = "1w4le9pnGeX5NmaWwiDSI6/KPlIrpARcWo4MhQWcGrU=";
    assert!(matches!(manifest::open(&fx["manifest"], sig, other), Err(Error::BadSignature)));
    for bad in ["", "pas-du-base64", "AAAA"] {
        assert!(matches!(manifest::open(&fx["manifest"], bad, pk), Err(Error::BadSignature)));
    }
    assert!(matches!(manifest::open(&fx["manifest"], sig, "x"), Err(Error::BadSignature)));
}

#[test]
fn shape_checks_refuse_dangerous_manifests() {
    let base = fixture()["manifest"].clone();
    let mut cases: Vec<(&str, Value)> = vec![];
    for p in ["../evil.exe", "/etc/passwd", "a/../../b", "C:/x.exe", "a\\b.exe", ".hidden", "a//b", ""] {
        let mut m = base.clone();
        m["files"][0]["path"] = json!(p);
        m["launch"] = json!("");
        cases.push(("chemin", m));
    }
    let mut m = base.clone(); m["files"][0]["sha256"] = json!("XYZ"); cases.push(("sha", m));
    let mut m = base.clone(); m["files"] = json!([]); cases.push(("vide", m));
    let mut m = base.clone(); m["version"] = json!("latest"); cases.push(("version", m));
    let mut m = base.clone(); m["launch"] = json!("autre.exe"); cases.push(("launch", m));
    let mut m = base.clone(); m["run"] = json!("../x.exe"); cases.push(("run", m));
    let mut m = base.clone(); m["app_id"] = json!("{;rm -rf}"); cases.push(("app_id", m));
    for (why, m) in cases {
        assert!(matches!(manifest::parse(&m), Err(Error::Manifest(_))), "doit être refusé : {why}");
    }
    assert!(manifest::parse(&base).is_ok());
}

// ---------------------------------------------------------------- petit serveur HTTP (Range, 403, corruption)
struct Srv {
    url: String,
    hits: Arc<AtomicUsize>,
    ranges: Arc<Mutex<Vec<String>>>,
}

#[derive(Clone, Copy)]
enum Mode {
    Normal,
    IgnoreRange,
    Truncate(usize),      // coupe la réponse après n octets (coupure réseau)
    Forbidden(usize),     // répond 403 pour les n premières requêtes (lien expiré)
}

fn serve(body: Vec<u8>, mode: Mode) -> Srv {
    let server = Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://127.0.0.1:{}/file", server.server_addr().to_ip().unwrap().port());
    let hits = Arc::new(AtomicUsize::new(0));
    let ranges = Arc::new(Mutex::new(vec![]));
    let (h, r) = (hits.clone(), ranges.clone());
    thread::spawn(move || {
        for rq in server.incoming_requests() {
            let n = h.fetch_add(1, Ordering::SeqCst);
            let range = rq.headers().iter().find(|x| x.field.equiv("Range")).map(|x| x.value.to_string());
            if let Some(v) = &range {
                r.lock().unwrap().push(v.clone());
            }
            if let Mode::Forbidden(k) = mode {
                if n < k {
                    let _ = rq.respond(Response::empty(StatusCode(403)));
                    continue;
                }
            }
            let start: usize = match (&range, mode) {
                (Some(v), m) if !matches!(m, Mode::IgnoreRange) => v.trim_start_matches("bytes=").trim_end_matches('-').parse().unwrap_or(0),
                _ => 0,
            };
            if start >= body.len() && start > 0 {
                let _ = rq.respond(Response::empty(StatusCode(416)));
                continue;
            }
            let mut slice = body[start..].to_vec();
            if let Mode::Truncate(k) = mode {
                if n == 0 {
                    slice.truncate(k);
                }
            }
            let code = if start > 0 { 206 } else { 200 };
            let full = Response::from_data(body[start..].to_vec()).with_status_code(StatusCode(code));
            let resp = if let Mode::Truncate(_) = mode {
                // annonce la taille complète mais n'envoie qu'une partie : le client voit une coupure
                Response::new(StatusCode(code), vec![Header::from_bytes("Content-Length", (body.len() - start).to_string()).unwrap()], std::io::Cursor::new(slice.clone()), Some(body.len() - start), None)
            } else {
                full
            };
            let _ = rq.respond(resp);
        }
    });
    Srv { url, hits, ranges }
}

fn payload(n: usize) -> Vec<u8> {
    (0..n).map(|i| (i * 31 % 251) as u8).collect()
}

#[test]
fn download_writes_verifies_and_renames_atomically() {
    let data = payload(300_000);
    let s = serve(data.clone(), Mode::Normal);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("sub").join("f.bin");
    let mut last = (0, 0);
    download(&s.url, &dest, data.len() as u64, &sha(&data), &AtomicBool::new(false), |p| last = (p.done, p.total)).unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    assert!(!part_path(&dest).exists());
    assert_eq!(last, (data.len() as u64, data.len() as u64));
    let before = s.hits.load(Ordering::SeqCst);
    download(&s.url, &dest, data.len() as u64, &sha(&data), &AtomicBool::new(false), |_| {}).unwrap();      // déjà conforme : aucune requête
    assert_eq!(s.hits.load(Ordering::SeqCst), before);
}

#[test]
fn interrupted_download_resumes_with_a_range_request() {
    let data = payload(500_000);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("f.bin");
    let s = serve(data.clone(), Mode::Truncate(120_000));
    let r = download(&s.url, &dest, data.len() as u64, &sha(&data), &AtomicBool::new(false), |_| {});
    assert!(r.is_err(), "la coupure doit être signalée");
    assert!(!dest.exists(), "aucun fichier définitif tant que ce n'est pas complet");
    let have = std::fs::metadata(part_path(&dest)).unwrap().len();
    assert!(have > 0 && have < data.len() as u64);
    download(&s.url, &dest, data.len() as u64, &sha(&data), &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    assert_eq!(s.ranges.lock().unwrap().last().unwrap(), &format!("bytes={have}-"));
}

#[test]
fn server_ignoring_range_restarts_from_zero_without_corruption() {
    let data = payload(200_000);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("f.bin");
    std::fs::write(part_path(&dest), &data[..50_000]).unwrap();
    let s = serve(data.clone(), Mode::IgnoreRange);
    download(&s.url, &dest, data.len() as u64, &sha(&data), &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), data);
}

#[test]
fn corrupted_or_substituted_file_is_never_installed() {
    let data = payload(100_000);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("f.bin");
    let s = serve(data.clone(), Mode::Normal);
    let wrong = sha(b"autre contenu");
    let r = download(&s.url, &dest, data.len() as u64, &wrong, &AtomicBool::new(false), |_| {});
    assert!(matches!(r, Err(Error::Hash(_))));
    assert!(!dest.exists() && !part_path(&dest).exists(), "ni fichier ni reste : la corruption est effacée");
    let r = download(&s.url, &dest, data.len() as u64 + 5, &sha(&data), &AtomicBool::new(false), |_| {});
    assert!(r.is_err() && !dest.exists());
}

#[test]
fn cancellation_keeps_the_partial_file_for_later() {
    let data = payload(400_000);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("f.bin");
    let s = serve(data.clone(), Mode::Normal);
    let cancel = AtomicBool::new(false);
    let r = download(&s.url, &dest, data.len() as u64, &sha(&data), &cancel, |p| {
        if p.done > 60_000 {
            cancel.store(true, Ordering::Relaxed);
        }
    });
    assert!(matches!(r, Err(Error::Cancelled)));
    assert!(part_path(&dest).exists() && !dest.exists());
    download(&s.url, &dest, data.len() as u64, &sha(&data), &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(sha256_file(&dest).unwrap(), sha(&data));
}

#[test]
fn only_https_or_loopback_urls_are_accepted() {
    let dir = tempfile::tempdir().unwrap();
    for u in ["http://example.com/f", "ftp://x/f", "file:///etc/passwd", "javascript:1", "http://127.0.0.1.evil.com/f"] {
        let r = download(u, &dir.path().join("f"), 1, &sha(b"x"), &AtomicBool::new(false), |_| {});
        assert!(matches!(r, Err(Error::Net(_))), "{u}");
    }
}

// ---------------------------------------------------------------- installation
struct Fake(Mutex<Vec<(String, Vec<String>)>>, i32);
impl Runner for Fake {
    fn run_installer(&self, exe: &Path, args: &[String]) -> dp_engine::Result<i32> {
        assert!(exe.is_file(), "l'installeur doit exister avant d'être lancé");
        self.0.lock().unwrap().push((exe.file_name().unwrap().to_string_lossy().into(), args.to_vec()));
        Ok(self.1)
    }
}

fn manifest_for(url_body: &[u8]) -> Manifest {
    manifest::parse(&json!({"product":"enos","channel":"stable","version":"1.2.0","launch":"Setup.exe","silent_args":"/SILENT /NORESTART","run":"ENOS.exe",
        "files":[{"path":"Setup.exe","sha256":sha(url_body),"size":url_body.len(),"key":"enos/stable/1.2.0/Setup.exe"}]})).unwrap()
}

#[test]
fn install_downloads_then_runs_the_silent_installer() {
    let data = payload(150_000);
    let s = serve(data.clone(), Mode::Normal);
    let m = manifest_for(&data);
    let dir = tempfile::tempdir().unwrap();
    let mut seen = 0u64;
    let work = fetch_files(&m, dir.path(), &mut |_| Ok(s.url.clone()), &AtomicBool::new(false), &mut |o| seen = o.done).unwrap();
    assert_eq!(seen, data.len() as u64);
    let fake = Fake(Mutex::new(vec![]), 0);
    run_installer(&m, &work, &fake).unwrap();
    assert_eq!(fake.0.lock().unwrap()[0], ("Setup.exe".to_string(), vec!["/SILENT".to_string(), "/NORESTART".to_string()]));
    assert!(matches!(run_installer(&m, &work, &Fake(Mutex::new(vec![]), 5)), Err(Error::Other(_))), "code de sortie non nul = échec");
}

#[test]
fn expired_link_is_renewed_once() {
    let data = payload(80_000);
    let s = serve(data.clone(), Mode::Forbidden(1));
    let m = manifest_for(&data);
    let dir = tempfile::tempdir().unwrap();
    let asked = AtomicUsize::new(0);
    fetch_files(&m, dir.path(), &mut |_| { asked.fetch_add(1, Ordering::SeqCst); Ok(s.url.clone()) }, &AtomicBool::new(false), &mut |_| {}).unwrap();
    assert_eq!(asked.load(Ordering::SeqCst), 2, "un nouveau lien est demandé après le 403");
    let s2 = serve(data.clone(), Mode::Forbidden(99));
    let dir2 = tempfile::tempdir().unwrap();
    let r = fetch_files(&m, dir2.path(), &mut |_| Ok(s2.url.clone()), &AtomicBool::new(false), &mut |_| {});
    assert!(matches!(r, Err(Error::Http(403))), "pas de boucle infinie");
}
