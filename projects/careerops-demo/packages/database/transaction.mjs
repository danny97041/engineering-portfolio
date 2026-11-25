export function transaction(db, action) {
  if (db.isTransaction) return action();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result=action();
    db.exec('COMMIT');
    return result;
  } catch(error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
