CREATE TABLE workspace_tool_calls (
  principal TEXT NOT NULL, id TEXT PRIMARY KEY, call_id TEXT NOT NULL, actor TEXT NOT NULL,
  tool TEXT NOT NULL, status INTEGER NOT NULL, occurred_at TEXT NOT NULL, result_bytes INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX workspace_tool_calls_by_principal ON workspace_tool_calls(principal,occurred_at);
