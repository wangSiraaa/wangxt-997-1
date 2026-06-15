import React, { useState, useEffect } from 'react';
import {
  Card, Descriptions, Tag, Button, Space, Table, Timeline, Form, Input, Select, InputNumber,
  Modal, message, Result, Empty, Row, Col, Statistic, List, Divider, Alert
} from 'antd';
import {
  ArrowLeftOutlined, CheckOutlined, CloseOutlined, PlayCircleOutlined,
  CheckCircleOutlined, MoneyCollectOutlined, AuditOutlined
} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  getRepairRequest, approveRepairRequest, getRepairTypes, getCostSubjects,
  getConstructionTeams, addQuotation, compareQuotations, selectQuotation,
  getFundAccounts, startConstruction, completeConstruction, acceptRepair,
  addInvoice, disburseFund, reconcileRequest
} from '../api.js';

const statusMap = {
  draft: { text: '草稿', color: 'default' },
  submitted: { text: '已提交', color: 'processing' },
  manager_approved: { text: '房管已通过', color: 'blue' },
  approved: { text: '已审批', color: 'blue' },
  in_construction: { text: '施工中', color: 'cyan' },
  awaiting_acceptance: { text: '待验收', color: 'orange' },
  accepted: { text: '已验收', color: 'geekblue' },
  completed: { text: '已完成', color: 'success' },
  rejected: { text: '已驳回', color: 'error' },
  rework: { text: '待返工', color: 'warning' }
};

export default function RequestDetail({ auth }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [repairTypes, setRepairTypes] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [reconcileData, setReconcileData] = useState(null);
  const [approveModal, setApproveModal] = useState(false);
  const [quoteModal, setQuoteModal] = useState(false);
  const [acceptModal, setAcceptModal] = useState(false);
  const [disburseModal, setDisburseModal] = useState(false);
  const [approveForm] = Form.useForm();
  const [quoteForm] = Form.useForm();
  const [acceptForm] = Form.useForm();
  const [disburseForm] = Form.useForm();

  const loadDetail = async () => {
    setLoading(true);
    try {
      const [d, types, subs, tms, accts, comp, rec] = await Promise.all([
        getRepairRequest(id),
        getRepairTypes(),
        getCostSubjects(),
        getConstructionTeams(),
        getFundAccounts(),
        compareQuotations(id).catch(() => null),
        reconcileRequest(id).catch(() => null)
      ]);
      setDetail(d);
      setRepairTypes(types);
      setSubjects(subs);
      setTeams(tms);
      setAccounts(accts);
      setCompareData(comp);
      setReconcileData(rec);
    } catch (e) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDetail(); }, [id]);

  if (!detail) return <div style={{ padding: 24 }}>加载中...</div>;

  const { request, approvals, versions, quotations, progress, acceptance, invoices, disbursements, ledgers } = detail;
  const s = statusMap[request.status] || {};

  const pendingApprovalFor = (role) => approvals.some(a => a.approver_role === role && a.status === 'pending');

  const canApprove = (role) => {
    if (request.current_approver !== role) return false;
    if (role === 'supervisor' && request.status !== 'manager_approved') return false;
    if (role === 'housing_manager' && !['submitted', 'manager_rejected'].includes(request.status)) return false;
    return approvals.some(a => a.approver_role === role && a.status === 'pending');
  };

  const renderActions = () => {
    const btns = [];
    const role = auth.user.role;

    if ((role === 'housing_manager' || role === 'supervisor') && canApprove(role)) {
      btns.push(
        <Button key="approve" type="primary" icon={<AuditOutlined />} onClick={() => setApproveModal(true)}>
          {role === 'housing_manager' ? '房管审核' : '主管复核'}
        </Button>
      );
    }

    if (role === 'housing_manager' && request.status === 'approved' && quotations.length > 0) {
      btns.push(<Button key="start" type="primary" icon={<PlayCircleOutlined />}
        onClick={async () => { try { await startConstruction(id); message.success('施工已开始'); loadDetail(); } catch(e) { message.error(e.response?.data?.error || '失败'); } }}>
        开始施工
      </Button>);
    }

    if (role === 'housing_manager' && request.status === 'in_construction') {
      btns.push(<Button key="complete" type="primary" onClick={async () => {
        try { await completeConstruction(id); message.success('施工已完成，待验收'); loadDetail(); } catch(e) { message.error(e.response?.data?.error || '失败'); }
      }}>施工完成</Button>);
    }

    if (role === 'inspector' && request.status === 'awaiting_acceptance') {
      btns.push(<Button key="accept" type="primary" icon={<CheckCircleOutlined />} onClick={() => setAcceptModal(true)}>验收</Button>);
    }

    if (role === 'finance' && request.status === 'accepted' && !request.is_paid) {
      btns.push(<Button key="disburse" type="primary" icon={<MoneyCollectOutlined />} onClick={() => setDisburseModal(true)}>拨款</Button>);
    }

    if (role === 'finance' && request.is_paid) {
      btns.push(<Button key="reconcile" onClick={async () => {
        const r = await reconcileRequest(id);
        setReconcileData(r);
        message[r.matched ? 'success' : 'error'](r.matched ? '对账一致' : r.reason);
      }}>对账核对</Button>);
    }

    if (role === 'housing_manager' && request.status === 'approved' && !request.is_paid) {
      btns.push(<Button key="quote" icon={<PlusOutlined />} onClick={() => setQuoteModal(true)}>录入报价</Button>);
    }

    return btns.length > 0 ? <Space>{btns}</Space> : null;
  };

  const stepNameMap = {
    approved: '审批通过',
    construction_started: '施工开始',
    construction_completed: '施工完成',
    accepted: '验收通过'
  };

  return (
    <div className="page-content">
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>返回</Button>
      </Space>

      <Card
        title={<Space><span>申请详情</span><Tag color={s.color}>{s.text}</Tag></Space>}
        extra={renderActions()}
        loading={loading}
      >
        <Descriptions bordered column={2} size="small">
          <Descriptions.Item label="申请编号">{request.request_no}</Descriptions.Item>
          <Descriptions.Item label="版本">v{request.version}</Descriptions.Item>
          <Descriptions.Item label="标题" span={2}>{request.title}</Descriptions.Item>
          <Descriptions.Item label="租户">{request.tenant_name}（{request.room_number}）</Descriptions.Item>
          <Descriptions.Item label="维修类型">
            <Space>
              {request.type_name}
              {request.is_safety ? <Tag color="red">安全类</Tag> : <Tag>普通</Tag>}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="费用科目">{request.subject_name || '-'}</Descriptions.Item>
          <Descriptions.Item label="紧急程度">{request.urgency}</Descriptions.Item>
          <Descriptions.Item label="预估金额">¥{request.estimated_amount?.toFixed(2)}</Descriptions.Item>
          <Descriptions.Item label="最终金额">¥{(request.final_amount || 0).toFixed(2)}</Descriptions.Item>
          <Descriptions.Item label="质保金(5%)">¥{(request.warranty_amount || 0).toFixed(2)}</Descriptions.Item>
          <Descriptions.Item label="已拨付">¥{(request.paid_amount || 0).toFixed(2)}</Descriptions.Item>
          <Descriptions.Item label="欠租状态">
            {request.has_arrears_when_submitted ? (
              <Tag color="warning">提交时欠租 ¥{request.arrears_amount_when_submitted?.toFixed(2)}</Tag>
            ) : <Tag color="success">无欠租</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="主管复核">{request.need_supervisor_review ? <Tag color="orange">需要</Tag> : <Tag>不需要</Tag>}</Descriptions.Item>
          <Descriptions.Item label="详细描述" span={2}>{request.description || '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{request.created_at}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{request.updated_at}</Descriptions.Item>
        </Descriptions>

        <Divider orientation="left">审批流程</Divider>
        <Timeline
          items={approvals.map(a => ({
            color: a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'blue',
            children: (
              <div>
                <Space>
                  <strong>{a.approver_role === 'housing_manager' ? '房管审核' : '主管复核'}</strong>
                  <Tag color={a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'blue'}>
                    {a.status === 'approved' ? '通过' : a.status === 'rejected' ? '驳回' : '待处理'}
                  </Tag>
                </Space>
                <div style={{ color: '#666', fontSize: 12 }}>
                  {a.approver_name || '待处理'} · {a.approved_at || ''}
                </div>
                {a.comment && <div style={{ marginTop: 4 }}>意见：{a.comment}</div>}
              </div>
            )
          }))}
        />

        <Divider orientation="left">施工进度</Divider>
        <Timeline
          items={progress.map(p => ({
            color: p.status === 'completed' ? 'green' : 'blue',
            children: (
              <div>
                <strong>{stepNameMap[p.step] || p.step}</strong>
                <Tag color={p.status === 'completed' ? 'green' : 'default'}>
                  {p.status === 'completed' ? '已完成' : '待处理'}
                </Tag>
              </div>
            )
          }))}
        />

        {quotations.length > 0 && (
          <>
            <Divider orientation="left">
              <Space>施工队报价比价 {compareData && <Tag color="blue">{compareData.count}家报价，价差{compareData.spreadRatio}</Tag>}</Space>
            </Divider>
            <Table
              size="small"
              dataSource={quotations}
              rowKey="id"
              pagination={false}
              columns={[
                { title: '施工队', dataIndex: 'team_name' },
                { title: '资质等级', dataIndex: 'qualification_level' },
                { title: '报价金额', dataIndex: 'quoted_amount', render: v => `¥${v.toFixed(2)}` },
                { title: '详情', dataIndex: 'quotation_detail', render: v => v || '-' },
                { title: '状态', dataIndex: 'is_selected', render: v => v ? <Tag color="green">已选中</Tag> : null },
                {
                  title: '操作', key: 'sel',
                  render: (_, r) => request.status === 'approved' && !request.is_paid && !r.is_selected ? (
                    <Button size="small" onClick={async () => {
                      try { await selectQuotation(id, r.id); message.success('已选中'); loadDetail(); }
                      catch(e) { message.error(e.response?.data?.error || '失败'); }
                    }}>选中此报价</Button>
                  ) : null
                }
              ]}
            />
          </>
        )}

        {acceptance && (
          <>
            <Divider orientation="left">验收记录</Divider>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="验收结果">
                <Tag color={acceptance.result === 'pass' ? 'green' : 'red'}>
                  {acceptance.result === 'pass' ? '通过' : '不通过'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="质量等级">{acceptance.quality_level || '-'}</Descriptions.Item>
              <Descriptions.Item label="验收时间">{acceptance.accepted_at || '-'}</Descriptions.Item>
              <Descriptions.Item label="备注">{acceptance.remark || '-'}</Descriptions.Item>
            </Descriptions>
          </>
        )}

        {invoices.length > 0 && (
          <>
            <Divider orientation="left">发票信息</Divider>
            <Table size="small" dataSource={invoices} rowKey="id" pagination={false} columns={[
              { title: '发票号', dataIndex: 'invoice_no' },
              { title: '金额', dataIndex: 'invoice_amount', render: v => `¥${v?.toFixed(2)}` },
              { title: '验真状态', render: () => <Tag>验真占位</Tag> }
            ]} />
          </>
        )}

        {disbursements.length > 0 && (
          <>
            <Divider orientation="left">
              <Space>
                拨款流水
                {reconcileData && (
                  <Tag color={reconcileData.matched ? 'green' : 'red'}>
                    {reconcileData.matched ? `对账一致：¥${reconcileData.totalDisbursed.toFixed(2)}` : `对账异常：${reconcileData.reason}`}
                  </Tag>
                )}
              </Space>
            </Divider>
            <Table size="small" dataSource={disbursements} rowKey="id" pagination={false} columns={[
              { title: '拨款单号', dataIndex: 'disbursement_no' },
              { title: '资金账户', dataIndex: 'account_name' },
              { title: '总金额', dataIndex: 'amount', render: v => `¥${v.toFixed(2)}` },
              { title: '质保金', dataIndex: 'warranty_amount', render: v => `¥${v.toFixed(2)}` },
              { title: '实拨金额', dataIndex: 'actual_amount', render: v => `¥${v.toFixed(2)}` },
              { title: '时间', dataIndex: 'disbursed_at' }
            ]} />
          </>
        )}

        {ledgers.length > 0 && (
          <>
            <Divider orientation="left">资金台账</Divider>
            <Table size="small" dataSource={ledgers} rowKey="id" pagination={false} columns={[
              { title: '交易类型', dataIndex: 'trans_type', render: v => v === 'disbursement' ? '拨款' : v },
              { title: '交易号', dataIndex: 'trans_no' },
              { title: '借方', dataIndex: 'debit', render: v => v ? `¥${v.toFixed(2)}` : '-' },
              { title: '贷方', dataIndex: 'credit', render: v => v ? `¥${v.toFixed(2)}` : '-' },
              { title: '余额', dataIndex: 'balance_after', render: v => `¥${v.toFixed(2)}` },
              { title: '时间', dataIndex: 'created_at' }
            ]} />
          </>
        )}
      </Card>

      <Modal title="审核" open={approveModal} onCancel={() => setApproveModal(false)} footer={null} width={560}>
        <Form form={approveForm} layout="vertical" onFinish={async v => {
          try {
            await approveRepairRequest(id, { ...v, approver_role: auth.user.role, approver_id: auth.user.id, approver_name: auth.user.name });
            message.success('操作成功');
            setApproveModal(false); approveForm.resetFields(); loadDetail();
          } catch(e) { message.error(e.response?.data?.error || '操作失败'); }
        }}>
          {auth.user.role === 'housing_manager' && (
            <>
              <Form.Item name="subject_id" label="费用科目" rules={[{ required: true }]}>
                <Select options={subjects.map(s => ({ value: s.id, label: `${s.code} ${s.name}` }))} />
              </Form.Item>
              <Form.Item name="estimated_amount" label="预算金额" rules={[{ required: true }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
              <Form.Item name="final_amount" label="最终金额">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
              <Alert type="info" showIcon message="超过1万元需主管复核" style={{ marginBottom: 16 }} />
            </>
          )}
          <Form.Item name="comment" label="审批意见">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item>
            <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => setApproveModal(false)}>取消</Button>
              <Button danger htmlType="submit" onClick={e => { e.preventDefault(); approveForm.submit(); }} form={null}
                onClickCapture={async e => {
                  e.preventDefault();
                  try {
                    const v = await approveForm.validateFields();
                    await approveRepairRequest(id, { ...v, action: 'reject', approver_role: auth.user.role, approver_id: auth.user.id, approver_name: auth.user.name });
                    message.success('已驳回'); setApproveModal(false); approveForm.resetFields(); loadDetail();
                  } catch(_) {}
                }}>驳回</Button>
              <Button type="primary" htmlType="submit">通过</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="录入施工队报价" open={quoteModal} onCancel={() => setQuoteModal(false)} footer={null}>
        <Form form={quoteForm} layout="vertical" onFinish={async v => {
          try { await addQuotation(id, v); message.success('报价已录入'); setQuoteModal(false); quoteForm.resetFields(); loadDetail(); }
          catch(e) { message.error(e.response?.data?.error || '失败'); }
        }}>
          <Form.Item name="team_id" label="施工队" rules={[{ required: true }]}>
            <Select options={teams.map(t => ({ value: t.id, label: `${t.team_name}（${t.qualification_level}）` }))} />
          </Form.Item>
          <Form.Item name="quoted_amount" label="报价金额" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="quotation_detail" label="报价说明">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item>
            <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => setQuoteModal(false)}>取消</Button>
              <Button type="primary" htmlType="submit">提交</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="施工验收" open={acceptModal} onCancel={() => setAcceptModal(false)} footer={null}>
        <Form form={acceptForm} layout="vertical" onFinish={async v => {
          try { await acceptRepair(id, { ...v, inspector_id: auth.user.id }); message.success(v.result === 'pass' ? '验收通过' : '已标记待返工'); setAcceptModal(false); acceptForm.resetFields(); loadDetail(); }
          catch(e) { message.error(e.response?.data?.error || '失败'); }
        }}>
          <Form.Item name="result" label="验收结果" rules={[{ required: true }]} initialValue="pass">
            <Select options={[{ value: 'pass', label: '通过' }, { value: 'fail', label: '不通过（返工）' }]} />
          </Form.Item>
          <Form.Item name="quality_level" label="质量等级">
            <Select options={[{ value: '优秀', label: '优秀' }, { value: '合格', label: '合格' }, { value: '不合格', label: '不合格' }]} />
          </Form.Item>
          <Form.Item name="remark" label="验收备注">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item>
            <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => setAcceptModal(false)}>取消</Button>
              <Button type="primary" htmlType="submit">提交验收</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="财务拨款" open={disburseModal} onCancel={() => setDisburseModal(false)} footer={null}>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`拨款金额：¥${(request.final_amount || request.estimated_amount || 0).toFixed(2)}，扣质保金5%后实拨：¥${((request.final_amount || request.estimated_amount || 0) * 0.95).toFixed(2)}`}
        />
        <Form form={disburseForm} layout="vertical" onFinish={async v => {
          try {
            const r = await disburseFund(id, { ...v, finance_id: auth.user.id });
            message.success(`拨款成功：¥${r.actualAmount.toFixed(2)}（质保金暂扣：¥${r.warrantyAmount.toFixed(2)}）`);
            setDisburseModal(false); disburseForm.resetFields(); loadDetail();
          } catch(e) { message.error(e.response?.data?.error || '失败'); }
        }}>
          <Form.Item name="account_id" label="资金账户" rules={[{ required: true }]}>
            <Select options={accounts.map(a => ({ value: a.id, label: `${a.account_name}（余额：¥${a.balance.toFixed(2)}）` }))} />
          </Form.Item>
          <Form.Item name="remark" label="拨款备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item>
            <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => setDisburseModal(false)}>取消</Button>
              <Button type="primary" htmlType="submit" icon={<MoneyCollectOutlined />}>确认拨款</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
