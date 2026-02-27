//! Chat History Repository
//! Handles CRUD operations for sessions, messages, and events in chat_history.db

use crate::database::Database;
use crate::storage::models::*;
use std::sync::Arc;

/// Repository for chat history operations
#[derive(Clone)]
pub struct ChatHistoryRepository {
    db: Arc<Database>,
}

impl ChatHistoryRepository {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    // ============== Session Operations ==============

    /// Create a new session
    pub async fn create_session(&self, session: &Session) -> Result<(), String> {
        let sql = r#"
            INSERT INTO sessions (id, project_id, title, status, created_at, updated_at, last_event_id, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        "#;

        self.db
            .execute(
                sql,
                vec![
                    serde_json::json!(session.id),
                    serde_json::json!(session.project_id),
                    serde_json::json!(session.title),
                    serde_json::json!(session.status.as_str()),
                    serde_json::json!(session.created_at),
                    serde_json::json!(session.updated_at),
                    serde_json::json!(session.last_event_id),
                    serde_json::json!(session.metadata.as_ref().map(|m| m.to_string())),
                ],
            )
            .await?;

        Ok(())
    }

    /// Get a session by ID
    pub async fn get_session(&self, session_id: &str) -> Result<Option<Session>, String> {
        let result = self
            .db
            .query(
                "SELECT * FROM sessions WHERE id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;

        Ok(result.rows.first().map(row_to_session))
    }

    /// Update session status
    pub async fn update_session_status(
        &self,
        session_id: &str,
        status: SessionStatus,
        last_event_id: Option<&str>,
    ) -> Result<(), String> {
        let updated_at = chrono::Utc::now().timestamp();

        if let Some(event_id) = last_event_id {
            self.db.execute(
                "UPDATE sessions SET status = ?, updated_at = ?, last_event_id = ? WHERE id = ?",
                vec![
                    serde_json::json!(status.as_str()),
                    serde_json::json!(updated_at),
                    serde_json::json!(event_id),
                    serde_json::json!(session_id),
                ],
            ).await?;
        } else {
            self.db
                .execute(
                    "UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?",
                    vec![
                        serde_json::json!(status.as_str()),
                        serde_json::json!(updated_at),
                        serde_json::json!(session_id),
                    ],
                )
                .await?;
        }

        Ok(())
    }

    /// Update session title
    pub async fn update_session_title(&self, session_id: &str, title: &str) -> Result<(), String> {
        let updated_at = chrono::Utc::now().timestamp();

        self.db
            .execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                vec![
                    serde_json::json!(title),
                    serde_json::json!(updated_at),
                    serde_json::json!(session_id),
                ],
            )
            .await?;

        Ok(())
    }

    /// List sessions with optional filters
    pub async fn list_sessions(
        &self,
        project_id: Option<&str>,
        status: Option<SessionStatus>,
        limit: Option<usize>,
        offset: Option<usize>,
    ) -> Result<Vec<Session>, String> {
        let mut sql = "SELECT * FROM sessions WHERE 1=1".to_string();
        let mut params: Vec<serde_json::Value> = vec![];

        if let Some(pid) = project_id {
            sql.push_str(" AND project_id = ?");
            params.push(serde_json::json!(pid));
        }

        if let Some(s) = status {
            sql.push_str(" AND status = ?");
            params.push(serde_json::json!(s.as_str()));
        }

        sql.push_str(" ORDER BY updated_at DESC");

        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        if let Some(offset) = offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }

        let result = self.db.query(&sql, params).await?;

        Ok(result.rows.iter().map(row_to_session).collect())
    }

    /// Delete a session and all related data
    pub async fn delete_session(&self, session_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM sessions WHERE id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;
        Ok(())
    }

    // ============== Message Operations ==============

    /// Create a new message
    pub async fn create_message(&self, message: &Message) -> Result<(), String> {
        let sql = r#"
            INSERT INTO messages (id, session_id, role, content, created_at, tool_call_id, parent_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        "#;

        self.db
            .execute(
                sql,
                vec![
                    serde_json::json!(message.id),
                    serde_json::json!(message.session_id),
                    serde_json::json!(message.role.as_str()),
                    serde_json::json!(serde_json::to_string(&message.content).unwrap()),
                    serde_json::json!(message.created_at),
                    serde_json::json!(message.tool_call_id),
                    serde_json::json!(message.parent_id),
                ],
            )
            .await?;

        // Update session's updated_at timestamp
        let updated_at = chrono::Utc::now().timestamp();
        self.db
            .execute(
                "UPDATE sessions SET updated_at = ? WHERE id = ?",
                vec![
                    serde_json::json!(updated_at),
                    serde_json::json!(&message.session_id),
                ],
            )
            .await?;

        Ok(())
    }

    /// Get messages for a session
    pub async fn get_messages(
        &self,
        session_id: &str,
        limit: Option<usize>,
        before_id: Option<&str>,
    ) -> Result<Vec<Message>, String> {
        let mut sql = "SELECT * FROM messages WHERE session_id = ?".to_string();
        let mut params: Vec<serde_json::Value> = vec![serde_json::json!(session_id)];

        if let Some(before) = before_id {
            // Get created_at of the before message
            let before_result = self
                .db
                .query(
                    "SELECT created_at FROM messages WHERE id = ?",
                    vec![serde_json::json!(before)],
                )
                .await?;

            if let Some(row) = before_result.rows.first() {
                if let Some(created_at) = row.get("created_at").and_then(|v| v.as_i64()) {
                    sql.push_str(" AND created_at < ?");
                    params.push(serde_json::json!(created_at));
                }
            }
        }

        sql.push_str(" ORDER BY created_at DESC");

        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        let result = self.db.query(&sql, params).await?;

        let mut messages: Vec<Message> = result
            .rows
            .iter()
            .map(row_to_message)
            .collect::<Result<Vec<_>, _>>()?;

        // Reverse to get chronological order
        messages.reverse();
        Ok(messages)
    }

    /// Delete all messages for a session
    pub async fn delete_messages(&self, session_id: &str) -> Result<(), String> {
        self.db
            .execute(
                "DELETE FROM messages WHERE session_id = ?",
                vec![serde_json::json!(session_id)],
            )
            .await?;
        Ok(())
    }

    // ============== Event Operations ==============

    /// Create a new event
    pub async fn create_event(&self, event: &SessionEvent) -> Result<(), String> {
        let sql = r#"
            INSERT INTO events (id, session_id, event_type, payload, created_at)
            VALUES (?, ?, ?, ?, ?)
        "#;

        self.db
            .execute(
                sql,
                vec![
                    serde_json::json!(event.id),
                    serde_json::json!(event.session_id),
                    serde_json::json!(event.event_type.as_str()),
                    serde_json::json!(event.payload.to_string()),
                    serde_json::json!(event.created_at),
                ],
            )
            .await?;

        Ok(())
    }

    /// Get events for a session, optionally after a specific event ID (for resume)
    pub async fn get_events(
        &self,
        session_id: &str,
        after_event_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<SessionEvent>, String> {
        let mut sql = "SELECT * FROM events WHERE session_id = ?".to_string();
        let mut params: Vec<serde_json::Value> = vec![serde_json::json!(session_id)];

        if let Some(after_id) = after_event_id {
            // Get created_at of the after event
            let after_result = self
                .db
                .query(
                    "SELECT created_at FROM events WHERE id = ?",
                    vec![serde_json::json!(after_id)],
                )
                .await?;

            if let Some(row) = after_result.rows.first() {
                if let Some(created_at) = row.get("created_at").and_then(|v| v.as_i64()) {
                    sql.push_str(" AND created_at > ?");
                    params.push(serde_json::json!(created_at));
                }
            }
        }

        sql.push_str(" ORDER BY created_at ASC");

        if let Some(limit) = limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }

        let result = self.db.query(&sql, params).await?;

        result
            .rows
            .iter()
            .map(row_to_event)
            .collect::<Result<Vec<_>, _>>()
    }

    /// Delete old events for a session (cleanup)
    pub async fn delete_events_before(
        &self,
        session_id: &str,
        before_timestamp: i64,
    ) -> Result<u64, String> {
        let result = self
            .db
            .execute(
                "DELETE FROM events WHERE session_id = ? AND created_at < ?",
                vec![
                    serde_json::json!(session_id),
                    serde_json::json!(before_timestamp),
                ],
            )
            .await?;

        Ok(result.rows_affected)
    }
}

// ============== Row Conversions ==============

fn row_to_session(row: &serde_json::Value) -> Session {
    Session {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        project_id: row
            .get("project_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        title: row
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        status: row
            .get("status")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(SessionStatus::Created),
        created_at: row.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0),
        updated_at: row.get("updated_at").and_then(|v| v.as_i64()).unwrap_or(0),
        last_event_id: row
            .get("last_event_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        metadata: row
            .get("metadata")
            .and_then(|v| v.as_str())
            .and_then(|s| serde_json::from_str(s).ok()),
    }
}

fn row_to_message(row: &serde_json::Value) -> Result<Message, String> {
    let content_str = row
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or("Missing content field")?;

    let content: MessageContent = serde_json::from_str(content_str)
        .map_err(|e| format!("Failed to parse message content: {}", e))?;

    Ok(Message {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        session_id: row
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        role: row
            .get("role")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(MessageRole::User),
        content,
        created_at: row.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0),
        tool_call_id: row
            .get("tool_call_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        parent_id: row
            .get("parent_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

fn row_to_event(row: &serde_json::Value) -> Result<SessionEvent, String> {
    let payload_str = row
        .get("payload")
        .and_then(|v| v.as_str())
        .ok_or("Missing payload field")?;

    let payload: serde_json::Value = serde_json::from_str(payload_str)
        .map_err(|e| format!("Failed to parse event payload: {}", e))?;

    Ok(SessionEvent {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        session_id: row
            .get("session_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        event_type: row
            .get("event_type")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(EventType::Status),
        payload,
        created_at: row.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn create_test_db() -> (Arc<Database>, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = Arc::new(Database::new(db_path.to_string_lossy().to_string()));
        db.connect()
            .await
            .expect("Failed to connect to test database");

        // Create tables manually for tests
        let migrations = super::super::migrations::chat_history_migrations();
        let runner = super::super::migrations::MigrationRunner::new(&db, &migrations);
        runner.init().await.expect("Failed to init migrations");
        runner.migrate().await.expect("Failed to run migrations");

        (db, temp_dir)
    }

    #[tokio::test]
    async fn test_create_and_get_session() {
        let (db, _temp) = create_test_db().await;
        let repo = ChatHistoryRepository::new(db);

        let session = Session {
            id: "test-session-1".to_string(),
            project_id: Some("project-1".to_string()),
            title: Some("Test Session".to_string()),
            status: SessionStatus::Created,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            last_event_id: None,
            metadata: Some(serde_json::json!({"key": "value"})),
        };

        repo.create_session(&session)
            .await
            .expect("Failed to create session");

        let retrieved = repo
            .get_session("test-session-1")
            .await
            .expect("Failed to get session");
        assert!(retrieved.is_some());

        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.id, "test-session-1");
        assert_eq!(retrieved.project_id, Some("project-1".to_string()));
        assert_eq!(retrieved.title, Some("Test Session".to_string()));
    }

    #[tokio::test]
    async fn test_update_session_status() {
        let (db, _temp) = create_test_db().await;
        let repo = ChatHistoryRepository::new(db);

        let session = Session {
            id: "test-session-2".to_string(),
            project_id: None,
            title: None,
            status: SessionStatus::Created,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            last_event_id: None,
            metadata: None,
        };

        repo.create_session(&session)
            .await
            .expect("Failed to create session");
        repo.update_session_status("test-session-2", SessionStatus::Running, Some("event-1"))
            .await
            .expect("Failed to update status");

        let retrieved = repo
            .get_session("test-session-2")
            .await
            .expect("Failed to get session");
        assert_eq!(retrieved.unwrap().status, SessionStatus::Running);
    }

    #[tokio::test]
    async fn test_create_and_get_messages() {
        let (db, _temp) = create_test_db().await;
        let repo = ChatHistoryRepository::new(db);

        // Create session first
        let session = Session {
            id: "test-session-3".to_string(),
            project_id: None,
            title: None,
            status: SessionStatus::Created,
            created_at: chrono::Utc::now().timestamp(),
            updated_at: chrono::Utc::now().timestamp(),
            last_event_id: None,
            metadata: None,
        };
        repo.create_session(&session)
            .await
            .expect("Failed to create session");

        let message = Message {
            id: "msg-1".to_string(),
            session_id: "test-session-3".to_string(),
            role: MessageRole::User,
            content: MessageContent::Text {
                text: "Hello".to_string(),
            },
            created_at: chrono::Utc::now().timestamp(),
            tool_call_id: None,
            parent_id: None,
        };

        repo.create_message(&message)
            .await
            .expect("Failed to create message");

        let messages = repo
            .get_messages("test-session-3", None, None)
            .await
            .expect("Failed to get messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].id, "msg-1");
    }
}
