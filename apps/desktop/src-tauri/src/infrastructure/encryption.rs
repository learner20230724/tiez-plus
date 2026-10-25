use base64::Engine;

#[cfg(windows)]
use std::ffi::c_void;

#[cfg(windows)]
type BOOL = i32;
#[cfg(windows)]
type DWORD = u32;

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct DATA_BLOB {
    cbData: DWORD,
    pbData: *mut u8,
}

#[cfg(windows)]
const CRYPTPROTECT_UI_FORBIDDEN: DWORD = 0x1;

#[cfg(windows)]
#[link(name = "crypt32")]
extern "system" {
    fn CryptProtectData(
        p_data_in: *mut DATA_BLOB,
        sz_data_descr: *const u16,
        p_optional_entropy: *mut DATA_BLOB,
        pv_reserved: *mut c_void,
        p_prompt_struct: *mut c_void,
        dw_flags: DWORD,
        p_data_out: *mut DATA_BLOB,
    ) -> BOOL;

    fn CryptUnprotectData(
        p_data_in: *mut DATA_BLOB,
        ppsz_data_descr: *mut *mut u16,
        p_optional_entropy: *mut DATA_BLOB,
        pv_reserved: *mut c_void,
        p_prompt_struct: *mut c_void,
        dw_flags: DWORD,
        p_data_out: *mut DATA_BLOB,
    ) -> BOOL;
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn LocalFree(hmem: *mut c_void) -> *mut c_void;
}

#[cfg(not(target_os = "macos"))]
pub const ENCRYPT_PREFIX: &str = "dpapi:";
#[cfg(target_os = "macos")]
pub const ENCRYPT_PREFIX: &str = "keychain-aesgcm:";

#[cfg(windows)]
pub fn encrypt_value(plain: &str) -> Option<String> {
    let bytes = plain.as_bytes();
    let mut in_blob = DATA_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut out_blob = DATA_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &mut in_blob,
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };
    if ok != 0 {
        let out = unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize) };
        let encoded = base64::engine::general_purpose::STANDARD.encode(out);
        unsafe {
            let _ = LocalFree(out_blob.pbData as _);
        }
        Some(format!("{}{}", ENCRYPT_PREFIX, encoded))
    } else {
        None
    }
}

#[cfg(windows)]
pub fn decrypt_value(cipher: &str) -> Option<String> {
    let payload = cipher.strip_prefix(ENCRYPT_PREFIX)?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .ok()?;
    let mut in_blob = DATA_BLOB {
        cbData: decoded.len() as u32,
        pbData: decoded.as_ptr() as *mut u8,
    };
    let mut out_blob = DATA_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &mut in_blob,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };
    if ok != 0 {
        let out = unsafe { std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize) };
        let result = String::from_utf8(out.to_vec()).ok();
        unsafe {
            let _ = LocalFree(out_blob.pbData as _);
        }
        result
    } else {
        None
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn encrypt_value(plain: &str) -> Option<String> {
    Some(plain.to_string())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn decrypt_value(cipher: &str) -> Option<String> {
    Some(cipher.to_string())
}

#[cfg(target_os = "macos")]
fn mac_key() -> Option<[u8; 32]> {
    use security_framework::passwords::{get_generic_password, set_generic_password};
    use aes_gcm::aead::{OsRng, rand_core::RngCore};
    static KEY: std::sync::Mutex<Option<[u8; 32]>> = std::sync::Mutex::new(None);
    let mut cached = KEY.lock().ok()?;
    if let Some(key) = *cached { return Some(key); }
    let service = "io.github.learner20230724.tiezplus.desktop";
    let account = "local-data-encryption-v1";
    let key = match get_generic_password(service, account) {
        Ok(bytes) => bytes.try_into().ok()?,
        Err(error) if error.code() == -25300 => {
            let mut key = [0u8; 32];
            OsRng.fill_bytes(&mut key);
            set_generic_password(service, account, &key).ok()?;
            key
        }
        Err(_) => return None,
    };
    *cached = Some(key);
    Some(key)
}
#[cfg(target_os = "macos")]
pub fn encrypt_value(plain: &str) -> Option<String> { encrypt_with_key(plain, &mac_key()?) }
#[cfg(target_os = "macos")]
fn encrypt_with_key(plain: &str, key: &[u8; 32]) -> Option<String> {
    use aes_gcm::{Aes256Gcm, KeyInit, aead::{Aead, AeadCore, OsRng}};
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plain.as_bytes()).ok()?;
    let mut payload = nonce.to_vec();
    payload.extend(ciphertext);
    Some(format!("{}{}", ENCRYPT_PREFIX, base64::engine::general_purpose::STANDARD.encode(payload)))
}
#[cfg(target_os = "macos")]
pub fn decrypt_value(ciphertext: &str) -> Option<String> { decrypt_with_key(ciphertext, &mac_key()?) }
#[cfg(target_os = "macos")]
fn decrypt_with_key(ciphertext: &str, key: &[u8; 32]) -> Option<String> {
    use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
    let data = base64::engine::general_purpose::STANDARD.decode(ciphertext.strip_prefix(ENCRYPT_PREFIX)?).ok()?;
    if data.len() < 28 { return None; }
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    String::from_utf8(cipher.decrypt(Nonce::from_slice(&data[..12]), &data[12..]).ok()?).ok()
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    #[test]
    fn mac_cipher_roundtrip_nonce_and_tamper_protection() {
        let key = [7; 32];
        let text = "Mac 测试正文\n🔒";
        let first = encrypt_with_key(text, &key).unwrap();
        let second = encrypt_with_key(text, &key).unwrap();
        assert_ne!(first, second);
        assert!(!first.contains(text));
        assert_eq!(decrypt_with_key(&first, &key).as_deref(), Some(text));
        assert_eq!(decrypt_with_key(&first, &[8; 32]), None);
        let mut raw = base64::engine::general_purpose::STANDARD.decode(first.strip_prefix(ENCRYPT_PREFIX).unwrap()).unwrap();
        raw[12] ^= 1;
        let corrupt = format!("{}{}", ENCRYPT_PREFIX, base64::engine::general_purpose::STANDARD.encode(raw));
        assert_eq!(decrypt_with_key(&corrupt, &key), None);
        assert_eq!(decrypt_with_key("plain text", &key), None);
        assert_eq!(decrypt_with_key("keychain-aesgcm:AA==", &key), None);
    }
}
