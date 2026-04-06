const { exec } = require('./query');

async function initializeDatabase() {
  await exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      primary_email TEXT NOT NULL UNIQUE,
      secondary_email TEXT,
      username TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      phone_number TEXT,
      full_name TEXT NOT NULL,
      system_role TEXT NOT NULL CHECK(system_role IN ('manager', 'team_member')),
      employment_role TEXT,
      requires_profile_completion INTEGER NOT NULL DEFAULT 0,
      requires_password_change INTEGER NOT NULL DEFAULT 0,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      manager_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (manager_user_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS team_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      is_manager INTEGER NOT NULL DEFAULT 0,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (team_id, user_id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      is_available INTEGER NOT NULL DEFAULT 0,
      start_time TEXT,
      end_time TEXT,
      UNIQUE (user_id, day_of_week),
      FOREIGN KEY (user_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS schedule_constraints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL UNIQUE,
      min_hours_per_window REAL,
      max_hours_per_window REAL,
      hours_window_days INTEGER NOT NULL DEFAULT 7,
      min_staff_per_hour INTEGER,
      max_staff_per_hour INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS business_hours (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
      is_open INTEGER NOT NULL DEFAULT 0,
      start_time TEXT,
      end_time TEXT,
      UNIQUE (team_id, day_of_week),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS role_requirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      role_name TEXT NOT NULL,
      day_of_week INTEGER,
      start_time TEXT,
      end_time TEXT,
      min_employees INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      shift_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      employment_role TEXT NOT NULL,
      recurring_group_id TEXT,
      created_by_user_id INTEGER NOT NULL,
      updated_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES accounts(id),
      FOREIGN KEY (created_by_user_id) REFERENCES accounts(id),
      FOREIGN KEY (updated_by_user_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS schedule_weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      week_start_date TEXT NOT NULL,
      finalized_at TEXT,
      finalized_by_user_id INTEGER,
      last_change_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (team_id, week_start_date),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (finalized_by_user_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      team_id INTEGER,
      notification_type TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'email',
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES accounts(id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS shift_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      shift_id INTEGER,
      week_start_date TEXT NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES accounts(id),
      --FOREIGN KEY (shift_id) REFERENCES shifts(id),
      FOREIGN KEY (created_by_user_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES accounts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
    CREATE INDEX IF NOT EXISTS idx_accounts_primary_email ON accounts(primary_email);
    CREATE INDEX IF NOT EXISTS idx_team_memberships_team_user ON team_memberships(team_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_availability_user_day ON availability(user_id, day_of_week);
    CREATE INDEX IF NOT EXISTS idx_shifts_team_date ON shifts(team_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, shift_date);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_shift_audit_team_week ON shift_audit_logs(team_id, week_start_date, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);
}

module.exports = {
  initializeDatabase,
};
