CREATE TABLE workspace_revisions (
  principal TEXT NOT NULL, revision INTEGER NOT NULL, parent INTEGER NOT NULL,
  saved TEXT NOT NULL, snapshot BLOB NOT NULL,
  PRIMARY KEY(principal,revision), UNIQUE(principal,parent)
);
