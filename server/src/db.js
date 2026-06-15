const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

let db;
let SQL;
let nativePrepare;

function getDb() {
  return db;
}

function makePrepare(sql) {
  return {
    run: function(...params) {
      if (!db) throw new Error('Database not initialized');
      const stmt = nativePrepare(sql);
      try {
        const paramArr = params && params.length > 0 ? params : [];
        stmt.bind(paramArr);
        stmt.step();
      } finally {
        try { stmt.free(); } catch(e) {}
      }
      const lastIdResult = db.exec("SELECT last_insert_rowid() as id");
      const lastId = lastIdResult?.[0]?.values?.[0]?.[0];
      let changes = 0;
      try { changes = db.getRowsModified() || 0; } catch(e) {}
      return { lastInsertRowid: lastId, changes };
    },
    get: function(...params) {
      if (!db) throw new Error('Database not initialized');
      const stmt = nativePrepare(sql);
      let row = null;
      try {
        const paramArr = params && params.length > 0 ? params : [];
        stmt.bind(paramArr);
        if (stmt.step()) {
          row = stmt.getAsObject();
        }
      } finally {
        try { stmt.free(); } catch(e) {}
      }
      return row;
    },
    all: function(...params) {
      if (!db) throw new Error('Database not initialized');
      const stmt = nativePrepare(sql);
      const rows = [];
      try {
        const paramArr = params && params.length > 0 ? params : [];
        stmt.bind(paramArr);
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
      } finally {
        try { stmt.free(); } catch(e) {}
      }
      return rows;
    }
  };
}

function exec(sql) {
  if (!db) throw new Error('Database not initialized');
  db.exec(sql);
}

function makeTransaction(fn) {
  return function(...args) {
    if (!db) throw new Error('Database not initialized');
    db.exec('BEGIN TRANSACTION');
    try {
      const result = fn.apply(this, args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
}

async function init() {
  if (db) return;

  SQL = await initSqlJs();
  const dbPath = path.join(__dirname, '..', 'data', 'repair_fund.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  nativePrepare = db.prepare.bind(db);
  db.prepare = makePrepare;
  db.transaction = makeTransaction;
  db.pragma = (p) => db.exec(`PRAGMA ${p}`);

  try { db.pragma('journal_mode = WAL'); } catch(e) {}
  try { db.pragma('foreign_keys = ON'); } catch(e) {}

  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('tenant','housing_manager','supervisor','finance','inspector')),
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE,
      tenant_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      id_card TEXT,
      phone TEXT,
      room_number TEXT NOT NULL,
      building TEXT,
      arrears_amount REAL DEFAULT 0,
      has_arrears INTEGER DEFAULT 0,
      arrears_days INTEGER DEFAULT 0,
      status TEXT DEFAULT 'normal',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS repair_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      is_safety INTEGER DEFAULT 0,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS cost_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS annual_budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      subject_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      used_amount REAL DEFAULT 0,
      frozen_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(year, subject_id)
    );

    CREATE TABLE IF NOT EXISTS repair_fund_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_code TEXT UNIQUE NOT NULL,
      account_name TEXT NOT NULL,
      balance REAL DEFAULT 0,
      frozen_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS construction_teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_code TEXT UNIQUE NOT NULL,
      team_name TEXT NOT NULL,
      legal_person TEXT,
      contact TEXT,
      phone TEXT,
      qualification_level TEXT,
      qualification_valid_until TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS repair_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_no TEXT UNIQUE NOT NULL,
      tenant_id INTEGER NOT NULL,
      repair_type_id INTEGER NOT NULL,
      subject_id INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      room_number TEXT,
      contact_phone TEXT,
      urgency TEXT DEFAULT 'normal',
      estimated_amount REAL DEFAULT 0,
      final_amount REAL,
      status TEXT DEFAULT 'draft',
      version INTEGER DEFAULT 1,
      has_arrears_when_submitted INTEGER DEFAULT 0,
      arrears_amount_when_submitted REAL DEFAULT 0,
      need_supervisor_review INTEGER DEFAULT 0,
      current_approver TEXT,
      budget_frozen INTEGER DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      is_paid INTEGER DEFAULT 0,
      warranty_amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS request_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      changed_by INTEGER,
      change_reason TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS approval_chains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      approver_role TEXT NOT NULL,
      approver_id INTEGER,
      approver_name TEXT,
      step INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      comment TEXT,
      approved_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS budget_freezes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      budget_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'frozen',
      frozen_at TEXT DEFAULT (datetime('now','localtime')),
      unfrozen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS quotations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      quoted_amount REAL NOT NULL,
      quotation_detail TEXT,
      is_selected INTEGER DEFAULT 0,
      submitted_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS construction_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      step TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      operator_id INTEGER,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS acceptance_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      inspector_id INTEGER,
      result TEXT,
      quality_level TEXT,
      remark TEXT,
      photos TEXT,
      accepted_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      invoice_no TEXT,
      invoice_amount REAL,
      is_verified INTEGER DEFAULT 0,
      verify_placeholder TEXT DEFAULT '发票验真占位',
      verified_at TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS fund_disbursements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      disbursement_no TEXT UNIQUE NOT NULL,
      request_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      warranty_amount REAL DEFAULT 0,
      actual_amount REAL NOT NULL,
      invoice_id INTEGER,
      finance_id INTEGER,
      status TEXT DEFAULT 'pending',
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      disbursed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS fund_ledgers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      trans_type TEXT NOT NULL,
      trans_no TEXT,
      request_id INTEGER,
      debit REAL DEFAULT 0,
      credit REAL DEFAULT 0,
      balance_after REAL NOT NULL,
      remark TEXT,
      operator_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      request_id INTEGER,
      balance_before REAL NOT NULL,
      change_amount REAL NOT NULL,
      balance_after REAL NOT NULL,
      snapshot_type TEXT NOT NULL,
      reference_no TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  seedData();
  saveToDisk();
}

function saveToDisk() {
  if (!db) return;
  try {
    const dbPath = path.join(__dirname, '..', 'data', 'repair_fund.db');
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  } catch(e) {}
}

function seedData() {
  if (!db) return;
  const countResult = db.exec('SELECT COUNT(*) as cnt FROM users');
  const userCount = countResult?.[0]?.values?.[0]?.[0] || 0;
  if (userCount > 0) return;

  const bcrypt = require('bcryptjs');
  const hash = (p) => bcrypt.hashSync(p, 8);

  const p = db.prepare;
  const u1 = p('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('tenant01', hash('123456'), 'tenant', '张三').lastInsertRowid;
  const u2 = p('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('tenant02', hash('123456'), 'tenant', '李四').lastInsertRowid;
  p('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('manager01', hash('123456'), 'housing_manager', '王房管');
  p('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('supervisor01', hash('123456'), 'supervisor', '赵主管');
  p('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('finance01', hash('123456'), 'finance', '钱会计');
  p('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('inspector01', hash('123456'), 'inspector', '孙验收');

  p('INSERT INTO tenants (user_id, tenant_code, name, room_number, building, arrears_amount, has_arrears, arrears_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(u1, 'T001', '张三', '1-101', '1号楼', 0, 0, 0);
  p('INSERT INTO tenants (user_id, tenant_code, name, room_number, building, arrears_amount, has_arrears, arrears_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(u2, 'T002', '李四', '2-203', '2号楼', 3500.50, 1, 45);

  p('INSERT INTO repair_types (code, name, is_safety, description) VALUES (?, ?, ?, ?)').run('SAFE001', '电路故障维修', 1, '涉及用电安全的紧急维修');
  p('INSERT INTO repair_types (code, name, is_safety, description) VALUES (?, ?, ?, ?)').run('SAFE002', '燃气泄漏维修', 1, '燃气安全隐患');
  p('INSERT INTO repair_types (code, name, is_safety, description) VALUES (?, ?, ?, ?)').run('SAFE003', '水管爆裂维修', 1, '紧急漏水维修');
  p('INSERT INTO repair_types (code, name, is_safety, description) VALUES (?, ?, ?, ?)').run('NORM001', '门锁维修', 0, '普通门锁更换维修');
  p('INSERT INTO repair_types (code, name, is_safety, description) VALUES (?, ?, ?, ?)').run('NORM002', '墙面刷漆', 0, '室内墙面翻新');
  p('INSERT INTO repair_types (code, name, is_safety, description) VALUES (?, ?, ?, ?)').run('NORM003', '灯具更换', 0, '普通灯具更换');

  const s1 = p('INSERT INTO cost_subjects (code, name) VALUES (?, ?)').run('5001', '日常维修养护费').lastInsertRowid;
  const s2 = p('INSERT INTO cost_subjects (code, name) VALUES (?, ?)').run('5002', '设施设备更新改造费').lastInsertRowid;
  p('INSERT INTO cost_subjects (code, name) VALUES (?, ?)').run('5003', '安全应急维修费');

  const year = new Date().getFullYear();
  p('INSERT INTO annual_budgets (year, subject_id, total_amount) VALUES (?, ?, ?)').run(year, s1, 500000.00);
  p('INSERT INTO annual_budgets (year, subject_id, total_amount) VALUES (?, ?, ?)').run(year, s2, 300000.00);

  p('INSERT INTO repair_fund_accounts (account_code, account_name, balance) VALUES (?, ?, ?)').run('FUND001', '住宅专项维修资金-基本户', 2500000.00);
  p('INSERT INTO repair_fund_accounts (account_code, account_name, balance) VALUES (?, ?, ?)').run('FUND002', '住宅专项维修资金-应急户', 500000.00);

  p('INSERT INTO construction_teams (team_code, team_name, contact, phone, qualification_level, qualification_valid_until) VALUES (?, ?, ?, ?, ?, ?)').run('TEAM001', '诚信建筑维修有限公司', '刘经理', '13800138001', '一级', '2027-12-31');
  p('INSERT INTO construction_teams (team_code, team_name, contact, phone, qualification_level, qualification_valid_until) VALUES (?, ?, ?, ?, ?, ?)').run('TEAM002', '安居工程服务公司', '陈工', '13800138002', '二级', '2026-06-30');
  p('INSERT INTO construction_teams (team_code, team_name, contact, phone, qualification_level, qualification_valid_until) VALUES (?, ?, ?, ?, ?, ?)').run('TEAM003', '便民家政维修队', '周师傅', '13800138003', '三级', '2026-12-31');
}

module.exports = { getDb, init, prepare: makePrepare, exec, saveToDisk };
