//! Agents Repository
//! Handles CRUD operations for agents and agent-session associations in agents.db

use crate::database::Database;
use crate::storage::models::*;
use std::sync::Arc;

/// Repository for agent operations
#[derive(Clone)]
pub struct AgentsRepository {
    db: Arc<Database>,
}

impl AgentsRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    // ============== Agent Operations ==============

    /// Create a new agent
    pub async fn create_agent(&self, agent: &Agent) -> Result<(), String> {
        let sql = r#"
            INSERT INTO agents (id, name, model, system_prompt, tools, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        "#;

        let tools_json = serde_json::to_string(&agent.tools)
            .map_err(|e| format!("Failed to serialize tools: {}", e))?;

        self.db
            .execute(
                sql,
                vec![
                    serde_json::json!(agent.id),
                    serde_json::json!(agent.name),
                    serde_json::json!(agent.model),
                    serde_json::json!(agent.system_prompt),
                    serde_json::json!(tools_json),
                    serde_json::json!(agent.created_at),
                    serde_json::json!(agent.updated_at),
                ],
            )
            .await?;

        Ok(())
    }

    /// Get an agent by ID
    pub async fn get_agent(&self, agent_id: &str) -> Result<Option<Agent>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM agents WHERE id = ?",
                vec![serde_json::json!(agent_id)],
            )
            .await?;

        Ok(result.rows.first().map(row_to_agent))
    }

    /// Get agent by name
    pub async fn get_agent_by_name(&self, name: &str) -> Result<Option<Agent>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM agents WHERE name = ? LIMIT 1",
                vec![serde_json::json!(name)],
            )
            .await?;

        Ok(result.rows.first().map(row_to_agent))
    }

    /// List all agents
    pub async fn list_agents(&self) -> Result<Vec<Agent>, String> {
        let result = self
            .db
            .query("SELECT * FROM agents ORDER BY name ASC", vec![])
            .await?;

        Ok(result.rows.iter().map(row_to_agent).collect())
    }

    /// Update an agent
    pub async fn update_agent(&self, agent_id: &str, updates: AgentUpdates) -> Result<(), String> {
        let updated_at = chrono::Utc::now().timestamp();

        let mut fields = Vec::new();
        let mut params: Vec<serde_json::Value> = vec![];

        if let Some(name) = updates.name {
            fields.push("name = ?");
            params.push(serde_json::json!(name));
        }

        if let Some(model) = updates.model {
            fields.push("model = ?");
            params.push(serde_json::json!(model));
        }

        if let Some(system_prompt) = updates.system_prompt {
            fields.push("system_prompt = ?");
            params.push(serde_json::json!(system_prompt));
        }

        if let Some(tools) = updates.tools {
            let tools_json = serde_json::to_string(&tools)
                .map_err(|e| format!("Failed to serialize tools: {}", e))?;
            fields.push("tools = ?");
            params.push(serde_json::json!(tools_json));
        }

        if fields.is_empty() {
            return Ok(());
        }

        fields.push("updated_at = ?");
        params.push(serde_json::json!(updated_at));
        params.push(serde_json::json!(agent_id));

        let sql = format!("UPDATE agents SET {} WHERE id = ?", fields.join(", "));

        self.db.execute(&sql, params).await?;
        Ok(())
    }

    /// Delete an agent
    pub async fn delete_agent(&self, agent_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM agents WHERE id = ?",
                vec![serde_json::json!(agent_id)],
            )
            .await?;
        Ok(())
    }

    // ============== Agent Session Operations ==============

    /// Associate an agent with a session
    pub async fn create_agent_session(&self, agent_session: &AgentSession) -> Result<(), String> {
        let settings_json = serde_json::to_string(&agent_session.settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;

        let sql = r#"
            INSERT OR REPLACE INTO agent_sessions (agent_id, session_id, settings, created_at)
            VALUES (?, ?, ?, ?)
        "#;

        self.db
            .execute(
                sql,
                vec![
                    serde_json::json!(agent_session.agent_id),
                    serde_json::json!(agent_session.session_id),
                    serde_json::json!(settings_json),
                    serde_json::json!(agent_session.created_at),
                ],
            )
            .await?;

        Ok(())
    }

    /// Get agent-session association
    pub async fn get_agent_session(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentSession>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM agent_sessions WHERE session_id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;

        Ok(result.rows.first().map(row_to_agent_session))
    }

    /// Get all sessions for an agent
    pub async fn get_agent_sessions(&self, agent_id: &str) -> Result<Vec<AgentSession>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM agent_sessions WHERE agent_id = ? ORDER BY created_at DESC",
                vec![serde_json::json!(agent_id)],
            )
            .await?;

        Ok(result.rows.iter().map(row_to_agent_session).collect())
    }

    /// Update agent session settings
    pub async fn update_agent_session_settings(
        &self,
        session_id: &str,
        settings: &TaskSettings,
    ) -> Result<(), String> {
        let settings_json = serde_json::to_string(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;

        self.db
            .execute(
                "UPDATE agent_sessions SET settings = ? WHERE session_id = ?",
                vec![
                    serde_json::json!(settings_json),
                    serde_json::json!(session_id),
                ],
            )
            .await?;

        Ok(())
    }

    /// Delete agent session association
    pub async fn delete_agent_session(&self, session_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM agent_sessions WHERE session_id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;
        Ok(())
    }
}

/// Updates for an agent (all fields optional)
#[derive(Debug, Default)]
pub struct AgentUpdates {
    pub name: Option<String>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub tools: Option<Vec<String>>,
}

// ============== Row Conversions ==============

fn row_to_agent(row: &serde_json::Value) -> Agent {
    let tools: Vec<String> = row
        .get("tools")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    Agent {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        name: row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        model: row
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        system_prompt: row
            .get("system_prompt")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        tools,
        created_at: row.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0),
        updated_at: row.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0),
    }
}

fn row_to_agent_session(row: &serde_json::Value) -> AgentSession {
    let settings: TaskSettings = row
        .get("settings")
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    AgentSession {
        agent_id: row
            .get("agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        session_id: row
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        settings,
        created_at: row.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use tempfile::TempDir;

    async fn create_test_db() -> (Arc<Database>, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect()
            .await
            .expect("Failed to connect to test database");

        // Run migrations
        let migrations = super::super::migrations::agents_migrations();
        let runner = super::super::migrations::MigrationRunner::new(&db, &migrations);
        runner.init().await.expect("Failed to init migrations");
        runner.migrate().await.expect("Failed to run migrations");

        (db, temp_dir)
    }

    #[tokio::test]
    async fn test_create_and_get_agent() {
        let (db, _temp) = create_test_db().await;
        let repo = AgentsRepository::new(db);

        let agent = Agent {
            id: "agent-1".to_string(),
            name: "Test Agent".to_string(),
            model: "gpt-4".to_string(),
            system_prompt: Some("You are a helpful assistant".to_string()),
            tools: vec!["read_file".to_string(), "write_file".to_string()],
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
        };

        repo.create_agent(&agent)
            .await
            .expect("Failed to create agent");

        let retrieved = repo
            .get_agent("agent-1")
            .await
            .expect("Failed to get agent");
        assert!(retrieved.is_some());

        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.id, "agent-1");
        assert_eq!(retrieved.name, "Test Agent");
        assert_eq!(retrieved.tools.len(), 2);
    }

    #[tokio::test]
    async fn test_update_agent() {
        let (db, _temp) = create_test_db().await;
        let repo = AgentsRepository::new(db);

        let agent = Agent {
            id: "agent-2".to_string(),
            name: "Original Name".to_string(),
            model: "gpt-4".to_string(),
            system_prompt: None,
            tools: vec![],
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
        };

        repo.create_agent(&agent)
            .await
            .expect("Failed to create agent");

        let updates = AgentUpdates {
            name: Some("Updated Name".to_string()),
            model: None,
            system_prompt: Some("New prompt".to_string()),
            tools: None,
        };

        repo.update_agent("agent-2", updates)
            .await
            .expect("Failed to update agent");

        let retrieved = repo
            .get_agent("agent-2")
            .await
            .expect("Failed to get agent")
            .unwrap();
        assert_eq!(retrieved.name, "Updated Name");
        assert_eq!(retrieved.system_prompt, Some("New prompt".to_string()));
        assert_eq!(retrieved.model, "gpt-4"); // Unchanged
    }

    #[tokio::test]
    async fn test_agent_session() {
        let (db, _temp) = create_test_db().await;
        let repo = AgentsRepository::new(db);

        // Create agent first
        let agent = Agent {
            id: "agent-3".to_string(),
            name: "Test Agent".to_string(),
            model: "gpt-4".to_string(),
            system_prompt: None,
            tools: vec![],
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
        };
        repo.create_agent(&agent)
            .await
            .expect("Failed to create agent");

        let agent_session = AgentSession {
            agent_id: "agent-3".to_string(),
            session_id: "session-1".to_string(),
            settings: TaskSettings {
                auto_approve_edits: Some(true),
                auto_approve_plan: Some(false),
                auto_code_review: None,
                extra: Default::default(),
            },
            created_at: chrono::Utc::now().timestamp(),
        };

        repo.create_agent_session(&agent_session)
            .await
            .expect("Failed to create agent session");

        let retrieved = repo
            .get_agent_session("session-1")
            .await
            .expect("Failed to get agent session");
        assert!(retrieved.is_some());

        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.agent_id, "agent-3");
        assert_eq!(retrieved.settings.auto_approve_edits, Some(true));
    }
}
