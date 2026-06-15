const assert = require('assert');
const path = require('path');
const db = require('../src/db');
const rules = require('../src/rules');

let testResults = [];

function log(name, passed, detail) {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}${detail ? ' - ' + detail : ''}`);
  testResults.push({ name, passed, detail });
}

async function runTests() {
  console.log('========== 公租房维修资金系统 - 集成测试 ==========\n');

  await db.init();
  const dbi = db.getDb();

  console.log('--- 1. 基础数据验证 ---');

  const users = dbi.prepare('SELECT * FROM users').all();
  log('用户数据存在', users.length >= 6, `共 ${users.length} 个用户`);

  const tenants = dbi.prepare('SELECT * FROM tenants').all();
  log('租户数据存在', tenants.length >= 2, `共 ${tenants.length} 个租户`);

  const normalTenant = tenants.find(t => !t.has_arrears);
  const arrearsTenant = tenants.find(t => t.has_arrears);
  log('正常租户存在', !!normalTenant);
  log('欠租租户存在', !!arrearsTenant, arrearsTenant ? `欠租¥${arrearsTenant.arrears_amount}, ${arrearsTenant.arrears_days}天` : '');

  const repairTypes = dbi.prepare('SELECT * FROM repair_types').all();
  const safetyTypes = repairTypes.filter(t => t.is_safety);
  const normalTypes = repairTypes.filter(t => !t.is_safety);
  log('维修类型数据', repairTypes.length >= 6, `安全类${safetyTypes.length}个, 普通类${normalTypes.length}个`);

  const budgets = dbi.prepare('SELECT * FROM annual_budgets').all();
  log('年度预算存在', budgets.length >= 2, `共 ${budgets.length} 个预算科目`);

  const accounts = dbi.prepare('SELECT * FROM repair_fund_accounts').all();
  log('资金账户存在', accounts.length >= 2, `总余额¥${accounts.reduce((s, a) => s + a.balance, 0).toFixed(2)}`);

  const teams = dbi.prepare('SELECT * FROM construction_teams').all();
  log('施工队数据存在', teams.length >= 3, `共 ${teams.length} 个施工队`);

  console.log('\n--- 2. 欠租限制测试 ---');

  if (arrearsTenant && safetyTypes.length > 0 && normalTypes.length > 0) {
    const arrearsSafetyCheck = rules.validateRepairTypeForArrears(arrearsTenant.id, safetyTypes[0].id);
    log('欠租租户提交安全类维修 - 允许', arrearsSafetyCheck.passed === true);

    const arrearsNormalCheck = rules.validateRepairTypeForArrears(arrearsTenant.id, normalTypes[0].id);
    log('欠租租户提交普通类维修 - 拒绝', arrearsNormalCheck.passed === false, arrearsNormalCheck.reason);

    if (normalTenant) {
      const normalNormalCheck = rules.validateRepairTypeForArrears(normalTenant.id, normalTypes[0].id);
      log('正常租户提交普通类维修 - 允许', normalNormalCheck.passed === true);
    }
  }

  console.log('\n--- 3. 超预算复核测试 ---');

  log('¥5000无需主管复核', rules.needSupervisorReview(5000) === false);
  log('¥9999无需主管复核', rules.needSupervisorReview(9999) === false);
  log('¥10000需要主管复核', rules.needSupervisorReview(10000) === true);
  log('¥15000需要主管复核', rules.needSupervisorReview(15000) === true);

  if (budgets.length > 0) {
    const budgetCheck1 = rules.checkBudgetAvailability(budgets[0].subject_id, 100, budgets[0].year);
    log('预算充足检查通过', budgetCheck1.passed === true);
    const budgetCheck2 = rules.checkBudgetAvailability(budgets[0].subject_id, 999999999, budgets[0].year);
    log('预算不足检查失败', budgetCheck2.passed === false);
  }

  console.log('\n--- 4. 施工队报价比价测试 ---');

  const testTeamIds = teams.slice(0, 3).map(t => t.id);
  const qualifyChecks = testTeamIds.map(id => rules.checkTeamQualification(id));
  log('施工队资质校验', qualifyChecks.every(c => c.passed === true));

  console.log('\n--- 5. 质保金计算测试 ---');

  const warranty5k = rules.calculateWarrantyAmount(5000);
  log('¥5000的质保金5% = ¥250', Math.abs(warranty5k - 250) < 0.01, `计算结果: ¥${warranty5k}`);

  const warranty10k = rules.calculateWarrantyAmount(10000);
  log('¥10000的质保金5% = ¥500', Math.abs(warranty10k - 500) < 0.01, `计算结果: ¥${warranty10k}`);

  const warranty9999 = rules.calculateWarrantyAmount(9999.99);
  log('¥9999.99的质保金5% = ¥499.9995 → ¥500.00', Math.abs(warranty9999 - 500.00) < 0.01, `计算结果: ¥${warranty9999}`);

  console.log('\n--- 6. 资金账户余额检查 ---');

  if (accounts.length > 0) {
    const fundCheck1 = rules.checkFundBalance(accounts[0].id, 100);
    log('资金充足检查通过', fundCheck1.passed === true);
    const fundCheck2 = rules.checkFundBalance(accounts[0].id, 999999999);
    log('资金不足检查失败', fundCheck2.passed === false);
  }

  console.log('\n--- 7. 发票验真占位测试 ---');

  const invcInfo = dbi.prepare(`
    INSERT INTO invoices (request_id, invoice_no, invoice_amount)
    VALUES (0, 'TEST-INV-001', 1000.00)
  `).run();
  const invcVerify = rules.verifyInvoicePlaceholder(invcInfo.lastInsertRowid);
  log('发票验真占位接口', invcVerify.passed === true && invcVerify.note.length > 0);

  console.log('\n--- 8. 全流程端到端测试 ---');

  let testRequestId = null;

  try {
    const e = db.exec;
    const p = dbi.prepare;

    if (normalTenant && safetyTypes.length > 0) {
      const subjectId = budgets.length > 0 ? budgets[0].subject_id : null;
      const estimatedAmount = 15000;

      const checkResult = rules.validateRepairTypeForArrears(normalTenant.id, safetyTypes[0].id);
      assert(checkResult.passed, '正常租户提交安全类维修应通过');

      const tx = dbi.transaction(() => {
        const reqInfo = p(`
          INSERT INTO repair_requests
          (request_no, tenant_id, repair_type_id, subject_id, title, description,
           room_number, urgency, estimated_amount, status, version,
           need_supervisor_review, current_approver)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 1, ?, ?)
        `).run(
          'TEST' + Date.now(), normalTenant.id, safetyTypes[0].id, subjectId,
          '集成测试-电路故障', '测试用申请', normalTenant.room_number,
          'normal', estimatedAmount,
          rules.needSupervisorReview(estimatedAmount) ? 1 : 0,
          rules.needSupervisorReview(estimatedAmount) ? 'supervisor' : 'housing_manager'
        );
        const rid = reqInfo.lastInsertRowid;

        p(`
          INSERT INTO request_versions (request_id, version, data_json, change_reason)
          VALUES (?, ?, ?, ?)
        `).run(rid, 1, JSON.stringify({ id: rid }), '测试创建');

        p(`
          INSERT INTO approval_chains (request_id, approver_role, step, status)
          VALUES (?, 'housing_manager', 1, 'pending')
        `).run(rid);

        if (rules.needSupervisorReview(estimatedAmount)) {
          p(`
            INSERT INTO approval_chains (request_id, approver_role, step, status)
            VALUES (?, 'supervisor', 2, 'pending')
          `).run(rid);
        }

        ['approved', 'construction_started', 'construction_completed', 'accepted'].forEach(step => {
          p(`
            INSERT INTO construction_progress (request_id, step, status)
            VALUES (?, ?, 'pending')
          `).run(rid, step);
        });

        return rid;
      });

      testRequestId = tx();
      log('创建维修申请成功', testRequestId > 0, `申请ID: ${testRequestId}`);

      const createdReq = p('SELECT * FROM repair_requests WHERE id = ?').get(testRequestId);
      log('创建≥1万的申请自动标记需主管复核', createdReq.need_supervisor_review === 1);

      const approvalCount = p('SELECT COUNT(*) as cnt FROM approval_chains WHERE request_id = ?').get(testRequestId).cnt;
      log('超预算申请创建两级审批链', approvalCount === 2, `审批级数: ${approvalCount}`);

      const priceCheckBefore = rules.checkPriceChangeAfterPayment(testRequestId, 16000);
      log('拨款前可改价', priceCheckBefore.passed === true);

      if (teams.length >= 2) {
        p('INSERT INTO quotations (request_id, team_id, quoted_amount) VALUES (?, ?, ?)')
          .run(testRequestId, teams[0].id, 14500);
        p('INSERT INTO quotations (request_id, team_id, quoted_amount) VALUES (?, ?, ?)')
          .run(testRequestId, teams[1].id, 15200);
        p('INSERT INTO quotations (request_id, team_id, quoted_amount) VALUES (?, ?, ?)')
          .run(testRequestId, teams[2].id, 14800);

        const compare = rules.compareQuotations(testRequestId);
        log('施工队报价比价分析', compare.passed === true && compare.count === 3,
          `最低价¥${compare.lowest.quoted_amount}, 最高价¥${compare.highest.quoted_amount}, 价差${compare.spreadRatio}`);

        p('UPDATE quotations SET is_selected = 1 WHERE id = (SELECT MIN(id) FROM quotations WHERE request_id = ?)')
          .run(testRequestId);
        p('UPDATE repair_requests SET final_amount = 14500, warranty_amount = 725, status = ? WHERE id = ?')
          .run('approved', testRequestId);
      }

      const acceptCheckBefore = rules.checkAcceptanceBeforeDisbursement(testRequestId);
      log('未验收前禁止拨款', acceptCheckBefore.passed === false, acceptCheckBefore.reason);

      p(`
        INSERT INTO acceptance_evidence (request_id, inspector_id, result, quality_level, remark)
        VALUES (?, 0, 'pass', 'good', '集成测试验收通过')
      `).run(testRequestId);
      p("UPDATE repair_requests SET status = 'accepted' WHERE id = ?").run(testRequestId);

      const acceptCheckAfter = rules.checkAcceptanceBeforeDisbursement(testRequestId);
      log('验收通过后允许拨款', acceptCheckAfter.passed === true);

      if (accounts.length > 0) {
        const accountId = accounts[0].id;
        const finalAmt = createdReq.final_amount || 14500;
        const warrantyAmt = rules.calculateWarrantyAmount(finalAmt);
        const actualAmt = Number((finalAmt - warrantyAmt).toFixed(2));
        const balBefore = p('SELECT balance FROM repair_fund_accounts WHERE id = ?').get(accountId).balance;

        const disbNo = 'FD' + Date.now();
        p(`
          INSERT INTO fund_disbursements
          (disbursement_no, request_id, account_id, amount, warranty_amount, actual_amount, status, disbursed_at)
          VALUES (?, ?, ?, ?, ?, ?, 'disbursed', datetime('now','localtime'))
        `).run(disbNo, testRequestId, accountId, finalAmt, warrantyAmt, actualAmt);

        const newBalance = Number((balBefore - actualAmt).toFixed(2));
        p(`
          INSERT INTO balance_snapshots
          (account_id, request_id, balance_before, change_amount, balance_after, snapshot_type, reference_no)
          VALUES (?, ?, ?, ?, ?, 'disbursement', ?)
        `).run(accountId, testRequestId, balBefore, -actualAmt, newBalance, disbNo);

        p(`
          INSERT INTO fund_ledgers
          (account_id, trans_type, trans_no, request_id, debit, balance_after, remark)
          VALUES (?, 'disbursement', ?, ?, ?, ?, '测试拨款')
        `).run(accountId, disbNo, testRequestId, actualAmt, newBalance);

        p('UPDATE repair_fund_accounts SET balance = ? WHERE id = ?').run(newBalance, accountId);
        p(`
          UPDATE repair_requests
          SET is_paid = 1, paid_amount = paid_amount + ?, status = 'completed'
          WHERE id = ?
        `).run(actualAmt, testRequestId);

        const reconcile = rules.reconcileDisbursement(testRequestId);
        log('拨款对账通过', reconcile.matched === true,
          `拨款¥${reconcile.totalDisbursed}, 台账¥${reconcile.totalLedger}, 申请已付¥${reconcile.requestPaid}`);

        const priceCheckAfter = rules.checkPriceChangeAfterPayment(testRequestId, 16000);
        log('拨款后禁止改价', priceCheckAfter.passed === false, priceCheckAfter.reason);
      }
    }
  } catch (err) {
    console.error('端到端测试异常:', err.message);
    log('端到端全流程', false, err.message);
  }

  console.log('\n--- 9. 规则引擎完整性测试 ---');

  const expectedRules = [
    'checkTenantArrears', 'validateRepairTypeForArrears', 'checkBudgetAvailability',
    'needSupervisorReview', 'checkAcceptanceBeforeDisbursement', 'checkPriceChangeAfterPayment',
    'compareQuotations', 'checkTeamQualification', 'verifyInvoicePlaceholder',
    'calculateWarrantyAmount', 'checkFundBalance', 'reconcileDisbursement'
  ];
  const ruleCoverage = expectedRules.map(name => typeof rules[name] === 'function');
  log('12个核心规则函数全部导出', ruleCoverage.every(x => x),
    `${ruleCoverage.filter(x => x).length}/${expectedRules.length}`);

  log('主管复核阈值 = ¥10,000', rules.SUPERVISOR_REVIEW_THRESHOLD === 10000);
  log('质保金比例 = 5%', rules.WARRANTY_RATIO === 0.05);

  console.log('\n========== 测试结果汇总 ==========');
  const passed = testResults.filter(r => r.passed).length;
  const total = testResults.length;
  const rate = ((passed / total) * 100).toFixed(1);
  console.log(`总计: ${total} 项, 通过: ${passed} 项, 失败: ${total - passed} 项, 通过率: ${rate}%`);

  if (passed < total) {
    console.log('\n失败项:');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.detail || ''}`);
    });
    process.exit(1);
  } else {
    console.log('\n✅ 所有集成测试通过!');
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
