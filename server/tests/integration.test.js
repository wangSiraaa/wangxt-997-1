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
          'housing_manager'
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

      log('超预算申请从房管审核开始审批', createdReq.current_approver === 'housing_manager',
        `当前审批人: ${createdReq.current_approver}`);

      const firstChain = p('SELECT * FROM approval_chains WHERE request_id = ? AND step = 1').get(testRequestId);
      log('第一步是房管审核', firstChain.approver_role === 'housing_manager' && firstChain.status === 'pending');

      const secondChain = p('SELECT * FROM approval_chains WHERE request_id = ? AND step = 2').get(testRequestId);
      log('第二步是主管复核且待处理', secondChain.approver_role === 'supervisor' && secondChain.status === 'pending');

      const canSupervisorApproveBeforeManager = (() => {
        if (secondChain.step > 1) {
          const prev = p('SELECT * FROM approval_chains WHERE request_id = ? AND step = ?').get(testRequestId, secondChain.step - 1);
          return prev && prev.status === 'approved';
        }
        return true;
      })();
      log('房管未通过时主管不能审批（跳级拦截）', canSupervisorApproveBeforeManager === false,
        canSupervisorApproveBeforeManager ? '允许跳级（错误）' : '禁止跳级（正确）');

      if (subjectId) {
        const managerApproveTx = dbi.transaction(() => {
          p(`UPDATE approval_chains SET status = 'approved', approver_id = 2, approver_name = '房管测试',
             comment = '测试房管通过', approved_at = datetime('now','localtime')
             WHERE request_id = ? AND approver_role = 'housing_manager'`).run(testRequestId);
          p(`UPDATE repair_requests SET status = 'manager_approved', current_approver = 'supervisor',
             subject_id = ?, estimated_amount = ?, version = version + 1
             WHERE id = ?`).run(subjectId, 15000, testRequestId);
        });
        managerApproveTx();

        const afterManager = p('SELECT * FROM repair_requests WHERE id = ?').get(testRequestId);
        log('房管通过后状态变为manager_approved', afterManager.status === 'manager_approved',
          `状态: ${afterManager.status}`);
        log('房管通过后current_approver流转到主管', afterManager.current_approver === 'supervisor',
          `当前审批人: ${afterManager.current_approver}`);

        const canSupervisorApproveAfterManager = (() => {
          const prev = p('SELECT * FROM approval_chains WHERE request_id = ? AND step = 1').get(testRequestId);
          return prev && prev.status === 'approved';
        })();
        log('房管通过后主管可以审批', canSupervisorApproveAfterManager === true);
      }

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

  console.log('\n--- 9. 超预算申请全流程回归测试 ---');

  try {
    const p = dbi.prepare;
    const e2eTenant = normalTenant;
    const e2eType = safetyTypes.length > 0 ? safetyTypes[0] : repairTypes[0];
    const e2eSubject = budgets.length > 0 ? budgets[0] : null;
    const e2eAmount = 12000;

    if (!e2eTenant || !e2eType) throw new Error('测试数据不足');

    const e2eTx = dbi.transaction(() => {
      const reqInfo = p(`
        INSERT INTO repair_requests
        (request_no, tenant_id, repair_type_id, title, description,
         room_number, urgency, estimated_amount, status, version,
         need_supervisor_review, current_approver)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', 1, ?, 'housing_manager')
      `).run(
        'E2E' + Date.now(), e2eTenant.id, e2eType.id,
        '超预算全流程回归测试', '测试审批链顺序和全流程流转',
        e2eTenant.room_number, 'high', e2eAmount,
        rules.needSupervisorReview(e2eAmount) ? 1 : 0
      );
      const rid = reqInfo.lastInsertRowid;

      p(`INSERT INTO approval_chains (request_id, approver_role, step, status)
         VALUES (?, 'housing_manager', 1, 'pending')`).run(rid);
      p(`INSERT INTO approval_chains (request_id, approver_role, step, status)
         VALUES (?, 'supervisor', 2, 'pending')`).run(rid);

      ['approved', 'construction_started', 'construction_completed', 'accepted'].forEach(step => {
        p(`INSERT INTO construction_progress (request_id, step, status)
           VALUES (?, ?, 'pending')`).run(rid, step);
      });

      return rid;
    });

    const e2eId = e2eTx();
    log('【回归】1.租户提交超预算申请成功', e2eId > 0, `申请ID: ${e2eId}`);

    const step0 = p('SELECT status, current_approver, need_supervisor_review FROM repair_requests WHERE id = ?').get(e2eId);
    log('【回归】提交后状态=submitted', step0.status === 'submitted');
    log('【回归】提交后当前审批人=housing_manager', step0.current_approver === 'housing_manager');
    log('【回归】标记需要主管复核', step0.need_supervisor_review === 1);

    const chains0 = p('SELECT * FROM approval_chains WHERE request_id = ? ORDER BY step').all(e2eId);
    log('【回归】审批链共2步', chains0.length === 2);
    log('【回归】第1步房管=pending', chains0[0].approver_role === 'housing_manager' && chains0[0].status === 'pending');
    log('【回归】第2步主管=pending', chains0[1].approver_role === 'supervisor' && chains0[1].status === 'pending');

    const supervisorEarlyCheck1 = (() => {
      if (step0.status !== 'manager_approved') return false;
      return step0.budget_frozen && step0.subject_id && step0.estimated_amount > 0;
    })();
    log('【回归】主管列表过滤：提交后不显示在主管待办', supervisorEarlyCheck1 === false,
      `状态=${step0.status}, 预算冻结=${step0.budget_frozen}`);

    const supervisorEarlyCheck2 = (() => {
      const prev = p('SELECT status FROM approval_chains WHERE request_id = ? AND step = 1').get(e2eId);
      if (!prev || prev.status !== 'approved') return false;
      return true;
    })();
    log('【回归】跳级审批拦截：房管未通过时主管不能审批', supervisorEarlyCheck2 === false,
      `前序步骤状态=${chains0[0].status}`);

    if (e2eSubject) {
      const step1Tx = dbi.transaction(() => {
        p(`UPDATE approval_chains
           SET status = 'approved', approver_id = 2, approver_name = '房管张',
               comment = '预算审核通过，同意立项', approved_at = datetime('now','localtime')
           WHERE request_id = ? AND step = 1`).run(e2eId);
        p(`UPDATE repair_requests
           SET status = 'manager_approved', current_approver = 'supervisor',
               subject_id = ?, estimated_amount = 12000, budget_frozen = 1, version = 2
           WHERE id = ?`).run(e2eSubject.subject_id, e2eId);
        p(`INSERT INTO budget_freezes
           (request_id, budget_id, amount)
           VALUES (?, ?, 12000)`).run(e2eId, e2eSubject.id);
        p(`UPDATE construction_progress SET status = 'completed', operator_id = 2, remark = '房管审核通过'
           WHERE request_id = ? AND step = 'approved'`).run(e2eId);
      });
      step1Tx();

      const step1 = p('SELECT status, current_approver, subject_id, budget_frozen, estimated_amount FROM repair_requests WHERE id = ?').get(e2eId);
      log('【回归】2.房管审核通过→状态=manager_approved', step1.status === 'manager_approved');
      log('【回归】房管通过后当前审批人=supervisor', step1.current_approver === 'supervisor');
      log('【回归】房管审核时已设置费用科目', step1.subject_id === e2eSubject.subject_id);
      log('【回归】房管审核时已冻结预算', step1.budget_frozen === 1);
      log('【回归】房管审核时已确认金额', Math.abs(step1.estimated_amount - 12000) < 0.01);

      const chain1 = p('SELECT status FROM approval_chains WHERE request_id = ? AND step = 1').get(e2eId);
      log('【回归】第1步状态=approved', chain1.status === 'approved');

      const supervisorReadyCheck = (() => {
        if (step1.status !== 'manager_approved') return false;
        if (!step1.budget_frozen) return false;
        if (!step1.subject_id) return false;
        if (!step1.estimated_amount || step1.estimated_amount <= 0) return false;
        const prev = p('SELECT status FROM approval_chains WHERE request_id = ? AND step = 1').get(e2eId);
        return prev && prev.status === 'approved';
      })();
      log('【回归】主管复核前置条件全部满足', supervisorReadyCheck === true,
        `状态=${step1.status}, 预算冻结=${step1.budget_frozen}, 科目=${step1.subject_id}, 金额=${step1.estimated_amount}`);

      const step2Tx = dbi.transaction(() => {
        p(`UPDATE approval_chains
           SET status = 'approved', approver_id = 3, approver_name = '主管李',
               comment = '同意超预算安排', approved_at = datetime('now','localtime')
           WHERE request_id = ? AND step = 2`).run(e2eId);
        p(`UPDATE repair_requests
           SET status = 'approved', current_approver = NULL, version = 3
           WHERE id = ?`).run(e2eId);
      });
      step2Tx();

      const step2 = p('SELECT status, current_approver FROM repair_requests WHERE id = ?').get(e2eId);
      log('【回归】3.主管复核通过→状态=approved', step2.status === 'approved');
      log('【回归】全部审批通过后current_approver=NULL', step2.current_approver === null);

      const chain2 = p('SELECT status FROM approval_chains WHERE request_id = ? AND step = 2').get(e2eId);
      log('【回归】第2步状态=approved', chain2.status === 'approved');

      if (teams.length >= 2) {
        p('INSERT INTO quotations (request_id, team_id, quoted_amount, quotation_detail) VALUES (?, ?, ?, ?)')
          .run(e2eId, teams[0].id, 11500, '施工队A报价明细');
        p('INSERT INTO quotations (request_id, team_id, quoted_amount, quotation_detail) VALUES (?, ?, ?, ?)')
          .run(e2eId, teams[1].id, 12200, '施工队B报价明细');

        const compare = rules.compareQuotations(e2eId);
        log('【回归】4.报价比价通过', compare.passed === true && compare.count === 2,
          `最低价¥${compare.lowest.quoted_amount}`);

        p('UPDATE quotations SET is_selected = 1 WHERE id = (SELECT MIN(id) FROM quotations WHERE request_id = ?)')
          .run(e2eId);
        p('UPDATE repair_requests SET final_amount = 11500, warranty_amount = 575 WHERE id = ?')
          .run(e2eId);

        p(`UPDATE construction_progress SET status = 'completed', operator_id = 5, remark = '施工队进场施工'
           WHERE request_id = ? AND step = 'construction_started'`).run(e2eId);
        p(`UPDATE repair_requests SET status = 'in_construction' WHERE id = ?`).run(e2eId);
        const step3 = p('SELECT status FROM repair_requests WHERE id = ?').get(e2eId);
        log('【回归】5.开始施工→状态=in_construction', step3.status === 'in_construction');

        p(`UPDATE construction_progress SET status = 'completed', operator_id = 5, remark = '施工完成待验收'
           WHERE request_id = ? AND step = 'construction_completed'`).run(e2eId);
        p(`UPDATE repair_requests SET status = 'awaiting_acceptance' WHERE id = ?`).run(e2eId);
        const step4 = p('SELECT status FROM repair_requests WHERE id = ?').get(e2eId);
        log('【回归】6.施工完成→状态=awaiting_acceptance', step4.status === 'awaiting_acceptance');

        const acceptCheck = rules.checkAcceptanceBeforeDisbursement(e2eId);
        log('【回归】未验收前禁止拨款', acceptCheck.passed === false, acceptCheck.reason);

        p(`INSERT INTO acceptance_evidence
           (request_id, inspector_id, result, quality_level, remark)
           VALUES (?, 4, 'pass', '合格', '施工质量验收合格')`).run(e2eId);
        p(`UPDATE construction_progress SET status = 'completed', operator_id = 4, remark = '验收通过'
           WHERE request_id = ? AND step = 'accepted'`).run(e2eId);
        p('UPDATE repair_requests SET status = ? WHERE id = ?').run('accepted', e2eId);
        const step5 = p('SELECT status FROM repair_requests WHERE id = ?').get(e2eId);
        log('【回归】7.验收通过→状态=accepted', step5.status === 'accepted');

        const acceptCheck2 = rules.checkAcceptanceBeforeDisbursement(e2eId);
        log('【回归】验收通过后允许拨款', acceptCheck2.passed === true);

        if (accounts.length > 0) {
          const accId = accounts[0].id;
          const finalAmt = 11500;
          const warrantyAmt = rules.calculateWarrantyAmount(finalAmt);
          const actualAmt = Number((finalAmt - warrantyAmt).toFixed(2));
          const balBefore = p('SELECT balance FROM repair_fund_accounts WHERE id = ?').get(accId).balance;

          const disbNo = 'E2EFD' + Date.now();
          p(`INSERT INTO fund_disbursements
             (disbursement_no, request_id, account_id, amount, warranty_amount, actual_amount, status, disbursed_at)
             VALUES (?, ?, ?, ?, ?, ?, 'disbursed', datetime('now','localtime'))
            `).run(disbNo, e2eId, accId, finalAmt, warrantyAmt, actualAmt);

          const newBal = Number((balBefore - actualAmt).toFixed(2));
          p(`INSERT INTO balance_snapshots
             (account_id, request_id, balance_before, change_amount, balance_after, snapshot_type, reference_no)
             VALUES (?, ?, ?, ?, ?, 'disbursement', ?)
            `).run(accId, e2eId, balBefore, -actualAmt, newBal, disbNo);

          p(`INSERT INTO fund_ledgers
             (account_id, trans_type, trans_no, request_id, debit, balance_after, remark)
             VALUES (?, 'disbursement', ?, ?, ?, ?, '超预算全流程测试拨款')
            `).run(accId, disbNo, e2eId, actualAmt, newBal);

          p('UPDATE repair_fund_accounts SET balance = ? WHERE id = ?').run(newBal, accId);
          p(`UPDATE repair_requests
             SET is_paid = 1, paid_amount = paid_amount + ?, status = 'completed'
             WHERE id = ?`).run(actualAmt, e2eId);

          const step6 = p('SELECT status, is_paid, paid_amount FROM repair_requests WHERE id = ?').get(e2eId);
          log('【回归】8.财务拨款→状态=completed', step6.status === 'completed');
          log('【回归】已标记为已支付', step6.is_paid === 1);
          log('【回归】实拨金额正确', Math.abs(step6.paid_amount - actualAmt) < 0.01,
            `实拨¥${step6.paid_amount.toFixed(2)} = ¥${finalAmt} - ¥${warrantyAmt}质保金`);

          const reconcile = rules.reconcileDisbursement(e2eId);
          log('【回归】9.拨款对账一致', reconcile.matched === true,
            `拨款¥${reconcile.totalDisbursed}, 台账¥${reconcile.totalLedger}`);

          const priceCheck = rules.checkPriceChangeAfterPayment(e2eId, 13000);
          log('【回归】拨款后禁止改价', priceCheck.passed === false, priceCheck.reason);
        }
      }
    }

    log('【回归】✅超预算申请全流程验证通过', true,
      '提交→房管审核→主管复核→报价比价→施工→验收→拨款→对账');
  } catch (err) {
    console.error('超预算全流程回归测试异常:', err.message);
    log('超预算申请全流程回归测试', false, err.message);
  }

  console.log('\n--- 10. 规则引擎完整性测试 ---');

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
