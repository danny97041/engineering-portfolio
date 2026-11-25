CREATE TABLE qa_records (principal TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(principal,id));
--> statement-breakpoint
CREATE TABLE qa_commands (principal TEXT NOT NULL, request_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(principal,request_key));
--> statement-breakpoint
CREATE TRIGGER qa_apply AFTER INSERT ON qa_commands BEGIN
  SELECT CASE WHEN json_extract(NEW.payload,'$.op')='create' AND EXISTS(SELECT 1 FROM qa_records WHERE principal=NEW.principal AND id=json_extract(NEW.payload,'$.id')) THEN RAISE(ABORT,'record conflict') END;
  SELECT CASE WHEN json_extract(NEW.payload,'$.op')='update' AND NOT EXISTS(SELECT 1 FROM qa_records WHERE principal=NEW.principal AND id=json_extract(NEW.payload,'$.id') AND version=json_extract(NEW.payload,'$.version') AND status<>'archived') THEN RAISE(ABORT,'version conflict') END;
  INSERT INTO qa_records SELECT NEW.principal,json_extract(NEW.payload,'$.id'),json_extract(NEW.payload,'$.title'),'planned',1 WHERE json_extract(NEW.payload,'$.op')='create';
  UPDATE qa_records SET status=json_extract(NEW.payload,'$.status'),version=version+1 WHERE json_extract(NEW.payload,'$.op')='update' AND principal=NEW.principal AND id=json_extract(NEW.payload,'$.id');
END;
