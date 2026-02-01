use crate::llm::types::CustomProvidersConfiguration;
use crate::llm::types::{AuthType, ModelsConfiguration, ProviderConfig};
use reqwest::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::{Mutex, RwLock};

use crate::database::Database;

const MODELS_CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes

const SETTINGS_SELECT: &str = "SELECT value FROM settings WHERE key = $1";
const CUSTOM_PROVIDERS_FILENAME: &str = "custom-providers.json";

const GITHUB_COPILOT_ACCESS_TOKEN_KEY: &str = "github_copilot_oauth_access_token";
const GITHUB_COPILOT_COPILOT_TOKEN_KEY: &str = "github_copilot_oauth_copilot_token";
const GITHUB_COPILOT_EXPIRES_AT_KEY: &str = "github_copilot_oauth_expires_at";
const GITHUB_COPILOT_ENTERPRISE_URL_KEY: &str = "github_copilot_oauth_enterprise_url";
const GITHUB_COPILOT_USER_AGENT: &str = "GitHubCopilotChat/0.35.0";
const GITHUB_COPILOT_EDITOR_VERSION: &str = "vscode/1.105.1";
const GITHUB_COPILOT_PLUGIN_VERSION: &str = "copilot-chat/0.35.0";
const GITHUB_COPILOT_INTEGRATION_ID: &str = "vscode-chat";
const GITHUB_COPILOT_TOKEN_BUFFER_SECONDS: i64 = 60;

pub struct ApiKeyManager {
    db: Arc<Database>,
    app_data_dir: PathBuf,
    models_cache: RwLock<Option<(ModelsConfiguration, Instant)>>,
}

impl Clone for ApiKeyManager {
    fn clone(&self) -> Self {
        Self {
            db: self.db.clone(),
            app_data_dir: self.app_data_dir.clone(),
            models_cache: RwLock::new(None),
        }
    }
}

impl ApiKeyManager {
    pub fn new(db: Arc<Database>, app_data_dir: PathBuf) -> Self {
        Self {
            db,
            app_data_dir,
            models_cache: RwLock::new(None),
        }
    }

    /// Load models configuration with caching (5 minutes TTL)
    pub async fn load_models_config(&self) -> Result<ModelsConfiguration, String> {
        // Check cache first
        {
            let cache = self.models_cache.read().await;
            if let Some((config, timestamp)) = cache.as_ref() {
                if timestamp.elapsed() < MODELS_CACHE_TTL {
                    return Ok(config.clone());
                }
            }
        }

        // Cache miss or expired - load from database or default
        let config = self.load_models_config_from_source().await?;

        // Update cache
        let mut cache = self.models_cache.write().await;
        *cache = Some((config.clone(), Instant::now()));

        Ok(config)
    }

    async fn load_models_config_from_source(&self) -> Result<ModelsConfiguration, String> {
        if let Some(raw) = self.get_setting("models_config_json").await? {
            let parsed: ModelsConfiguration = serde_json::from_str(&raw)
                .map_err(|e| format!("Failed to parse models config: {}", e))?;
            return Ok(parsed);
        }

        let default_config =
            include_str!("../../../../packages/shared/src/data/models-config.json");
        let parsed: ModelsConfiguration = serde_json::from_str(default_config)
            .map_err(|e| format!("Failed to parse bundled models config: {}", e))?;
        Ok(parsed)
    }

    /// Clear the models configuration cache
    pub async fn clear_models_cache(&self) {
        let mut cache = self.models_cache.write().await;
        *cache = None;
    }

    fn custom_providers_path(&self) -> PathBuf {
        self.app_data_dir.join(CUSTOM_PROVIDERS_FILENAME)
    }

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let result = self
            .db
            .query(SETTINGS_SELECT, vec![Value::String(key.to_string())])
            .await?;
        if result.rows.is_empty() {
            return Ok(None);
        }
        Ok(result.rows[0]
            .get("value")
            .and_then(|v| v.as_str())
            .map(|v| v.to_string()))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp_millis();
        self.db
            .execute(
                "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ($1, $2, $3)",
                vec![
                    Value::String(key.to_string()),
                    Value::String(value.to_string()),
                    Value::Number(now.into()),
                ],
            )
            .await?;
        Ok(())
    }

    pub async fn load_api_keys(&self) -> Result<HashMap<String, String>, String> {
        let mut api_keys = HashMap::new();
        let keys = self
            .db
            .query(
                "SELECT key, value FROM settings WHERE key LIKE 'api_key_%'",
                vec![],
            )
            .await?;

        for row in keys.rows {
            if let (Some(key), Some(value)) = (row.get("key"), row.get("value")) {
                let key_str = key.as_str().unwrap_or_default();
                let value_str = value.as_str().unwrap_or_default();
                if let Some(provider_id) = key_str.strip_prefix("api_key_") {
                    if !value_str.is_empty() {
                        api_keys.insert(provider_id.to_string(), value_str.to_string());
                    }
                }
            }
        }

        Ok(api_keys)
    }

    pub async fn load_custom_providers(&self) -> Result<CustomProvidersConfiguration, String> {
        let path = self.custom_providers_path();

        // Check if file exists
        if !path.exists() {
            return Ok(CustomProvidersConfiguration {
                version: chrono::Utc::now().to_rfc3339(),
                providers: HashMap::new(),
            });
        }

        // Read file content
        let content = tokio::fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read custom providers file: {}", e))?;

        if content.trim().is_empty() {
            return Ok(CustomProvidersConfiguration {
                version: chrono::Utc::now().to_rfc3339(),
                providers: HashMap::new(),
            });
        }

        // Parse JSON
        let parsed: CustomProvidersConfiguration = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse custom providers: {}", e))?;

        Ok(parsed)
    }

    pub async fn save_custom_providers(
        &self,
        config: &CustomProvidersConfiguration,
    ) -> Result<(), String> {
        let path = self.custom_providers_path();

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| format!("Failed to create directory for custom providers: {}", e))?;
        }

        // Serialize and write to file
        let raw = serde_json::to_string_pretty(config)
            .map_err(|e| format!("Failed to serialize custom providers: {}", e))?;

        tokio::fs::write(&path, raw)
            .await
            .map_err(|e| format!("Failed to write custom providers file: {}", e))?;

        // Clear models cache since custom providers changed
        self.clear_models_cache().await;

        Ok(())
    }

    pub async fn get_credentials(
        &self,
        provider: &ProviderConfig,
    ) -> Result<ProviderCredentials, String> {
        match provider.auth_type {
            AuthType::None => Ok(ProviderCredentials::None),
            AuthType::TalkCodyJwt => {
                let token = self
                    .get_setting("talkcody_auth_token")
                    .await?
                    .unwrap_or_default();
                if token.is_empty() {
                    return Err(
                        "Authentication required. Please sign in to use TalkCody Free.".to_string(),
                    );
                }
                Ok(ProviderCredentials::Token(token))
            }
            AuthType::Bearer | AuthType::ApiKey | AuthType::OAuthBearer => {
                if provider.supports_oauth {
                    if let Some(token) = self.get_oauth_token(&provider.id).await? {
                        if !token.trim().is_empty() {
                            return Ok(ProviderCredentials::Token(token));
                        }
                    }
                }

                let api_key = self
                    .get_setting(&format!("api_key_{}", provider.id))
                    .await?
                    .unwrap_or_default();
                if !api_key.is_empty() {
                    return Ok(ProviderCredentials::Token(api_key));
                }

                Err(format!(
                    "API key not configured for provider {}",
                    provider.id
                ))
            }
        }
    }

    async fn get_oauth_token(&self, provider_id: &str) -> Result<Option<String>, String> {
        match provider_id {
            "openai" => self.get_setting("openai_oauth_access_token").await,
            "anthropic" => self.get_setting("claude_oauth_access_token").await,
            "github_copilot" => self
                .get_valid_github_copilot_token()
                .await
                .map(Some)
                .or_else(|_| self.get_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY).await),
            "qwen_code" => Ok(None),
            _ => Ok(None),
        }
    }

    async fn get_valid_github_copilot_token(&self) -> Result<String, String> {
        let access_token = self
            .get_setting(GITHUB_COPILOT_ACCESS_TOKEN_KEY)
            .await?
            .unwrap_or_default();
        if access_token.trim().is_empty() {
            return Err("Missing GitHub Copilot OAuth access token".to_string());
        }

        let expires_at_ms = self
            .get_setting(GITHUB_COPILOT_EXPIRES_AT_KEY)
            .await?
            .and_then(|value| value.parse::<i64>().ok());

        if let Some(expires_at_ms) = expires_at_ms {
            let now_ms = chrono::Utc::now().timestamp_millis();
            if now_ms + (GITHUB_COPILOT_TOKEN_BUFFER_SECONDS * 1000) < expires_at_ms {
                if let Some(cached) = self.get_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY).await? {
                    if !cached.trim().is_empty() {
                        return Ok(cached);
                    }
                }
            }
        }

        let enterprise_url = self
            .get_setting(GITHUB_COPILOT_ENTERPRISE_URL_KEY)
            .await?
            .filter(|value| !value.trim().is_empty());

        let client = Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        let base_domain = enterprise_url
            .as_deref()
            .map(normalize_domain)
            .unwrap_or_else(|| "github.com".to_string());
        let token_url = format!("https://api.{}/copilot_internal/v2/token", base_domain);

        let response = client
            .get(&token_url)
            .header("Accept", "application/json")
            .header("Authorization", format!("Bearer {}", access_token))
            .header("User-Agent", GITHUB_COPILOT_USER_AGENT)
            .header("Editor-Version", GITHUB_COPILOT_EDITOR_VERSION)
            .header("Editor-Plugin-Version", GITHUB_COPILOT_PLUGIN_VERSION)
            .header("Copilot-Integration-Id", GITHUB_COPILOT_INTEGRATION_ID)
            .send()
            .await
            .map_err(|e| format!("GitHub Copilot token request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!(
                "GitHub Copilot token refresh failed ({}): {}",
                status, text
            ));
        }

        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Copilot token response: {}", e))?;
        let token = payload
            .get("token")
            .and_then(|value| value.as_str())
            .ok_or("Missing Copilot token in response")?
            .to_string();
        let expires_at = payload
            .get("expires_at")
            .and_then(|value| value.as_i64())
            .ok_or("Missing Copilot expires_at in response")?;

        let expires_at_ms = expires_at * 1000;

        self.set_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY, &token)
            .await?;
        self.set_setting(GITHUB_COPILOT_EXPIRES_AT_KEY, &expires_at_ms.to_string())
            .await?;

        Ok(token)
    }

    pub async fn has_oauth_token(&self, provider_id: &str) -> Result<bool, String> {
        Ok(self
            .get_oauth_token(provider_id)
            .await?
            .map(|token| !token.trim().is_empty())
            .unwrap_or(false))
    }

    pub async fn maybe_set_openai_account_header(
        &self,
        provider_id: &str,
        headers: &mut HashMap<String, String>,
    ) -> Result<(), String> {
        if provider_id != "openai" {
            return Ok(());
        }
        if let Some(account_id) = self.get_setting("openai_oauth_account_id").await? {
            if !account_id.trim().is_empty() {
                headers.insert("chatgpt-account-id".to_string(), account_id);
            }
        }
        Ok(())
    }

    pub async fn load_oauth_tokens(&self) -> Result<HashMap<String, String>, String> {
        let mut tokens = HashMap::new();
        if let Some(token) = self.get_setting("openai_oauth_access_token").await? {
            if !token.trim().is_empty() {
                tokens.insert("openai".to_string(), token);
            }
        }
        if let Some(token) = self.get_setting("claude_oauth_access_token").await? {
            if !token.trim().is_empty() {
                tokens.insert("anthropic".to_string(), token);
            }
        }
        if let Some(token) = self.get_valid_github_copilot_token().await.ok() {
            if !token.trim().is_empty() {
                tokens.insert("github_copilot".to_string(), token);
            }
        } else if let Some(token) = self.get_setting(GITHUB_COPILOT_COPILOT_TOKEN_KEY).await? {
            if !token.trim().is_empty() {
                tokens.insert("github_copilot".to_string(), token);
            }
        }
        Ok(tokens)
    }
}

#[derive(Debug)]
pub enum ProviderCredentials {
    None,
    Token(String),
}

pub struct LlmState {
    pub registry: Mutex<crate::llm::providers::provider_registry::ProviderRegistry>,
    pub api_keys: Mutex<ApiKeyManager>,
}

impl LlmState {
    pub fn new(db: Arc<Database>, app_data_dir: PathBuf, providers: Vec<ProviderConfig>) -> Self {
        Self {
            registry: Mutex::new(
                crate::llm::providers::provider_registry::ProviderRegistry::new(providers),
            ),
            api_keys: Mutex::new(ApiKeyManager::new(db, app_data_dir)),
        }
    }
}

#[tauri::command]
pub async fn llm_set_setting(
    key: String,
    value: String,
    state: State<'_, LlmState>,
) -> Result<(), String> {
    let api_keys = state.api_keys.lock().await;
    api_keys.set_setting(&key, &value).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::llm::types::ProtocolType;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tempfile::TempDir;

    struct TestContext {
        _dir: TempDir,
        api_keys: ApiKeyManager,
    }

    async fn setup() -> TestContext {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("llm-settings.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect().await.expect("db connect");
        db.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)",
            vec![],
        )
        .await
        .expect("create settings");
        TestContext {
            _dir: dir,
            api_keys: ApiKeyManager::new(db, std::path::PathBuf::from("/tmp")),
        }
    }

    #[tokio::test]
    async fn load_models_config_uses_cache() {
        let ctx = setup().await;

        // First call - should load from source and populate cache
        let config1 = ctx
            .api_keys
            .load_models_config()
            .await
            .expect("load config");

        // Second call - should return cached version
        let config2 = ctx
            .api_keys
            .load_models_config()
            .await
            .expect("load config from cache");

        assert_eq!(config1.version, config2.version);

        // Clear cache and verify it loads again
        ctx.api_keys.clear_models_cache().await;

        // After clearing cache, should load from source again
        let config3 = ctx
            .api_keys
            .load_models_config()
            .await
            .expect("load config after clear");

        assert_eq!(config1.version, config3.version);
    }

    fn provider_config(id: &str, auth_type: AuthType, supports_oauth: bool) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: "Test".to_string(),
            protocol: ProtocolType::OpenAiCompatible,
            base_url: "https://example.com".to_string(),
            api_key_name: "TEST_API_KEY".to_string(),
            supports_oauth,
            supports_coding_plan: false,
            supports_international: false,
            coding_plan_base_url: None,
            international_base_url: None,
            headers: None,
            extra_body: None,
            auth_type,
        }
    }

    #[tokio::test]
    async fn get_credentials_rejects_missing_talkcody_jwt() {
        let ctx = setup().await;
        let provider = provider_config("talkcody", AuthType::TalkCodyJwt, false);
        let result = ctx.api_keys.get_credentials(&provider).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Authentication required"));
    }

    #[tokio::test]
    async fn get_credentials_accepts_talkcody_jwt() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("talkcody_auth_token", "token")
            .await
            .expect("set token");
        let provider = provider_config("talkcody", AuthType::TalkCodyJwt, false);
        let result = ctx.api_keys.get_credentials(&provider).await;
        match result {
            Ok(ProviderCredentials::Token(value)) => assert_eq!(value, "token"),
            _ => panic!("Unexpected credentials"),
        }
    }

    #[tokio::test]
    async fn get_credentials_prefers_oauth_token() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("openai_oauth_access_token", "oauth")
            .await
            .expect("set oauth token");
        ctx.api_keys
            .set_setting("api_key_openai", "api")
            .await
            .expect("set api key");
        let provider = provider_config("openai", AuthType::Bearer, true);
        let result = ctx.api_keys.get_credentials(&provider).await;
        match result {
            Ok(ProviderCredentials::Token(value)) => assert_eq!(value, "oauth"),
            _ => panic!("Unexpected credentials"),
        }
    }

    #[tokio::test]
    async fn get_credentials_falls_back_to_api_key() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("api_key_openai", "api")
            .await
            .expect("set api key");
        let provider = provider_config("openai", AuthType::Bearer, true);
        let result = ctx.api_keys.get_credentials(&provider).await;
        match result {
            Ok(ProviderCredentials::Token(value)) => assert_eq!(value, "api"),
            _ => panic!("Unexpected credentials"),
        }
    }

    #[tokio::test]
    async fn get_credentials_none_auth() {
        let ctx = setup().await;
        let provider = provider_config("ollama", AuthType::None, false);
        let result = ctx.api_keys.get_credentials(&provider).await;
        match result {
            Ok(ProviderCredentials::None) => {}
            _ => panic!("Unexpected credentials"),
        }
    }

    #[tokio::test]
    async fn maybe_set_openai_account_header_adds_header() {
        let ctx = setup().await;
        ctx.api_keys
            .set_setting("openai_oauth_account_id", "acct_123")
            .await
            .expect("set account id");
        let mut headers: HashMap<String, String> = HashMap::new();
        ctx.api_keys
            .maybe_set_openai_account_header("openai", &mut headers)
            .await
            .expect("set header");
        assert_eq!(
            headers.get("chatgpt-account-id"),
            Some(&"acct_123".to_string())
        );

        let mut other_headers: HashMap<String, String> = HashMap::new();
        ctx.api_keys
            .maybe_set_openai_account_header("anthropic", &mut other_headers)
            .await
            .expect("no header");
        assert!(other_headers.get("chatgpt-account-id").is_none());
    }
}
