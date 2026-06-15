const db = require('./db');
const { getDb } = db;

const SUPERVISOR_REVIEW_THRESHOLD = 10000;
const WARRANTY_RATIO = 0.05;

function checkTenantArrears(tenantId) {
  const db = getDb();
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) return { passed: false, reason: '租户不存在' };
  return {
    passed: true,
    hasArrears: !!tenant.has_arrears,
    arrearsAmount: tenant.arrears_amount || 0,
    arrearsDays: tenant.arrears_days || 0,
    tenant
  };
}

function validateRepairTypeForArrears(tenantId, repairTypeId) {
  const db = getDb();
  const arrearsCheck = checkTenantArrears(tenantId);
  if (!arrearsCheck.passed) return arrearsCheck;

  const repairType = db.prepare('SELECT * FROM repair_types WHERE id = ?').get(repairTypeId);
  if (!repairType) return { passed: false, reason: '维修类型不存在' };

  if (arrearsCheck.hasArrears && !repairType.is_safety) {
    return {
      passed: false,
      reason: `租户存在欠租（欠${arrearsCheck.arrearsAmount}元，${arrearsCheck.arrearsDays}天），只能提交安全类维修申请`,
      hasArrears: true,
      isSafety: false
    };
  }

  return {
    passed: true,
    hasArrears: arrearsCheck.hasArrears,
    isSafety: !!repairType.is_safety,
    arrearsAmount: arrearsCheck.arrearsAmount
  };
}

function checkBudgetAvailability(subjectId, amount, year) {
  const db = getDb();
  const budgetYear = year || new Date().getFullYear();
  const budget = db.prepare(
    'SELECT * FROM annual_budgets WHERE subject_id = ? AND year = ?'
  ).get(subjectId, budgetYear);

  if (!budget) return { passed: false, reason: '该费用科目本年度无预算' };

  const available = budget.total_amount - budget.used_amount - budget.frozen_amount;
  const enough = available >= amount;

  return {
    passed: enough,
    reason: enough ? null : `预算不足，可用余额：${available.toFixed(2)}元，申请金额：${amount.toFixed(2)}元`,
    budget,
    available,
    total: budget.total_amount,
    used: budget.used_amount,
    frozen: budget.frozen_amount
  };
}

function needSupervisorReview(amount) {
  return amount >= SUPERVISOR_REVIEW_THRESHOLD;
}

function checkAcceptanceBeforeDisbursement(requestId) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(requestId);
  if (!request) return { passed: false, reason: '维修申请不存在' };

  const acceptance = db.prepare(
    "SELECT * FROM acceptance_evidence WHERE request_id = ? AND result = 'pass'"
  ).get(requestId);

  if (!acceptance) {
    return { passed: false, reason: '维修尚未通过验收，不能拨款' };
  }

  return { passed: true, acceptance, request };
}

function checkPriceChangeAfterPayment(requestId, newAmount) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(requestId);
  if (!request) return { passed: false, reason: '维修申请不存在' };

  if (request.is_paid && request.final_amount !== newAmount) {
    return {
      passed: false,
      reason: `已拨款${request.paid_amount}元，拨款后不能再修改价格（当前定价：${request.final_amount}元）`
    };
  }
  return { passed: true };
}

function compareQuotations(requestId) {
  const db = getDb();
  const quotations = db.prepare(`
    SELECT q.*, t.team_name, t.qualification_level, t.qualification_valid_until
    FROM quotations q
    JOIN construction_teams t ON q.team_id = t.id
    WHERE q.request_id = ?
    ORDER BY q.quoted_amount ASC
  `).all(requestId);

  if (quotations.length === 0) {
    return { passed: false, reason: '暂无施工队报价', count: 0 };
  }

  const lowest = quotations[0];
  const highest = quotations[quotations.length - 1];
  const avg = quotations.reduce((s, q) => s + q.quoted_amount, 0) / quotations.length;

  return {
    passed: quotations.length >= 2,
    reason: quotations.length < 2 ? `报价不足2家，当前只有${quotations.length}家报价` : null,
    count: quotations.length,
    quotations,
    lowest,
    highest,
    avg,
    priceSpread: highest.quoted_amount - lowest.quoted_amount,
    spreadRatio: ((highest.quoted_amount - lowest.quoted_amount) / lowest.quoted_amount * 100).toFixed(2) + '%'
  };
}

function checkTeamQualification(teamId) {
  const db = getDb();
  const team = db.prepare('SELECT * FROM construction_teams WHERE id = ?').get(teamId);
  if (!team) return { passed: false, reason: '施工队不存在' };

  if (team.status !== 'active') {
    return { passed: false, reason: `施工队状态为：${team.status}，不可使用` };
  }

  let validQual = true;
  let qualMsg = null;
  if (team.qualification_valid_until) {
    const expire = new Date(team.qualification_valid_until);
    if (expire < new Date()) {
      validQual = false;
      qualMsg = `资质已于${team.qualification_valid_until}过期`;
    }
  }

  return {
    passed: validQual,
    reason: qualMsg,
    team,
    level: team.qualification_level
  };
}

function verifyInvoicePlaceholder(invoiceId) {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!invoice) return { passed: false, reason: '发票不存在' };

  return {
    passed: true,
    invoice,
    verified: !!invoice.is_verified,
    placeholder: invoice.verify_placeholder,
    note: invoice.is_verified ? '发票已通过验真' : '发票验真占位 - 实际系统中此处调用税务接口'
  };
}

function calculateWarrantyAmount(amount) {
  return Number((amount * WARRANTY_RATIO).toFixed(2));
}

function checkFundBalance(accountId, amount) {
  const db = getDb();
  const account = db.prepare('SELECT * FROM repair_fund_accounts WHERE id = ?').get(accountId);
  if (!account) return { passed: false, reason: '资金账户不存在' };

  const available = account.balance - account.frozen_amount;
  return {
    passed: available >= amount,
    reason: available >= amount ? null : `资金账户余额不足，可用：${available.toFixed(2)}元，需拨款：${amount.toFixed(2)}元`,
    account,
    available,
    balance: account.balance,
    frozen: account.frozen_amount
  };
}

function reconcileDisbursement(requestId) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM repair_requests WHERE id = ?').get(requestId);
  if (!request) return { matched: false, reason: '维修申请不存在' };

  const disbursements = db.prepare(
    'SELECT * FROM fund_disbursements WHERE request_id = ? AND status = ?'
  ).all(requestId, 'disbursed');

  const ledgerEntries = db.prepare(
    "SELECT * FROM fund_ledgers WHERE request_id = ? AND trans_type = 'disbursement'"
  ).all(requestId);

  const totalDisbursed = disbursements.reduce((s, d) => s + d.actual_amount, 0);
  const totalLedger = ledgerEntries.reduce((s, l) => s + l.debit, 0);

  const matched = Math.abs(totalDisbursed - totalLedger) < 0.01 &&
                  Math.abs(totalDisbursed - (request.paid_amount || 0)) < 0.01;

  return {
    matched,
    totalDisbursed,
    totalLedger,
    requestPaid: request.paid_amount || 0,
    disbursementsCount: disbursements.length,
    ledgerCount: ledgerEntries.length,
    reason: matched ? null : `对账不一致：拨款${totalDisbursed}元，台账${totalLedger}元，申请已付${request.paid_amount || 0}元`
  };
}

module.exports = {
  SUPERVISOR_REVIEW_THRESHOLD,
  WARRANTY_RATIO,
  checkTenantArrears,
  validateRepairTypeForArrears,
  checkBudgetAvailability,
  needSupervisorReview,
  checkAcceptanceBeforeDisbursement,
  checkPriceChangeAfterPayment,
  compareQuotations,
  checkTeamQualification,
  verifyInvoicePlaceholder,
  calculateWarrantyAmount,
  checkFundBalance,
  reconcileDisbursement
};
