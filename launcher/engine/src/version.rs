//! Versions pointées « 1.2.3 » (1 à 4 nombres), comparées numériquement : « 1.10.0 » > « 1.9.0 ».
use std::cmp::Ordering;

pub fn parse(v: &str) -> Option<Vec<u64>> {
    let parts: Vec<&str> = v.trim().split('.').collect();
    if parts.is_empty() || parts.len() > 4 {
        return None;
    }
    parts.iter().map(|p| if !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) { p.parse().ok() } else { None }).collect()
}

pub fn compare(a: &str, b: &str) -> Option<Ordering> {
    let (mut x, mut y) = (parse(a)?, parse(b)?);
    let n = x.len().max(y.len());
    x.resize(n, 0);
    y.resize(n, 0);
    Some(x.cmp(&y))
}

/// Ce que le bouton principal doit faire pour un produit.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Action {
    Install,
    Update,
    Launch,
}

pub fn action(installed: Option<&str>, latest: &str) -> Action {
    match installed {
        None => Action::Install,
        Some(v) => match compare(v, latest) {
            Some(Ordering::Less) => Action::Update,
            Some(_) => Action::Launch,
            None => Action::Update,                              // version installée illisible : on réinstalle proprement
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_comparison() {
        assert_eq!(compare("1.10.0", "1.9.0"), Some(Ordering::Greater));
        assert_eq!(compare("2.0", "2.0.0"), Some(Ordering::Equal));
        assert_eq!(compare("1.2.3", "1.2.10"), Some(Ordering::Less));
        assert_eq!(compare("a.b", "1.0"), None);
        assert_eq!(compare("1..2", "1.0"), None);
    }

    #[test]
    fn button_action() {
        assert_eq!(action(None, "1.0.0"), Action::Install);
        assert_eq!(action(Some("1.0.0"), "1.1.0"), Action::Update);
        assert_eq!(action(Some("1.1.0"), "1.1.0"), Action::Launch);
        assert_eq!(action(Some("2.0.0"), "1.1.0"), Action::Launch);
        assert_eq!(action(Some("dev"), "1.1.0"), Action::Update);
    }
}
