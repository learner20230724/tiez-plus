//! Focused backport of upstream LAN session authorization; no clipboard access.
use axum::{body::Body, extract::State, http::{header, Request, StatusCode}, middleware::Next, response::{IntoResponse, Response}};

pub fn valid_filename(name: &str) -> bool {
    !name.is_empty() && name.len() <= 240 && !name.ends_with(['.', ' '])
        && !name.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c))
        && name != "." && name != ".."
}
pub fn valid_upload_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|b|b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn matches_token(value: &str, expected: &str) -> bool {
    value.len() == expected.len() && !expected.is_empty()
        && value.bytes().zip(expected.bytes()).fold(0u8, |diff,(a,b)| diff | (a ^ b)) == 0
}
fn authorize(request: &Request<Body>, token: &str) -> Result<bool, StatusCode> {
    let headers = request.headers();
    let host = headers.get(header::HOST).and_then(|h|h.to_str().ok()).unwrap_or("");
    if let Some(origin) = headers.get(header::ORIGIN) {
        if origin.to_str().ok() != Some(format!("http://{host}").as_str()) {
            return Err(StatusCode::FORBIDDEN);
        }
    }
    let query_token = request.uri().query().and_then(|q|q.split('&').find_map(|p|p.strip_prefix("auth=")));
    let bearer = headers.get(header::AUTHORIZATION).and_then(|h|h.to_str().ok()).and_then(|h|h.strip_prefix("Bearer "));
    let cookie = headers.get(header::COOKIE).and_then(|h|h.to_str().ok()).and_then(|h|h.split(';').find_map(|p|p.trim().strip_prefix("tiezplus_transfer=")));
    if ![query_token,bearer,cookie].iter().flatten().any(|t|matches_token(t,token)) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(query_token.is_some())
}
pub async fn require_session(State(token): State<String>, request: Request<Body>, next: Next) -> Response {
    let set_cookie = match authorize(&request,&token) {
        Ok(value) => value,
        Err(status) => return (status,"Scan the current TIEZ Plus file-transfer QR code").into_response(),
    };
    let mut response = next.run(request).await;
    response.headers_mut().insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response.headers_mut().insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    response.headers_mut().insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    if set_cookie {
        if let Ok(value) = format!("tiezplus_transfer={}; HttpOnly; SameSite=Strict; Path=/", token).parse() {
            response.headers_mut().insert(header::SET_COOKIE,value);
        }
    }
    response
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn rejects_traversal_and_ntfs_streams() {
        for name in ["../secret","..\\secret","a:b","file\r\n","file.","..", ""] { assert!(!valid_filename(name)); }
        assert!(valid_filename("中文 文件.png"));
        assert!(valid_upload_id("phone-012_34")); assert!(!valid_upload_id("../tmp"));
    }
    #[test] fn session_authentication_origin_and_rotation() {
        let req = |uri:&str| Request::builder().uri(uri).header("Host","192.168.1.2:18085").body(Body::empty()).unwrap();
        assert_eq!(authorize(&req("/poll"),"secret"),Err(StatusCode::UNAUTHORIZED));
        assert_eq!(authorize(&req("/?auth=secret"),"secret"),Ok(true));
        assert_eq!(authorize(&req("/?auth=secret"),"new-secret"),Err(StatusCode::UNAUTHORIZED));
        let mut browser=req("/?auth=secret"); browser.headers_mut().insert(header::ORIGIN,"https://untrusted.invalid".parse().unwrap());
        assert_eq!(authorize(&browser,"secret"),Err(StatusCode::FORBIDDEN));
        let mut native=req("/poll"); native.headers_mut().insert(header::AUTHORIZATION,"Bearer secret".parse().unwrap());
        assert_eq!(authorize(&native,"secret"),Ok(false));
        assert!(!matches_token("秘密", "secret"));
    }
}
