//! JSON canonique : clés triées (ordre des points de code), aucun espace, UTF-8 non échappé — le même texte que
//! `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` côté serveur. Écrit à la main pour ne pas dépendre
//! de la fonctionnalité `preserve_order` de serde_json, qu'une autre dépendance du projet pourrait activer.
use serde_json::Value;

pub fn canonical(v: &Value) -> Vec<u8> {
    let mut out = String::new();
    write(v, &mut out);
    out.into_bytes()
}

fn write(v: &Value, out: &mut String) {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => out.push_str(&serde_json::to_string(s).expect("chaîne JSON")),
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(x, out);
            }
            out.push(']');
        }
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).expect("clé JSON"));
                out.push(':');
                write(&m[*k], out);
            }
            out.push('}');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorted_compact_unicode_untouched() {
        let v = json!({"b": 1, "a": {"z": [1, "é", "ï\n\"x\\"], "y": null}, "é": true});
        assert_eq!(String::from_utf8(canonical(&v)).unwrap(), r#"{"a":{"y":null,"z":[1,"é","ï\n\"x\\"]},"b":1,"é":true}"#);
    }
}
