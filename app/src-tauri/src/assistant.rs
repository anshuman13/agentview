use rusqlite::types::{Value as Sql, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::Mutex;

pub struct Store(Mutex<Option<Connection>>);

fn to_sql(v: &Value) -> Result<Sql, String> {
    Ok(match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(Sql::Integer).or_else(|| n.as_f64().map(Sql::Real)).ok_or("bad number")?,
        Value::String(s) => Sql::Text(s.clone()),
        _ => return Err("params must be null, number or string".into()),
    })
}

fn from_sql(v: ValueRef) -> Value {
    match v {
        ValueRef::Integer(i) => i.into(),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        _ => Value::Null,
    }
}

fn valid_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|b| b.is_ascii_hexdigit())
}

impl Store {
    pub fn new() -> Self {
        Store(Mutex::new(None))
    }

    pub fn open(&self, path: &Path, key: &str) -> Result<(), String> {
        if !valid_key(key) {
            return Err("invalid key".into());
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch(&format!("PRAGMA key = \"x'{key}'\";")).map_err(|e| e.to_string())?;
        conn.query_row("select count(*) from sqlite_master", [], |r| r.get::<_, i64>(0)).map_err(|_| "wrong key or damaged database".to_string())?;
        let mode: String = conn.query_row("PRAGMA journal_mode", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !mode.eq_ignore_ascii_case("wal") {
            conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
        }
        conn.pragma_update(None, "synchronous", "NORMAL").map_err(|e| e.to_string())?;
        *self.0.lock().unwrap() = Some(conn);
        Ok(())
    }

    pub fn close(&self) {
        *self.0.lock().unwrap() = None;
    }

    fn with<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let guard = self.0.lock().unwrap();
        let conn = guard.as_ref().ok_or("locked")?;
        f(conn).map_err(|e| e.to_string())
    }

    pub fn batch(&self, sql: &str) -> Result<(), String> {
        self.with(|c| c.execute_batch(sql))
    }

    pub fn exec(&self, sql: &str, params: &[Value]) -> Result<usize, String> {
        let p = params.iter().map(to_sql).collect::<Result<Vec<_>, _>>()?;
        self.with(|c| c.prepare_cached(sql)?.execute(params_from_iter(p)))
    }

    pub fn exec_many(&self, statements: &[(String, Vec<Value>)]) -> Result<Vec<usize>, String> {
        let bound = statements
            .iter()
            .map(|(sql, params)| Ok((sql, params.iter().map(to_sql).collect::<Result<Vec<_>, String>>()?)))
            .collect::<Result<Vec<_>, String>>()?;
        self.with(|c| {
            let tx = c.unchecked_transaction()?;
            let mut changed = Vec::with_capacity(bound.len());
            for (sql, p) in bound {
                changed.push(tx.prepare_cached(sql)?.execute(params_from_iter(p))?);
            }
            tx.commit()?;
            Ok(changed)
        })
    }

    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
        let p = params.iter().map(to_sql).collect::<Result<Vec<_>, _>>()?;
        self.with(|c| {
            let mut stmt = c.prepare_cached(sql)?;
            let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
            let rows = stmt.query_map(params_from_iter(p), |row| {
                let mut m = Map::new();
                for (i, n) in names.iter().enumerate() {
                    m.insert(n.clone(), from_sql(row.get_ref(i)?));
                }
                Ok(m)
            })?;
            rows.collect()
        })
    }
}

pub fn dev_key(dir: &Path) -> Result<String, String> {
    let file = dir.join("dev-key");
    if let Ok(k) = std::fs::read_to_string(&file) {
        if valid_key(k.trim()) {
            return Ok(k.trim().to_string());
        }
    }
    let mut raw = [0u8; 32];
    getrandom::getrandom(&mut raw).map_err(|e| e.to_string())?;
    let key: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(&file, &key).map_err(|e| e.to_string())?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const KEY: &str = "2dd29ca851e7b56e4697b0e1f08507293d761a05ce4d1b628663f411a8086d99";
    const OTHER: &str = "0000000000000000000000000000000000000000000000000000000000000001";

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("assistant-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn round_trip_and_encrypted_at_rest() {
        let d = tmp("rt");
        let file = d.join("a.db");
        let s = Store::new();
        s.open(&file, KEY).unwrap();
        s.batch("create table t(a, b)").unwrap();
        assert_eq!(s.exec("insert into t values (?, ?)", &[json!("x"), json!(7)]).unwrap(), 1);
        s.exec("insert into t values (?, ?)", &[json!(null), json!(1.5)]).unwrap();
        let rows = s.query("select a, b from t order by b desc", &[]).unwrap();
        assert_eq!(rows[1]["a"], Value::Null);
        assert_eq!(rows[0]["a"], json!("x"));
        assert_eq!(rows[0]["b"], json!(7));
        drop(s);
        let raw = std::fs::read(&file).unwrap();
        assert!(!raw.starts_with(b"SQLite format 3"));
    }

    #[test]
    fn wrong_key_is_rejected_and_locked_store_refuses() {
        let d = tmp("wk");
        let file = d.join("a.db");
        let s = Store::new();
        assert_eq!(s.query("select 1", &[]).unwrap_err(), "locked");
        s.open(&file, KEY).unwrap();
        s.batch("create table t(a)").unwrap();
        drop(s);
        let s2 = Store::new();
        assert!(s2.open(&file, OTHER).is_err());
        assert!(s2.query("select 1", &[]).is_err());
        assert!(s2.open(&file, "short").is_err());
        s2.open(&file, KEY).unwrap();
    }

    #[test]
    fn exec_many_commits_together_and_rolls_back_on_error() {
        let d = tmp("em");
        let s = Store::new();
        s.open(&d.join("a.db"), KEY).unwrap();
        s.batch("create table t(a primary key)").unwrap();
        let ins = |a: &str| ("insert into t values (?)".to_string(), vec![json!(a)]);
        assert_eq!(s.exec_many(&[ins("x"), ins("y")]).unwrap(), vec![1, 1]);
        assert!(s.exec_many(&[ins("z"), ins("x")]).is_err());
        assert_eq!(s.query("select a from t", &[]).unwrap().len(), 2);
    }

    #[test]
    fn close_locks_the_store() {
        let d = tmp("cl");
        let s = Store::new();
        s.open(&d.join("a.db"), KEY).unwrap();
        s.batch("create table t(a)").unwrap();
        s.close();
        assert_eq!(s.query("select 1", &[]).unwrap_err(), "locked");
        s.open(&d.join("a.db"), KEY).unwrap();
        assert!(s.query("select * from t", &[]).is_ok());
    }

    #[test]
    fn dev_key_is_stable() {
        let d = tmp("dk");
        let a = dev_key(&d).unwrap();
        assert_eq!(a.len(), 64);
        assert_eq!(a, dev_key(&d).unwrap());
    }
}
