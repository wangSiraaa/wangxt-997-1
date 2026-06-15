const db = require('./db');
const { getDb } = db;

const SUPERVISOR_REVIEW_THRESHOLD = 10000;
const WARRANTY_RATIO = 0.05;
const EMERGENCY_APPROVAL_DAYS = 3;
const TEAM_ABNORMAL_KEY_COMPARISON_THRESHOLD = 2;
const QUOTE_ABNORMAL_RATIO = 0.15;

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

function isEmergencyRepairType(repairTypeId) {
  const dbi = getDb();
  const rt = dbi.prepare('SELECT * FROM repair_types WHERE id = ?').get(repairTypeId);
  return rt ? !!rt.is_safety : false;
}

function validateEmergencyRepair(tenantId, repairTypeId, estimatedAmount) {
  const dbi = getDb();
  if (!isEmergencyRepairType(repairTypeId)) {
    return { passed: false, reason: '该维修类型不属于安全紧急维修' };
  }
  if (!estimatedAmount || estimatedAmount <= 0) {
    return { passed: false, reason: '紧急抢修必须预估金额' };
  }
  const tenant = dbi.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) return { passed: false, reason: '租户不存在' };
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + EMERGENCY_APPROVAL_DAYS);
  return {
    passed: true,
    isEmergency: true,
    approvalDeadline: deadline.toISOString().split('T')[0],
    frozenAmount: Number(estimatedAmount.toFixed(2))
  };
}

function checkEmergencyApprovalDeadline(requestId) {
  const dbi = getDb();
  const req = dbi.prepare('SELECT * FROM repair_requests WHERE id = ?').get(requestId);
  if (!req || !req.is_emergency_repair) {
    return { passed: true, note: '非紧急维修，无需时限检查' };
  }
  if (!req.approval_deadline) {
    return { passed: false, overdue: true, reason: '紧急维修未设置审批时限' };
  }
  const now = new Date();
  const deadline = new Date(req.approval_deadline);
  const diffMs = deadline - now;
  const diffHours = diffMs / (1000 * 60 * 60);
  return {
    passed: diffHours > 0,
    overdue: diffHours <= 0,
    hoursLeft: Math.round(diffHours),
    daysLeft: Math.ceil(diffHours / 24),
    deadline: req.approval_deadline,
    reason: diffHours <= 0
      ? `紧急维修审批已超时 ${Math.abs(Math.ceil(diffHours/24))} 天`
      : `距离审批截止还有 ${Math.ceil(diffHours/24)} 天`
  };
}

function checkTeamKeyComparison(teamId) {
  const dbi = getDb();
  const team = dbi.prepare('SELECT * FROM construction_teams WHERE id = ?').get(teamId);
  if (!team) return { passed: false, reason: '施工队不存在' };
  const warrantyRepairs = Number(team.warranty_repair_count || 0);
  const abnormalQuotes = Number(team.abnormal_quote_count || 0);
  const totalAbnormal = warrantyRepairs + abnormalQuotes;
  const needsKeyComparison = totalAbnormal >= TEAM_ABNORMAL_KEY_COMPARISON_THRESHOLD;
  const blacklisted = dbi.prepare(
    "SELECT * FROM maintenance_blacklist WHERE team_id = ? AND status = 'active'"
  ).get(teamId);
  return {
    passed: true,
    needsKeyComparison: !!needsKeyComparison,
    blacklisted: !!blacklisted,
    blacklistInfo: blacklisted,
    totalAbnormal,
    warrantyRepairs,
    abnormalQuotes,
    reason: blacklisted
      ? '施工队在维保黑名单中'
      : needsKeyComparison
      ? `施工队近 ${totalAbnormal} 次异常（质保返修 ${warrantyRepairs} 次，报价异常 ${abnormalQuotes} 次），需进入重点比价`
      : null
  };
}

function recordTeamAbnormal(teamId, abnormalType, description, amount, operatorId, requestId) {
  const dbi = getDb();
  const team = dbi.prepare('SELECT * FROM construction_teams WHERE id = ?').get(teamId);
  if (!team) return { passed: false, reason: '施工队不存在' };
  dbi.prepare(`
    INSERT INTO team_abnormal_records (team_id, request_id, abnormal_type, description, amount, operator_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(teamId, requestId || null, abnormalType, description, amount || null, operatorId || null);
  if (abnormalType === 'warranty_repair') {
    dbi.prepare('UPDATE construction_teams SET warranty_repair_count = warranty_repair_count + 1, last_abnormal_at = datetime(\'now\',\'localtime\') WHERE id = ?')
      .run(teamId);
  } else if (abnormalType === 'abnormal_quote') {
    dbi.prepare('UPDATE construction_teams SET abnormal_quote_count = abnormal_quote_count + 1, last_abnormal_at = datetime(\'now\',\'localtime\') WHERE id = ?')
      .run(teamId);
  } else {
    dbi.prepare('UPDATE construction_teams SET last_abnormal_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(teamId);
  }
  const afterCheck = checkTeamKeyComparison(teamId);
  return { passed: true, teamAbnormal: afterCheck };
}

function checkTeamBlacklisted(teamId) {
  const dbi = getDb();
  const active = dbi.prepare(
    "SELECT * FROM maintenance_blacklist WHERE team_id = ? AND status = 'active'"
  ).get(teamId);
  return {
    passed: !active,
    blacklisted: !!active,
    blacklist: active || null,
    reason: active ? `施工队在黑名单中：${active.reason}` : null
  };
}

function checkMaterialDocsComplete(requestId) {
  const dbi = getDb();
  const st = dbi.prepare(
    "SELECT * FROM staged_acceptance WHERE request_id = ? AND stage_name = 'material_docs'"
  ).get(requestId);
  const ae = dbi.prepare('SELECT * FROM acceptance_evidence WHERE request_id = ?').get(requestId);
  const complete = (st && st.passed) || (ae && ae.material_docs_complete);
  return {
    passed: !!complete,
    complete: !!complete,
    remark: ae ? ae.material_docs_remark : null,
    reason: complete ? null : '材料单据不齐全，未通过材料验收'
  };
}

function checkInvoicesVerified(requestId) {
  const dbi = getDb();
  const invoices = dbi.prepare('SELECT * FROM invoices WHERE request_id = ?').all(requestId);
  const st = dbi.prepare(
    "SELECT * FROM staged_acceptance WHERE request_id = ? AND stage_name = 'invoice_verify'"
  ).get(requestId);
  if (invoices.length === 0) {
    return { passed: false, reason: '未上传发票，无法验真' };
  }
  const allVerified = (st && st.passed) || invoices.every(i => i.is_verified);
  const ae = dbi.prepare('SELECT * FROM acceptance_evidence WHERE request_id = ?').get(requestId);
  return {
    passed: !!allVerified,
    allVerified: !!allVerified,
    total: invoices.length,
    verifiedCount: invoices.filter(i => i.is_verified).length,
    remark: ae ? ae.invoices_remark : null,
    reason: allVerified ? null : '存在未通过验真的发票'
  };
}

function checkWarrantyLocked(requestId) {
  const dbi = getDb();
  const wl = dbi.prepare(
    "SELECT * FROM warranty_locks WHERE request_id = ? AND status = 'locked'"
  ).get(requestId);
  const st = dbi.prepare(
    "SELECT * FROM staged_acceptance WHERE request_id = ? AND stage_name = 'warranty_lock'"
  ).get(requestId);
  const ae = dbi.prepare('SELECT * FROM acceptance_evidence WHERE request_id = ?').get(requestId);
  const locked = (st && st.passed) || !!wl || (ae && ae.warranty_locked);
  return {
    passed: !!locked,
    locked: !!locked,
    lock: wl || null,
    remark: ae ? ae.warranty_lock_remark : null,
    reason: locked ? null : '质保金尚未锁定'
  };
}

function checkStagedAcceptanceForPayment(requestId) {
  const dbi = getDb();
  const req = dbi.prepare('SELECT * FROM repair_requests WHERE id = ?').get(requestId);
  if (!req) return { passed: false, reason: '维修申请不存在' };

  const mainBody = dbi.prepare(
    "SELECT * FROM staged_acceptance WHERE request_id = ? AND stage_name = 'main_body'"
  ).get(requestId);
  const ae = dbi.prepare('SELECT * FROM acceptance_evidence WHERE request_id = ?').get(requestId);
  const mainPassed = (mainBody && mainBody.passed) || (ae && ae.main_body_passed) || (ae && ae.result === 'pass');
  if (!mainPassed) {
    return { passed: false, reason: '主体工程未通过验收' };
  }
  const material = checkMaterialDocsComplete(requestId);
  const invoice = checkInvoicesVerified(requestId);
  const warranty = checkWarrantyLocked(requestId);
  const allPassed = material.passed && invoice.passed && warranty.passed;
  return {
    passed: allPassed,
    mainBody: { passed: !!mainPassed },
    materialDocs: material,
    invoices: invoice,
    warranty: warranty,
    allowFinalPayment: !!allPassed,
    reason: allPassed ? null :
      `尾款放行前置条件未满足：${[
        !material.passed ? '材料单不齐' : null,
        !invoice.passed ? '发票未验真' : null,
        !warranty.passed ? '质保金未锁定' : null
      ].filter(Boolean).join('、')}`
  };
}

function checkCrossYearBudget(subjectId, amount, fromYear, toYear) {
  const dbi = getDb();
  const budgetNow = dbi.prepare(
    'SELECT * FROM annual_budgets WHERE subject_id = ? AND year = ?'
  ).get(subjectId, fromYear);
  const budgetNext = dbi.prepare(
    'SELECT * FROM annual_budgets WHERE subject_id = ? AND year = ?'
  ).get(subjectId, toYear);
  const availNow = budgetNow
    ? budgetNow.total_amount - budgetNow.used_amount - budgetNow.frozen_amount
    : 0;
  const availNext = budgetNext
    ? budgetNext.total_amount - budgetNext.used_amount - budgetNext.frozen_amount
    : 0;
  const useNow = Math.min(availNow, amount);
  const useNext = Number((amount - useNow).toFixed(2));
  const crossYear = useNext > 0;
  const canCover = useNow + availNext >= amount;
  return {
    passed: canCover,
    crossYear: !!crossYear,
    fromYear,
    toYear,
    useCurrentYear: useNow,
    useNextYear: crossYear ? useNext : 0,
    availableCurrent: availNow,
    availableNext: availNext,
    reason: canCover ? null : '跨年度预算合计不足以覆盖本次申请'
  };
}

function validateWithdrawRequest(requestId, operatorRole) {
  const dbi = getDb();
  const req = dbi.prepare('SELECT * FROM repair_requests WHERE id = ?').get(requestId);
  if (!req) return { passed: false, reason: '申请不存在' };
  if (req.withdrawn) return { passed: false, reason: '该申请已被撤回' };
  if (req.is_paid) return { passed: false, reason: '已完成拨款，不能撤回' };
  if (req.status === 'completed') return { passed: false, reason: '申请已完成，不能撤回' };
  const inFinalStage = ['in_construction','awaiting_acceptance','accepted'].includes(req.status);
  if (inFinalStage && operatorRole !== 'supervisor') {
    return { passed: false, reason: '施工阶段后只能由主管撤回' };
  }
  return {
    passed: true,
    allowedRole: operatorRole,
    currentStatus: req.status
  };
}

function validateDisbursementReversal(disbursementId, reversalType) {
  const dbi = getDb();
  const disb = dbi.prepare('SELECT * FROM fund_disbursements WHERE id = ?').get(disbursementId);
  if (!disb) return { passed: false, reason: '拨款记录不存在' };
  if (disb.status !== 'disbursed') {
    return { passed: false, reason: '该拨款尚未完成，不能冲正' };
  }
  const existsReversed = dbi.prepare(
    "SELECT * FROM disbursement_reversals WHERE original_disbursement_id = ? AND status IN ('pending','completed')"
  ).get(disbursementId);
  if (existsReversed) {
    return { passed: false, reason: '该拨款已存在冲正/补单' };
  }
  return {
    passed: true,
    disbursement: disb,
    reversalType
  };
}

function checkAbnormalQuote(quotedAmount, referenceAmount) {
  if (!referenceAmount || referenceAmount === 0) return { passed: true };
  const diffRatio = Math.abs(quotedAmount - referenceAmount) / referenceAmount;
  const isAbnormal = diffRatio > QUOTE_ABNORMAL_RATIO;
  return {
    passed: true,
    isAbnormal,
    diffRatio,
    reason: isAbnormal
      ? `报价偏离参考价 ${(diffRatio*100).toFixed(2)}%，超过阈值 ${(QUOTE_ABNORMAL_RATIO*100)}%`
      : null
  };
}

module.exports = {
  SUPERVISOR_REVIEW_THRESHOLD,
  WARRANTY_RATIO,
  EMERGENCY_APPROVAL_DAYS,
  TEAM_ABNORMAL_KEY_COMPARISON_THRESHOLD,
  QUOTE_ABNORMAL_RATIO,
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
  reconcileDisbursement,
  isEmergencyRepairType,
  validateEmergencyRepair,
  checkEmergencyApprovalDeadline,
  checkTeamKeyComparison,
  recordTeamAbnormal,
  checkTeamBlacklisted,
  checkMaterialDocsComplete,
  checkInvoicesVerified,
  checkWarrantyLocked,
  checkStagedAcceptanceForPayment,
  checkCrossYearBudget,
  validateWithdrawRequest,
  validateDisbursementReversal,
  checkAbnormalQuote
};
