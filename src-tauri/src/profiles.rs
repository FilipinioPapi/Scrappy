//! "Who's watching": several people on one device.
//!
//! The person using the app right now is always the sign-ins at the top of the config, exactly
//! as before, so nothing else in the app has to know about people. Everyone who has signed in on
//! this device also has a saved copy here (tokens only, never passwords), and switching swaps
//! which copy sits at the top.

use crate::emby::Config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::hash::{Hash, Hasher};

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub id: String,
    /// Optional lock for this device only: salt and a hash of the PIN. Empty = no PIN.
    pub pin_salt: String,
    pub pin_hash: String,
    // Emby
    pub server: String,
    pub server_name: String,
    pub user_id: String,
    pub user_name: String,
    pub token: String,
    // Navidrome
    pub nd_server: String,
    pub nd_name: String,
    pub nd_user: String,
    pub nd_salt: String,
    pub nd_token: String,
    pub nd_jwt: String,
    // Audiobookshelf
    pub abs_server: String,
    pub abs_name: String,
    pub abs_user: String,
    pub abs_token: String,
}

impl Profile {
    fn signed_in(&self) -> bool {
        (!self.token.is_empty() && !self.user_id.is_empty()) || !self.nd_token.is_empty() || !self.abs_token.is_empty()
    }
    fn name(&self) -> String {
        [&self.user_name, &self.nd_user, &self.abs_user].into_iter().find(|s| !s.is_empty()).cloned().unwrap_or_default()
    }
}

/// A 4 digit PIN only keeps housemates out of each other's profile on this device; it is not a
/// server password and is never sent anywhere. Stored salted and hashed all the same.
fn pin_hash(salt: &str, pin: &str) -> String {
    let mut out = String::new();
    for round in 0..4u8 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        (salt, pin, round, "scrappy-pin").hash(&mut h);
        out.push_str(&format!("{:016x}", h.finish()));
    }
    out
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

impl Config {
    /// Copy the current sign-ins into the current person's saved copy (made if needed). A person
    /// with no sign-ins left is dropped from the list.
    pub fn stash_profile(&mut self) {
        let live = self.logged_in() || self.nd_logged_in() || self.abs_logged_in();
        if !live {
            let id = self.active_profile.clone();
            self.profiles.retain(|p| p.id != id);
            return;
        }
        // Signing in again as someone already on the list (same Emby user) reuses their entry.
        if self.logged_in() {
            let me = self.active_profile.clone();
            if let Some(other) = self.profiles.iter().find(|p| p.id != me && p.user_id == self.user_id && p.server == self.server).map(|p| p.id.clone()) {
                self.profiles.retain(|p| p.id != me);
                self.active_profile = other;
            }
        }
        if self.active_profile.is_empty() {
            self.active_profile = new_id();
        }
        let id = self.active_profile.clone();
        if !self.profiles.iter().any(|p| p.id == id) {
            self.profiles.push(Profile { id: id.clone(), ..Default::default() });
        }
        let c = self.clone();
        let p = self.profiles.iter_mut().find(|p| p.id == id).unwrap();
        p.server = c.server;
        p.server_name = c.server_name;
        p.user_id = c.user_id;
        p.user_name = c.user_name;
        p.token = c.token;
        p.nd_server = c.nd_server;
        p.nd_name = c.nd_name;
        p.nd_user = c.nd_user;
        p.nd_salt = c.nd_salt;
        p.nd_token = c.nd_token;
        p.nd_jwt = c.nd_jwt;
        p.abs_server = c.abs_server;
        p.abs_name = c.abs_name;
        p.abs_user = c.abs_user;
        p.abs_token = c.abs_token;
    }

    fn apply_profile(&mut self, p: &Profile) {
        self.active_profile = p.id.clone();
        self.server = p.server.clone();
        self.server_name = p.server_name.clone();
        self.user_id = p.user_id.clone();
        self.user_name = p.user_name.clone();
        self.token = p.token.clone();
        self.nd_server = p.nd_server.clone();
        self.nd_name = p.nd_name.clone();
        self.nd_user = p.nd_user.clone();
        self.nd_salt = p.nd_salt.clone();
        self.nd_token = p.nd_token.clone();
        self.nd_jwt = p.nd_jwt.clone();
        self.abs_server = p.abs_server.clone();
        self.abs_name = p.abs_name.clone();
        self.abs_user = p.abs_user.clone();
        self.abs_token = p.abs_token.clone();
    }

    /// The list for the "Who's watching?" screen. No tokens, no PINs.
    pub fn profiles_json(&mut self) -> Value {
        self.stash_profile();
        let people: Vec<Value> = self
            .profiles
            .iter()
            .filter(|p| p.signed_in())
            .map(|p| {
                json!({
                    "id": p.id, "name": p.name(), "hasPin": !p.pin_hash.is_empty(),
                    "embyServer": if p.token.is_empty() { "" } else { p.server.as_str() }, "embyUserId": p.user_id,
                    "emby": !p.token.is_empty(), "navidrome": !p.nd_token.is_empty(), "audiobookshelf": !p.abs_token.is_empty(),
                })
            })
            .collect();
        json!({ "active": self.active_profile, "people": people })
    }

    /// Switch to a saved person. A person with a PIN needs it, unless it is who is already active.
    pub fn switch_profile(&mut self, id: &str, pin: &str) -> Result<(), String> {
        self.stash_profile();
        let p = self.profiles.iter().find(|p| p.id == id).cloned().ok_or("That person is no longer on this device.")?;
        if !p.pin_hash.is_empty() && p.id != self.active_profile && pin_hash(&p.pin_salt, pin) != p.pin_hash {
            return Err("Wrong PIN.".into());
        }
        self.apply_profile(&p);
        Ok(())
    }

    /// Start adding a person: keep everyone saved, and leave the sign-in screens empty-handed
    /// (server addresses stay filled in, since a household shares its servers).
    pub fn new_profile(&mut self) {
        self.stash_profile();
        self.active_profile = new_id();
        self.user_id.clear();
        self.user_name.clear();
        self.token.clear();
        self.nd_user.clear();
        self.nd_salt.clear();
        self.nd_token.clear();
        self.nd_jwt.clear();
        self.abs_user.clear();
        self.abs_token.clear();
    }

    /// Take a person off this device. Returns their saved copy so the caller can tell the servers
    /// to forget the tokens. If it was the active person, the first person left becomes active.
    pub fn remove_profile(&mut self, id: &str, pin: &str) -> Result<Option<Profile>, String> {
        self.stash_profile();
        let Some(p) = self.profiles.iter().find(|p| p.id == id).cloned() else { return Ok(None) };
        if !p.pin_hash.is_empty() && pin_hash(&p.pin_salt, pin) != p.pin_hash {
            return Err("Wrong PIN.".into());
        }
        self.profiles.retain(|q| q.id != id);
        if self.active_profile == id {
            match self.profiles.iter().find(|q| q.signed_in() && q.pin_hash.is_empty()).or(self.profiles.first()).cloned() {
                Some(next) => self.apply_profile(&next),
                None => {
                    self.active_profile.clear();
                    self.user_id.clear();
                    self.token.clear();
                    self.nd_salt.clear();
                    self.nd_token.clear();
                    self.nd_jwt.clear();
                    self.abs_token.clear();
                }
            }
        }
        Ok(Some(p))
    }

    /// Set, change or remove (empty `pin`) a person's PIN. Changing or removing needs the old one.
    pub fn set_profile_pin(&mut self, id: &str, current: &str, pin: &str) -> Result<(), String> {
        self.stash_profile();
        let p = self.profiles.iter_mut().find(|p| p.id == id).ok_or("That person is no longer on this device.")?;
        if !p.pin_hash.is_empty() && pin_hash(&p.pin_salt, current) != p.pin_hash {
            return Err("Wrong PIN.".into());
        }
        if pin.is_empty() {
            p.pin_salt.clear();
            p.pin_hash.clear();
            return Ok(());
        }
        if pin.len() != 4 || !pin.bytes().all(|b| b.is_ascii_digit()) {
            return Err("A PIN is 4 digits.".into());
        }
        p.pin_salt = new_id();
        p.pin_hash = pin_hash(&p.pin_salt, pin);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signed(c: &mut Config, user: &str) {
        c.server = "https://emby".into();
        c.user_id = format!("id-{user}");
        c.user_name = user.into();
        c.token = format!("tok-{user}");
    }

    #[test]
    fn add_switch_pin_remove() {
        let mut c = Config::default();
        signed(&mut c, "jay");
        c.nd_token = "nd-jay".into();
        c.nd_server = "https://nd".into();
        let v = c.profiles_json();
        assert_eq!(v["people"].as_array().unwrap().len(), 1);
        let jay = c.active_profile.clone();

        // Add a second person: sign-ins are cleared, addresses stay.
        c.new_profile();
        assert!(!c.logged_in() && c.server == "https://emby" && c.nd_token.is_empty());
        signed(&mut c, "kid");
        let v = c.profiles_json();
        assert_eq!(v["people"].as_array().unwrap().len(), 2);
        let kid = c.active_profile.clone();
        assert_ne!(jay, kid);

        // Switch back: everything of the first person returns.
        c.switch_profile(&jay, "").unwrap();
        assert_eq!(c.token, "tok-jay");
        assert_eq!(c.nd_token, "nd-jay");

        // PIN on the second person.
        assert!(c.set_profile_pin(&kid, "", "12").is_err());
        c.set_profile_pin(&kid, "", "1234").unwrap();
        assert!(c.switch_profile(&kid, "0000").is_err());
        assert_eq!(c.token, "tok-jay");
        c.switch_profile(&kid, "1234").unwrap();
        assert_eq!(c.token, "tok-kid");
        assert!(c.nd_token.is_empty());
        assert!(c.set_profile_pin(&kid, "9999", "").is_err());
        c.set_profile_pin(&kid, "1234", "").unwrap();

        // Abandoning "add person" (never signed in) leaves no empty entry behind.
        c.new_profile();
        c.switch_profile(&jay, "").unwrap();
        assert_eq!(c.profiles_json()["people"].as_array().unwrap().len(), 2);

        // Signing in as someone already listed reuses their entry.
        c.new_profile();
        signed(&mut c, "kid");
        c.profiles_json();
        assert_eq!(c.active_profile, kid);
        assert_eq!(c.profiles.len(), 2);

        // Removing the active person falls back to the other.
        c.remove_profile(&kid, "").unwrap();
        assert_eq!(c.token, "tok-jay");
        assert_eq!(c.profiles.len(), 1);

        // Nothing sensitive in the list.
        let s = c.profiles_json().to_string();
        assert!(!s.contains("tok-") && !s.contains("nd-jay"));
    }
}
