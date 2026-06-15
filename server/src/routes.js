const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const rules = require('./rules');

const router = express.Router();

function generateRequestNo() {
  const d = new Date();
  const ts = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = String(Math.floor(Math.random()*9000)+1000);
  return `RR${ts}${rand}`;
}
function generateDisbursementNo() {
  const d = new Date();
  const ts = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = String(Math.floor(Math.random()*9000)+1000);
  return `FD${ts}${rand}`;
}

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const tenant = user.role === 'tenant'
    ? db.prepare('SELECT * FROM tenants WHERE user_id = ?').get(user.id)
    : null;
  res.json({
    user: { id: user.id, username: user.username, role: user.role, name: user.name },
    tenant
  });
});

router.get('/repair-types', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM repair_types ORDER BY is_safety DESC, code').all());
});

router.get('/cost-subjects', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM cost_subjects ORDER BY code').all());
});

router.get('/construction-teams', (req, res) => {
  const db = getDb();
  res.json(db.prepare("SELECT * FROM construction_teams WHERE status = 'active' ORDER BY team_code").all());
});

router.get('/fund-accounts', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM repair_fund_accounts ORDER BY account_code').all());
});

router.get('/budgets', (req, res) => {
  const db = getDb();
  const year = req.query.year || new Date().getFullYear();
  const rows = db.prepare(`
    SELECT b.*, s.code as subject_code, s.name as subject_name
    FROM annual_budgets b
    JOIN cost_subjects s ON b.subject_id = s.id
    WHERE b.year = ?
    ORDER BY s.code
  `).all(year);
  res.json(rows);
});

router.get('/tenants/:id/check-arrears', (req, res) => {
  res.json(rules.checkTenantArrears(Number(req.params.id)));
});

router.get('/repair-requests', (req, res) => {
  const db = getDb();
  const { role, userId, tenantId, status } = req.query;
  let sql = `
    SELECT r.*, t.name as tenant_name, t.room_number, rt.name as type_name, rt.is_safety,
           s.code as subject_code, s.name as subject_name
    FROM repair_requests r
    JOIN tenants t ON r.tenant_id = t.id
    JOIN repair_types rt ON r.repair_type_id = rt.id
    LEFT JOIN cost_subjects s ON r.subject_id = s.id
    WHERE 1=1
  `;
  const params = [];
  if (role === 'tenant' && tenantId) {
    sql += ' AND r.tenant_id = ?';
    params.push(Number(tenantId));
  }
  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY r.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/repair-requests/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const request = db.prepare(`
    SELECT r.*, t.name as tenant_name, t.room_number, t.building, t.has_arrears, t.arrears_amount,
           rt.name as type_name, rt.is_safety, s.code as subject_code, s.name as subject_name
    FROM repair_requests r
    JOIN tenants t ON r.tenant_id = t.id
    JOIN repair_types rt ON r.repair_type_id = rt.id
    LEFT JOIN cost_subjects s ON r.subject_id = s.id
    WHERE r.id = ?
  `).get(id);
  if (!request) return res.status(404).json({ error: '申请不存在' });

  const approvals = db.prepare('SELECT * FROM approval_chains WHERE request_id = ? ORDER BY step').all(id);
  const versions = db.prepare('SELECT * FROM request_versions WHERE request_id = ? ORDER BY version DESC').all(id);
  const quotations = db.prepare(`
    SELECT q.*, ct.team_name, ct.qualification_level
    FROM quotations q JOIN construction_teams ct ON q.team_id = ct.id
    WHERE q.request_id = ? ORDER BY q.quoted_amount
  `).all(id);
  const progress = db.prepare('SELECT * FROM construction_progress WHERE request_id = ? ORDER BY id').all(id);
  const acceptance = db.prepare('SELECT * FROM acceptance_evidence WHERE request_id = ?').get(id);
  const invoices = db.prepare('SELECT * FROM invoices WHERE request_id = ?').all(id);
  const disbursements = db.prepare(`
    SELECT fd.*, ra.account_name
    FROM fund_disbursements fd JOIN repair_fund_accounts ra ON fd.account_id = ra.id
    WHERE fd.request_id = ? ORDER BY fd.created_at DESC
  `).all(id);
  const ledgers = db.prepare(`
    SELECT fl.*, ra.account_name
    FROM fund_ledgers fl JOIN repair_fund_accounts ra ON fl.account_id = ra.id
    WHERE fl.request_id = ? ORDER BY fl.created_at DESC
  `).all(id);

  res.json({
    request, approvals, versions, quotations, progress, acceptance,
    invoices, disbursements, ledgers
  });
});

router.post('/repair-requests', (req, res) => {
  const db = getDb();
  const { tenant_id, repair_type_id, subject_id, title, description,
          room_number, contact_phone, urgency, estimated_amount } = req.body;

  const valid = rules.validateRepairTypeForArrears(tenant_id, repair_type_id);
  if (!valid.passed) return res.status(400).json({ error: valid.reason, ruleCheck: valid });

  const arrearsInfo = rules.checkTenantArrears(tenant_id);

  const needReview = rules.needSupervisorReview(estimated_amount || 0);

  const tx = db.transaction(() => {
    const requestNo = generateRequestNo();
    const info = db.prepare(`
      INSERT INTO repair_requests
      (request_no, tenant_id, repair_type_id, subject_id, title, description,
       room_number, contact_phone, urgency, estimated_amount, status, version,
       has_arrears_when_submitted, arrears_amount_when_submitted,
       need_supervisor_review, current_approver)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 1, ?, ?, ?, ?)
    `).run(
      requestNo, tenant_id, repair_type_id, subject_id || null, title, description || null,
      room_number, contact_phone || null, urgency || 'normal', estimated_amount || 0,
      arrearsInfo.hasArrears ? 1 : 0, arrearsInfo.arrearsAmount || 0,
      needReview ? 1 : 0, needReview ? 'supervisor' : 'housing_manager'
    );

    const rid = info.lastInsertRowid;

    const reqData = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(rid);
    db.prepare(`
      INSERT INTO request_versions (request_id, version, data_json, change_reason)
      VALUES (?, ?, ?, ?)
    `).run(rid, 1, JSON.stringify(reqData), '创建申请');

    db.prepare(`
      INSERT INTO approval_chains (request_id, approver_role, step, status)
      VALUES (?, ?, ?, 'pending')
    `).run(rid, 'housing_manager', 1);

    if (needReview) {
      db.prepare(`
        INSERT INTO approval_chains (request_id, approver_role, step, status)
        VALUES (?, ?, ?, 'pending')
      `).run(rid, 'supervisor', 2);
    }

    ['approved', 'construction_started', 'construction_completed', 'accepted'].forEach((step, i) => {
      db.prepare(`
        INSERT INTO construction_progress (request_id, step, status)
        VALUES (?, ?, 'pending')
      `).run(rid, step);
    });

    return rid;
  });

  try {
    const rid = tx();
    const saved = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(rid);
    res.json({ ok: true, id: rid, request: saved, ruleCheck: valid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/repair-requests/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { title, description, estimated_amount, contact_phone } = req.body;

  const existing = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: '申请不存在' });

  if (estimated_amount !== undefined) {
    const priceCheck = rules.checkPriceChangeAfterPayment(id, estimated_amount);
    if (!priceCheck.passed) return res.status(400).json({ error: priceCheck.reason });
  }

  const tx = db.transaction(() => {
    const newVersion = existing.version + 1;
    db.prepare(`
      UPDATE repair_requests
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          estimated_amount = COALESCE(?, estimated_amount),
          contact_phone = COALESCE(?, contact_phone),
          version = ?,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(title, description, estimated_amount, contact_phone, newVersion, id);

    const updated = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(id);
    db.prepare(`
      INSERT INTO request_versions (request_id, version, data_json, change_reason)
      VALUES (?, ?, ?, ?)
    `).run(id, newVersion, JSON.stringify(updated), req.body.change_reason || '修改申请');

    return updated;
  });

  try {
    const updated = tx();
    res.json({ ok: true, request: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/repair-requests/:id/approve', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { approver_id, approver_name, approver_role, comment, action,
          subject_id, estimated_amount, final_amount } = req.body;

  const request = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: '申请不存在' });

  if (action !== 'approve' && action !== 'reject') {
    return res.status(400).json({ error: '操作类型错误' });
  }

  if (action === 'approve' && approver_role === 'housing_manager' && subject_id) {
    const budgetCheck = rules.checkBudgetAvailability(subject_id, estimated_amount || request.estimated_amount);
    if (!budgetCheck.passed) return res.status(400).json({ error: budgetCheck.reason });
  }

  if (action === 'approve' && final_amount !== undefined) {
    const priceCheck = rules.checkPriceChangeAfterPayment(id, final_amount);
    if (!priceCheck.passed) return res.status(400).json({ error: priceCheck.reason });
  }

  const tx = db.transaction(() => {
    const chain = db.prepare(
      "SELECT * FROM approval_chains WHERE request_id = ? AND approver_role = ? AND status = 'pending' ORDER BY step LIMIT 1"
    ).get(id, approver_role);
    if (!chain) return { error: '无待审批步骤' };

    db.prepare(`
      UPDATE approval_chains
      SET status = ?, approver_id = ?, approver_name = ?, comment = ?, approved_at = datetime('now','localtime')
      WHERE id = ?
    `).run(action === 'approve' ? 'approved' : 'rejected', approver_id, approver_name, comment, chain.id);

    if (action === 'reject') {
      db.prepare("UPDATE repair_requests SET status = 'rejected', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
      return { ok: true, status: 'rejected' };
    }

    const remainingPending = db.prepare(
      "SELECT COUNT(*) as cnt FROM approval_chains WHERE request_id = ? AND status = 'pending'"
    ).get(id).cnt;

    let newStatus = request.status;
    if (remainingPending === 0) {
      newStatus = 'approved';
    }

    let freezeInfo = null;
    if (approver_role === 'housing_manager' && subject_id) {
      const amt = estimated_amount || request.estimated_amount;
      const year = new Date().getFullYear();
      const budget = db.prepare('SELECT * FROM annual_budgets WHERE subject_id = ? AND year = ?').get(subject_id, year);
      if (budget) {
        db.prepare('UPDATE annual_budgets SET frozen_amount = frozen_amount + ? WHERE id = ?').run(amt, budget.id);
        freezeInfo = db.prepare(`
          INSERT INTO budget_freezes (request_id, budget_id, amount) VALUES (?, ?, ?)
        `).run(id, budget.id, amt);
      }
    }

    const finalAmt = final_amount || request.final_amount || request.estimated_amount;
    const warrantyAmt = rules.calculateWarrantyAmount(finalAmt);

    db.prepare(`
      UPDATE repair_requests
      SET status = ?, subject_id = COALESCE(?, subject_id),
          estimated_amount = COALESCE(?, estimated_amount),
          final_amount = COALESCE(?, final_amount),
          warranty_amount = COALESCE(?, warranty_amount),
          budget_frozen = CASE WHEN ? IS NOT NULL THEN 1 ELSE budget_frozen END,
          current_approver = CASE WHEN ? > 0 THEN NULL ELSE current_approver END,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(newStatus, subject_id, estimated_amount, final_amount, warrantyAmt,
          freezeInfo ? freezeInfo.lastInsertRowid : null, remainingPending, id);

    if (remainingPending === 0) {
      db.prepare(
        "UPDATE construction_progress SET status = 'completed' WHERE request_id = ? AND step = 'approved'"
      ).run(id);
    }

    return { ok: true, status: newStatus };
  });

  try {
    const result = tx();
    if (result.error) return res.status(400).json({ error: result.error });
    const updated = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(id);
    res.json({ ...result, request: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/repair-requests/:id/quotations', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { team_id, quoted_amount, quotation_detail } = req.body;

  const qualCheck = rules.checkTeamQualification(team_id);
  if (!qualCheck.passed) return res.status(400).json({ error: qualCheck.reason });

  try {
    const info = db.prepare(`
      INSERT INTO quotations (request_id, team_id, quoted_amount, quotation_detail)
      VALUES (?, ?, ?, ?)
    `).run(id, team_id, quoted_amount, quotation_detail);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/repair-requests/:id/compare-quotations', (req, res) => {
  res.json(rules.compareQuotations(Number(req.params.id)));
});

router.post('/repair-requests/:id/select-quotation', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { quotation_id } = req.body;

  const requestRow = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(id);
  if (requestRow.is_paid) return res.status(400).json({ error: '已拨款，不能更换施工队' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE quotations SET is_selected = 0 WHERE request_id = ?').run(id);
    db.prepare('UPDATE quotations SET is_selected = 1 WHERE id = ? AND request_id = ?').run(quotation_id, id);
    const q = db.prepare('SELECT * FROM quotations WHERE id = ?').get(quotation_id);
    if (q) {
      db.prepare("UPDATE repair_requests SET final_amount = ?, updated_at = datetime('now','localtime') WHERE id = ?")
        .run(q.quoted_amount, id);
    }
  });

  try {
    tx();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/repair-requests/:id/start-construction', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const request = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: '申请不存在' });
  if (request.status !== 'approved') return res.status(400).json({ error: '申请尚未通过审批' });

  try {
    db.prepare(
      "UPDATE construction_progress SET status = 'completed' WHERE request_id = ? AND step = 'construction_started'"
    ).run(id);
    db.prepare("UPDATE repair_requests SET status = 'in_construction', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/repair-requests/:id/complete-construction', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  try {
    db.prepare(
      "UPDATE construction_progress SET status = 'completed' WHERE request_id = ? AND step = 'construction_completed'"
    ).run(id);
    db.prepare("UPDATE repair_requests SET status = 'awaiting_acceptance', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/repair-requests/:id/accept', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { inspector_id, result, quality_level, remark, photos } = req.body;

  const request = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(id);
  if (!request) return res.status(404).json({ error: '申请不存在' });

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO acceptance_evidence
      (request_id, inspector_id, result, quality_level, remark, photos, accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
    `).run(id, inspector_id, result, quality_level, remark, photos);

    if (result === 'pass') {
      db.prepare(
        "UPDATE construction_progress SET status = 'completed' WHERE request_id = ? AND step = 'accepted'"
      ).run(id);
      db.prepare("UPDATE repair_requests SET status = 'accepted', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE repair_requests SET status = 'rework', updated_at = datetime('now','localtime') WHERE id = ?").run(id);
    }
  });

  try {
    tx();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/repair-requests/:id/invoices', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { invoice_no, invoice_amount } = req.body;
  try {
    const info = db.prepare(`
      INSERT INTO invoices (request_id, invoice_no, invoice_amount) VALUES (?, ?, ?)
    `).run(id, invoice_no, invoice_amount);
    res.json({ ok: true, id: info.lastInsertRowid, verify_result: rules.verifyInvoicePlaceholder(info.lastInsertRowid) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/repair-requests/:id/disburse', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { account_id, finance_id, remark } = req.body;

  const acceptanceCheck = rules.checkAcceptanceBeforeDisbursement(id);
  if (!acceptanceCheck.passed) return res.status(400).json({ error: acceptanceCheck.reason });

  const request = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(id);
  if (request.is_paid) return res.status(400).json({ error: '该申请已完成拨款' });

  const finalAmount = request.final_amount || request.estimated_amount;
  const warrantyAmount = rules.calculateWarrantyAmount(finalAmount);
  const actualAmount = Number((finalAmount - warrantyAmount).toFixed(2));

  const fundCheck = rules.checkFundBalance(account_id, actualAmount);
  if (!fundCheck.passed) return res.status(400).json({ error: fundCheck.reason });

  const tx = db.transaction(() => {
    const disNo = generateDisbursementNo();

    const disbInfo = db.prepare(`
      INSERT INTO fund_disbursements
      (disbursement_no, request_id, account_id, amount, warranty_amount, actual_amount,
       finance_id, status, remark, disbursed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'disbursed', ?, datetime('now','localtime'))
    `).run(disNo, id, account_id, finalAmount, warrantyAmount, actualAmount, finance_id, remark);

    const acct = db.prepare('SELECT * FROM repair_fund_accounts WHERE id = ?').get(account_id);
    const newBalance = Number((acct.balance - actualAmount).toFixed(2));

    db.prepare(`
      INSERT INTO balance_snapshots
      (account_id, request_id, balance_before, change_amount, balance_after, snapshot_type, reference_no)
      VALUES (?, ?, ?, ?, ?, 'disbursement', ?)
    `).run(account_id, id, acct.balance, -actualAmount, newBalance, disNo);

    db.prepare(`
      INSERT INTO fund_ledgers
      (account_id, trans_type, trans_no, request_id, debit, balance_after, remark, operator_id)
      VALUES (?, 'disbursement', ?, ?, ?, ?, ?, ?)
    `).run(account_id, disNo, id, actualAmount, newBalance, remark || '维修拨款', finance_id);

    db.prepare('UPDATE repair_fund_accounts SET balance = ? WHERE id = ?').run(newBalance, account_id);

    if (request.subject_id) {
      const year = new Date().getFullYear();
      const budget = db.prepare(
        'SELECT * FROM annual_budgets WHERE subject_id = ? AND year = ?'
      ).get(request.subject_id, year);
      if (budget) {
        db.prepare(`
          UPDATE annual_budgets
          SET used_amount = used_amount + ?, frozen_amount = MAX(frozen_amount - ?, 0)
          WHERE id = ?
        `).run(finalAmount, finalAmount, budget.id);
        db.prepare(
          "UPDATE budget_freezes SET status = 'unfrozen', unfrozen_at = datetime('now','localtime') WHERE request_id = ?"
        ).run(id);
      }
    }

    db.prepare(`
      UPDATE repair_requests
      SET is_paid = 1, paid_amount = ?, status = 'completed',
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(request.paid_amount + actualAmount, id);

    return { disbursementId: disbInfo.lastInsertRowid, disbursementNo: disNo, actualAmount, warrantyAmount };
  });

  try {
    const result = tx();
    const reconcile = rules.reconcileDisbursement(id);
    res.json({ ok: true, ...result, reconcile });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/repair-requests/:id/reconcile', (req, res) => {
  res.json(rules.reconcileDisbursement(Number(req.params.id)));
});

router.get('/fund-ledgers', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT fl.*, ra.account_name, r.request_no, u.name as operator_name
    FROM fund_ledgers fl
    JOIN repair_fund_accounts ra ON fl.account_id = ra.id
    LEFT JOIN repair_requests r ON fl.request_id = r.id
    LEFT JOIN users u ON fl.operator_id = u.id
    ORDER BY fl.created_at DESC
    LIMIT 200
  `).all();
  const normalized = rows.map(r => ({
    ...r,
    ledger_no: r.trans_no,
    amount: r.trans_type === 'disbursement' || r.trans_type === 'freeze'
      ? -Math.abs(r.debit || r.credit || 0)
      : Math.abs(r.debit || r.credit || 0)
  }));
  res.json(normalized);
});

router.get('/stats', (req, res) => {
  const db = getDb();
  const totalRequests = db.prepare('SELECT COUNT(*) as cnt FROM repair_requests').get().cnt;
  const byStatus = db.prepare('SELECT status, COUNT(*) as cnt FROM repair_requests GROUP BY status').all();
  const statusMap = {};
  byStatus.forEach(s => { statusMap[s.status] = s.cnt; });
  const totalPaid = db.prepare("SELECT COALESCE(SUM(paid_amount),0) as total FROM repair_requests WHERE is_paid = 1").get().total;
  const totalBudget = db.prepare('SELECT COALESCE(SUM(total_amount),0) as total FROM annual_budgets').get().total;
  const usedBudget = db.prepare('SELECT COALESCE(SUM(used_amount),0) as total FROM annual_budgets').get().total;
  const frozenBudget = db.prepare('SELECT COALESCE(SUM(frozen_amount),0) as total FROM annual_budgets').get().total;
  const fundBalance = db.prepare('SELECT COALESCE(SUM(balance),0) as total FROM repair_fund_accounts').get().total;

  const pendingManager = db.prepare("SELECT COUNT(*) as cnt FROM repair_requests WHERE status = 'submitted'").get().cnt;
  const pendingSupervisor = db.prepare("SELECT COUNT(*) as cnt FROM repair_requests WHERE status = 'manager_approved' OR (status = 'submitted' AND need_supervisor_review = 1)").get().cnt;
  const inConstruction = db.prepare("SELECT COUNT(*) as cnt FROM repair_requests WHERE status = 'in_construction'").get().cnt;
  const awaitingAcceptance = db.prepare("SELECT COUNT(*) as cnt FROM repair_requests WHERE status = 'awaiting_acceptance'").get().cnt;
  const accepted = db.prepare("SELECT COUNT(*) as cnt FROM repair_requests WHERE status = 'accepted'").get().cnt;
  const awaitingPayment = db.prepare("SELECT COUNT(*) as cnt FROM repair_requests WHERE status = 'accepted'").get().cnt;
  const overBudgetCount = db.prepare("SELECT COUNT(*) as cnt FROM repair_requests WHERE estimated_amount >= 10000").get().cnt;
  const supervisorReviewAmount = db.prepare("SELECT COALESCE(SUM(estimated_amount),0) as total FROM repair_requests WHERE estimated_amount >= 10000").get().total;
  const warrantyTotal = db.prepare("SELECT COALESCE(SUM(warranty_amount),0) as total FROM repair_requests WHERE is_paid = 1").get().total;
  const paidAmount = db.prepare("SELECT COALESCE(SUM(paid_amount),0) as total FROM repair_requests WHERE is_paid = 1").get().total;

  const acceptedTotal = db.prepare("SELECT COUNT(*) as cnt FROM acceptance_evidence WHERE result = 'pass'").get().cnt;
  const inspectedTotal = db.prepare("SELECT COUNT(*) as cnt FROM acceptance_evidence").get().cnt;
  const acceptanceRate = inspectedTotal > 0 ? (acceptedTotal / inspectedTotal * 100) : 0;

  const managerApproved = db.prepare("SELECT COUNT(*) as cnt FROM approval_chains WHERE approver_role = 'housing_manager' AND status = 'approved'").get().cnt;
  const supervisorApproved = db.prepare("SELECT COUNT(*) as cnt FROM approval_chains WHERE approver_role = 'supervisor' AND status = 'approved'").get().cnt;

  res.json({
    total_requests: totalRequests,
    totalRequests,
    byStatus,
    statusMap,
    totalPaid,
    totalBudget,
    usedBudget,
    budget_frozen: frozenBudget,
    budgetFrozen: frozenBudget,
    fund_balance: fundBalance,
    fundBalance,
    pending_manager: pendingManager,
    pendingManager,
    pending_supervisor: pendingSupervisor,
    pendingSupervisor,
    in_construction: inConstruction,
    inConstruction,
    awaiting_acceptance: awaitingAcceptance,
    awaitingAcceptance,
    accepted,
    awaiting_payment: awaitingPayment,
    awaitingPayment,
    over_budget_count: overBudgetCount,
    over_budgetCount: overBudgetCount,
    supervisor_review_amount: supervisorReviewAmount,
    supervisorReviewAmount: supervisorReviewAmount,
    warranty_total: warrantyTotal,
    warrantyTotal,
    paid_amount: paidAmount,
    paidAmount,
    acceptance_rate: acceptanceRate,
    acceptanceRate,
    manager_approved: managerApproved,
    managerApproved,
    supervisor_approved: supervisorApproved,
    supervisorApproved
  });
});

module.exports = router;
