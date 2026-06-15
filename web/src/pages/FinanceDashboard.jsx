import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Statistic, Row, Col, Space, Typography, message, Tabs } from 'antd';
import { EyeOutlined, CheckCircleOutlined, ClockCircleOutlined, DollarOutlined, SafetyOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getRepairRequests, getStats, getFundLedgers } from '../api.js';

const { Title } = Typography;

const statusMap = {
  draft: { text: '草稿', color: 'default' },
  submitted: { text: '待房管审核', color: 'processing' },
  manager_approved: { text: '房管已审核', color: 'blue' },
  supervisor_approved: { text: '主管已复核', color: 'geekblue' },
  approved: { text: '已审批', color: 'success' },
  in_construction: { text: '施工中', color: 'cyan' },
  awaiting_acceptance: { text: '待验收', color: 'orange' },
  accepted: { text: '待拨款(已验收)', color: 'geekblue' },
  paid: { text: '已拨款', color: 'purple' },
  completed: { text: '已完成', color: 'success' },
  rejected: { text: '已驳回', color: 'error' },
  rework: { text: '待返工', color: 'warning' }
};

export default function FinanceDashboard({ auth }) {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({});
  const [ledgers, setLedgers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('requests');

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, statData, ledgerData] = await Promise.all([
        getRepairRequests({ role: 'finance' }),
        getStats(),
        getFundLedgers()
      ]);
      setRequests(data);
      setStats(statData);
      setLedgers(ledgerData);
    } catch (e) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const requestColumns = [
    { title: '申请编号', dataIndex: 'request_no', width: 160 },
    { title: '标题', dataIndex: 'title' },
    { title: '租户', dataIndex: 'tenant_name', width: 100 },
    { title: '房号', dataIndex: 'room_number', width: 100 },
    { title: '维修类型', dataIndex: 'type_name', width: 130, render: (v, r) => (
      <Space>
        {v}
        {r.is_safety ? <Tag color="red">安全类</Tag> : <Tag>普通</Tag>}
      </Space>
    )},
    { title: '施工队', dataIndex: 'team_name', width: 130 },
    { title: '合同金额', dataIndex: 'final_amount', width: 110, render: v => `¥${v?.toFixed(2) || '0.00'}` },
    { title: '质保金(5%)', dataIndex: 'final_amount', width: 110, render: v => `¥${((v || 0) * 0.05).toFixed(2)}` },
    { title: '实拨金额', dataIndex: 'final_amount', width: 110, render: v => `¥${((v || 0) * 0.95).toFixed(2)}` },
    { title: '是否已验收', dataIndex: 'status', width: 100, render: v => (
      ['accepted', 'paid', 'completed'].includes(v)
        ? <Tag color="success"><CheckCircleOutlined /> 已验收</Tag>
        : <Tag color="warning"><ClockCircleOutlined /> 未验收</Tag>
    )},
    { title: '状态', dataIndex: 'status', width: 110, render: v => {
      const s = statusMap[v] || { text: v, color: 'default' };
      return <Tag color={s.color}>{s.text}</Tag>;
    }},
    { title: '操作', key: 'action', width: 100, render: (_, r) => (
      <Space>
        <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/requests/${r.id}`)}>详情</Button>
      </Space>
    )}
  ];

  const ledgerColumns = [
    { title: '流水号', dataIndex: 'ledger_no', width: 180 },
    { title: '关联申请', dataIndex: 'request_no', width: 160 },
    { title: '类型', dataIndex: 'trans_type', width: 100, render: v => {
      const map = {
        disburse: { text: '拨款', color: 'red' },
        refund: { text: '退款', color: 'green' },
        freeze: { text: '冻结', color: 'orange' },
        unfreeze: { text: '解冻', color: 'blue' },
        warranty: { text: '质保金', color: 'purple' }
      };
      const s = map[v] || { text: v, color: 'default' };
      return <Tag color={s.color}>{s.text}</Tag>;
    }},
    { title: '资金账户', dataIndex: 'account_name', width: 150 },
    { title: '金额', dataIndex: 'amount', width: 120, render: (v, r) => (
      <span style={{ color: r.trans_type === 'disburse' || r.trans_type === 'freeze' ? '#f5222d' : '#52c41a', fontWeight: 'bold' }}>
        {r.trans_type === 'disburse' || r.trans_type === 'freeze' ? '-' : '+'}¥{Math.abs(v || 0).toFixed(2)}
      </span>
    )},
    { title: '账户余额', dataIndex: 'balance_after', width: 120, render: v => `¥${v?.toFixed(2) || '0.00'}` },
    { title: '操作人', dataIndex: 'operator_name', width: 100 },
    { title: '备注', dataIndex: 'remark' },
    { title: '时间', dataIndex: 'created_at', width: 160 }
  ];

  return (
    <div className="page-content">
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="待拨款(已验收)"
              value={stats.awaiting_payment || 0}
              valueStyle={{ color: '#fa8c16' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="本月已拨款"
              value={stats.paid_amount || 0}
              precision={2}
              valueStyle={{ color: '#52c41a' }}
              prefix={<DollarOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="累计质保金扣留"
              value={stats.warranty_total || 0}
              precision={2}
              valueStyle={{ color: '#722ed1' }}
              prefix={<SafetyOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="维修资金余额"
              prefix="¥"
              value={stats.fund_balance || 0}
              precision={2}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <Tabs.TabPane tab="拨款管理" key="requests">
            <Table
              rowKey="id"
              loading={loading}
              dataSource={requests}
              columns={requestColumns}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 1500 }}
            />
          </Tabs.TabPane>
          <Tabs.TabPane tab="资金台账" key="ledgers">
            <Table
              rowKey="id"
              loading={loading}
              dataSource={ledgers}
              columns={ledgerColumns}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 1400 }}
            />
          </Tabs.TabPane>
        </Tabs>
      </Card>
    </div>
  );
}
