//! Official OpenAI ChatGPT DMG metadata and download helpers.

use crate::cache_cleanup::{acquire_dmg_cache_lease, DmgCacheLease};
use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use reqwest::{header, redirect, Client, Url};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::{fs::OpenOptions, io::AsyncWriteExt};

const MAX_DMG_BYTES: u64 = 1024 * 1024 * 1024;

const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const HTTP_READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_DMG_REDIRECTS: usize = 10;
const DOWNLOAD_TEMP_PREFIX: &str = ".ChatGPT.dmg.download-";
static DOWNLOAD_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

struct DownloadTempFile {
    path: PathBuf,
}

impl DownloadTempFile {
    fn commit(mut self) {
        self.path = PathBuf::new();
    }
}

impl Drop for DownloadTempFile {
    fn drop(&mut self) {
        if !self.path.as_os_str().is_empty() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
/// Selected HTTP metadata used to detect official DMG changes.
pub struct RemoteMetadata {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_length: Option<u64>,
    pub headers_fingerprint: String,
}

#[derive(Debug)]
/// Result of downloading the current official DMG snapshot.
pub struct DownloadedDmg {
    pub path: PathBuf,
    pub sha256: String,
    pub candidate_version: String,
    pub(crate) lease: DmgCacheLease,
}

/// HTTP client whose redirect behavior preserves the official DMG URL policy.
pub struct DmgHttpClient {
    client: Client,
}

fn validate_dmg_url(dmg_url: &str) -> Result<Url> {
    let safe_url = sanitized_url_for_log(dmg_url);
    let url = Url::parse(dmg_url).with_context(|| format!("Invalid DMG URL: {safe_url}"))?;
    if url.host_str().is_none() {
        return Err(anyhow!("DMG URL must include a host"));
    }
    let is_loopback_http = url.scheme() == "http"
        && url
            .host_str()
            .is_some_and(|host| host == "localhost" || host == "127.0.0.1" || host == "::1");
    if url.scheme() != "https" && !is_loopback_http {
        return Err(anyhow!(
            "DMG URL must use https unless it targets loopback http"
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(anyhow!("DMG URL must not contain embedded credentials"));
    }
    Ok(url)
}

fn sanitized_url_for_log(dmg_url: &str) -> String {
    match Url::parse(dmg_url) {
        Ok(mut url) => {
            if !url.username().is_empty() || url.password().is_some() {
                let _ = url.set_username("redacted");
                let _ = url.set_password(None);
            }
            url.set_query(None);
            url.set_fragment(None);
            url.to_string()
        }
        Err(_) => "<invalid-url>".to_string(),
    }
}

fn dmg_redirect_policy() -> redirect::Policy {
    redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_DMG_REDIRECTS {
            return attempt.error("too many official DMG redirects");
        }
        match validate_dmg_url(attempt.url().as_str()) {
            Ok(_) => attempt.follow(),
            Err(error) => attempt.error(format!(
                "refusing disallowed official DMG redirect: {error}"
            )),
        }
    })
}

fn validate_final_dmg_url(url: &Url) -> Result<()> {
    validate_dmg_url(url.as_str())
        .map(|_| ())
        .context("Official DMG response URL violated redirect policy")
}

/// Builds the HTTP client shared by official DMG metadata and DMG requests.
pub fn http_client() -> Result<DmgHttpClient> {
    let client = Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .read_timeout(HTTP_READ_TIMEOUT)
        .redirect(dmg_redirect_policy())
        .build()
        .context("Failed to build official DMG HTTP client")?;
    Ok(DmgHttpClient { client })
}

/// Fetches the official DMG headers used to detect candidate updates.
pub async fn fetch_remote_metadata(
    client: &DmgHttpClient,
    dmg_url: &str,
) -> Result<RemoteMetadata> {
    let url = validate_dmg_url(dmg_url)?;
    let safe_url = sanitized_url_for_log(dmg_url);
    let response = client
        .client
        .head(url)
        .send()
        .await
        .with_context(|| format!("Failed HEAD request for {safe_url}"))?
        .error_for_status()
        .with_context(|| format!("HEAD request for {safe_url} returned an error status"))?;
    validate_final_dmg_url(response.url())?;

    let etag = response
        .headers()
        .get(header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let last_modified = response
        .headers()
        .get(header::LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let content_length = response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());

    let headers_fingerprint = format!(
        "etag={}|last_modified={}|content_length={}",
        etag.as_deref().unwrap_or(""),
        last_modified.as_deref().unwrap_or(""),
        content_length
            .map(|value| value.to_string())
            .as_deref()
            .unwrap_or("")
    );

    Ok(RemoteMetadata {
        etag,
        last_modified,
        content_length,
        headers_fingerprint,
    })
}

/// Downloads the official DMG and derives a package version from its hash.
pub async fn download_dmg(
    client: &DmgHttpClient,
    dmg_url: &str,
    destination_dir: &Path,
    version_timestamp: DateTime<Utc>,
) -> Result<DownloadedDmg> {
    download_dmg_with_limit(
        client,
        dmg_url,
        destination_dir,
        version_timestamp,
        MAX_DMG_BYTES,
    )
    .await
}

async fn download_dmg_with_limit(
    client: &DmgHttpClient,
    dmg_url: &str,
    destination_dir: &Path,
    version_timestamp: DateTime<Utc>,
    max_dmg_bytes: u64,
) -> Result<DownloadedDmg> {
    let url = validate_dmg_url(dmg_url)?;
    let safe_url = sanitized_url_for_log(dmg_url);
    tokio::fs::create_dir_all(destination_dir)
        .await
        .with_context(|| format!("Failed to create {}", destination_dir.display()))?;
    // Hold one updater-wide lease from the first temporary write until the
    // caller finishes consuming the published DMG and persists its state path.
    let lease = acquire_dmg_cache_lease(destination_dir).await?;

    let response = client
        .client
        .get(url)
        .send()
        .await
        .with_context(|| format!("Failed GET request for {safe_url}"))?
        .error_for_status()
        .with_context(|| format!("GET request for {safe_url} returned an error status"))?;
    validate_final_dmg_url(response.url())?;
    let content_length = response
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| response.content_length());
    if let Some(content_length) = content_length {
        if content_length > max_dmg_bytes {
            return Err(anyhow!(
                "DMG response for {safe_url} is too large: {content_length} bytes exceeds {max_dmg_bytes}"
            ));
        }
    }

    let (temp, mut file) = create_download_temp(destination_dir).await?;
    let mut downloaded_bytes = 0_u64;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.with_context(|| format!("Failed downloading {safe_url}"))?;
        downloaded_bytes = downloaded_bytes
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| anyhow!("DMG download byte count overflowed"))?;
        if downloaded_bytes > max_dmg_bytes {
            return Err(anyhow!(
                "DMG response for {safe_url} exceeded {max_dmg_bytes} bytes while downloading"
            ));
        }
        file.write_all(&chunk)
            .await
            .with_context(|| format!("Failed writing {}", temp.path.display()))?;
        hasher.update(&chunk);
    }

    file.flush()
        .await
        .with_context(|| format!("Failed flushing {}", temp.path.display()))?;
    file.sync_all()
        .await
        .with_context(|| format!("Failed syncing {}", temp.path.display()))?;
    drop(file);

    let sha256 = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let candidate_version = derive_candidate_version(&sha256, version_timestamp)?;
    let destination = destination_dir.join(format!("ChatGPT-{sha256}.dmg"));

    // A content-addressed destination remains stable while either updater path
    // consumes it. Concurrent downloads can publish the same bytes safely and
    // different official snapshots never overwrite one another.
    tokio::fs::rename(&temp.path, &destination)
        .await
        .with_context(|| {
            format!(
                "Failed to atomically publish completed DMG as {}",
                destination.display()
            )
        })?;
    sync_parent_directory(destination_dir)?;
    temp.commit();

    Ok(DownloadedDmg {
        path: destination,
        sha256,
        candidate_version,
        lease,
    })
}

async fn create_download_temp(
    destination_dir: &Path,
) -> Result<(DownloadTempFile, tokio::fs::File)> {
    loop {
        let id = DOWNLOAD_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = destination_dir.join(format!(
            "{DOWNLOAD_TEMP_PREFIX}{}-{id}.tmp",
            std::process::id()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(file) => return Ok((DownloadTempFile { path }, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).with_context(|| format!("Failed to create {}", path.display()))
            }
        }
    }
}

fn sync_parent_directory(directory: &Path) -> Result<()> {
    std::fs::File::open(directory)
        .with_context(|| format!("Failed to open {} for sync", directory.display()))?
        .sync_all()
        .with_context(|| format!("Failed to sync {}", directory.display()))
}

/// Derives a local package version from the DMG hash and download timestamp.
pub fn derive_candidate_version(sha256: &str, timestamp: DateTime<Utc>) -> Result<String> {
    let short_hash = sha256
        .get(0..8)
        .ok_or_else(|| anyhow!("sha256 is too short to derive candidate version"))?;
    Ok(format!(
        "{}+{}",
        timestamp.format("%Y.%m.%d.%H%M%S"),
        short_hash
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use chrono::TimeZone;
    use tempfile::tempdir;
    use wiremock::{
        matchers::{method, path},
        Mock, MockServer, ResponseTemplate,
    };

    #[tokio::test]
    async fn fetches_remote_metadata_from_head() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("HEAD"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(
                ResponseTemplate::new(200)
                    .insert_header("ETag", "\"abc\"")
                    .insert_header("Last-Modified", "Tue, 25 Mar 2026 00:00:00 GMT")
                    .insert_header("Content-Length", "42"),
            )
            .mount(&server)
            .await;

        let client = http_client()?;
        let metadata =
            fetch_remote_metadata(&client, &format!("{}/ChatGPT.dmg", server.uri())).await?;
        assert_eq!(metadata.etag.as_deref(), Some("\"abc\""));
        assert_eq!(
            metadata.last_modified.as_deref(),
            Some("Tue, 25 Mar 2026 00:00:00 GMT")
        );
        assert_eq!(metadata.content_length, Some(42));
        assert!(metadata.headers_fingerprint.contains("etag=\"abc\""));
        Ok(())
    }

    #[tokio::test]
    async fn rejects_disallowed_redirect_before_contacting_target() -> Result<()> {
        let origin = MockServer::start().await;
        let target = MockServer::start().await;
        let disallowed_target = target.uri().replace("127.0.0.1", "0.0.0.0");

        Mock::given(method("HEAD"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("Location", format!("{disallowed_target}/metadata")),
            )
            .mount(&origin)
            .await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("Location", format!("{disallowed_target}/download")),
            )
            .mount(&origin)
            .await;

        let client = http_client()?;
        let source_url = format!("{}/ChatGPT.dmg", origin.uri());
        fetch_remote_metadata(&client, &source_url)
            .await
            .expect_err("metadata redirect outside the DMG URL policy must fail");

        let temp = tempdir()?;
        download_dmg(&client, &source_url, temp.path(), Utc::now())
            .await
            .expect_err("download redirect outside the DMG URL policy must fail");

        assert!(
            target
                .received_requests()
                .await
                .unwrap_or_default()
                .is_empty(),
            "the HTTP client must reject a disallowed redirect before contacting its target"
        );
        Ok(())
    }

    #[tokio::test]
    async fn downloads_dmg_and_hashes_contents() -> Result<()> {
        let server = MockServer::start().await;
        let body = b"chatgpt-dmg-test-payload";
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body.to_vec()))
            .mount(&server)
            .await;

        let client = http_client()?;
        let temp = tempdir()?;
        let downloaded = download_dmg(
            &client,
            &format!("{}/ChatGPT.dmg", server.uri()),
            temp.path(),
            Utc.with_ymd_and_hms(2026, 3, 24, 12, 0, 0).unwrap(),
        )
        .await?;

        assert_eq!(
            downloaded.sha256,
            "ec144b61fa5733da601b13f837f4b184d9bdad2e6f2d59f23b46dcefcfb4a118"
        );
        assert_eq!(
            downloaded.path,
            temp.path()
                .join(format!("ChatGPT-{}.dmg", downloaded.sha256))
        );
        assert_eq!(downloaded.candidate_version, "2026.03.24.120000+ec144b61");
        assert_eq!(std::fs::read(&downloaded.path)?, body);
        assert_no_download_temps(temp.path())?;
        Ok(())
    }

    #[tokio::test]
    async fn failed_download_does_not_publish_or_leave_temps() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;

        let temp = tempdir()?;
        let result = download_dmg(
            &http_client()?,
            &format!("{}/ChatGPT.dmg", server.uri()),
            temp.path(),
            Utc::now(),
        )
        .await;

        assert!(result.is_err());
        assert!(std::fs::read_dir(temp.path())?.all(|entry| {
            entry
                .map(|entry| entry.file_name() == crate::cache_cleanup::DMG_CACHE_LOCK_NAME)
                .unwrap_or(false)
        }));
        assert_no_download_temps(temp.path())?;
        Ok(())
    }

    #[tokio::test]
    async fn concurrent_different_downloads_publish_immutable_paths() -> Result<()> {
        let first_server = MockServer::start().await;
        let second_server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"first".to_vec()))
            .mount(&first_server)
            .await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"second".to_vec()))
            .mount(&second_server)
            .await;

        let temp = tempdir()?;
        let client = http_client()?;
        let first_url = format!("{}/ChatGPT.dmg", first_server.uri());
        let second_url = format!("{}/ChatGPT.dmg", second_server.uri());
        let (first, second) = tokio::join!(
            download_dmg(&client, &first_url, temp.path(), Utc::now(),),
            download_dmg(&client, &second_url, temp.path(), Utc::now(),)
        );
        let first = first?;
        let second = second?;

        assert_ne!(first.path, second.path);
        assert_eq!(std::fs::read(first.path)?, b"first");
        assert_eq!(std::fs::read(second.path)?, b"second");
        assert_no_download_temps(temp.path())?;
        Ok(())
    }

    fn assert_no_download_temps(directory: &Path) -> Result<()> {
        let leftovers = std::fs::read_dir(directory)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(DOWNLOAD_TEMP_PREFIX)
            })
            .collect::<Vec<_>>();
        assert!(leftovers.is_empty(), "temporary downloads remain");
        Ok(())
    }

    #[tokio::test]
    async fn rejects_dmg_that_exceeds_content_length_limit() -> Result<()> {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/ChatGPT.dmg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![b'x'; 9]))
            .mount(&server)
            .await;

        let temp = tempdir()?;
        let error = download_dmg_with_limit(
            &http_client()?,
            &format!("{}/ChatGPT.dmg", server.uri()),
            temp.path(),
            Utc.with_ymd_and_hms(2026, 3, 24, 12, 0, 0).unwrap(),
            8,
        )
        .await
        .expect_err("oversized DMG should fail");

        assert!(error.to_string().contains("too large"));
        assert_no_download_temps(temp.path())?;
        Ok(())
    }

    #[test]
    fn sanitizes_dmg_urls_for_logs() {
        assert_eq!(
            sanitized_url_for_log("https://example.com/ChatGPT.dmg?token=secret#frag"),
            "https://example.com/ChatGPT.dmg"
        );
        assert_eq!(
            sanitized_url_for_log("https://user:secret@example.com/ChatGPT.dmg"),
            "https://redacted@example.com/ChatGPT.dmg"
        );
    }

    #[test]
    fn rejects_non_https_non_loopback_dmg_urls() {
        assert!(validate_dmg_url("http://example.com/ChatGPT.dmg").is_err());
        assert!(validate_dmg_url("https://user:pass@example.com/ChatGPT.dmg").is_err());
        assert!(validate_dmg_url("https://").is_err());
        assert!(validate_dmg_url("http://127.0.0.1/ChatGPT.dmg").is_ok());
    }

    #[test]
    fn derive_candidate_version_rejects_short_hashes() {
        let error = derive_candidate_version("short", Utc::now()).expect_err("hash should fail");
        assert!(error.to_string().contains("sha256 is too short"));
    }
}
