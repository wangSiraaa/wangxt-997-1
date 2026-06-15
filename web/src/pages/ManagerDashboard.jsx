import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Statistic, Row, Col, Space, Typography, message } from 'antd';
import { EyeOutlined, CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getRepairRequests, getStats, getBudgets } from '../api.js';

const { Title } = Typography;

const statusMap = {
  draft: { text: '草稿', color: 'default' },
  submitted: { text: '待房管审核', color: 'processing' },
  manager_approved: { text: '房管已审核', color: 'blue' },
  supervisor_approved: { text: '主管已复核', color: 'geekblue' },
  approved: { text: '已审批', color: 'success' },
  in_construction: { text: '施工中', color: 'cyan' },
  awaiting_acceptance: { text: '待验收', color: 'orange' },
  accepted: { text: '已验收', color: 'geekblue' },
  paid: { text: '已拨款', color: 'purple' },
  completed: { text: '已完成', color: 'success' },
  rejected: { text: '已驳回', color: 'error' },
  rework: { text: '待返工', color: 'warning' }
};

export default function ManagerDashboard({ auth }) {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({});
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, statData, budgetData] = await Promise.all([
        getRepairRequests({ role: 'housing_manager' }),
        getStats(),
        getBudgets()
      ]);
      setRequests(data);
      setStats(statData);
      setBudgets(budgetData);
    } catch (e) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const columns = [
    { title: '申请编号', dataIndex: 'request_no', width: 160 },
    { title: '标题', dataIndex: 'title' },
    { title: '租户', dataIndex: 'tenant_name', width: 100 },
    { title: '房号', dataIndex: 'room_number', width: 100 },
    { title: '维修类型', dataIndex: 'type_name', render: (v, r) => (
      <Space>
        {v}
        {r.is_safety ? <Tag color="red">安全类</Tag> : <Tag>普通</Tag>}
      </Space>
    )},
    { title: '预估金额', dataIndex: 'estimated_amount', render: v => `¥${v?.toFixed(2) || '0.00'}`, width: 110 },
    { title: '状态', dataIndex: 'status', width: 120, render: v => {
      const s = statusMap[v] || { text: v, color: 'default' };
      return <Tag color={s.color}>{s.text}</Tag>;
    }},
    { title: '是否需主管复核', dataIndex: 'estimated_amount', width: 130, render: v => (
      v >= 10000 ? <Tag color="orange">需复核(≥1万)</Tag> : <Tag color="green">无需</Tag>
    )},
    { title: '创建时间', dataIndex: 'created_at', width: 160 },
    { title: '操作', key: 'action', width: 100, render: (_, r) => (
      <Space>
        <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/requests/${r.id}`)}>详情</Button>
      </Space>
    )}
  ];

  return (
    <div className="page-content">
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="待房管审核"
              value={stats.pending_manager || 0}
              valueStyle={{ color: '#faad14' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="本月已审核"
              value={stats.manager_approved || 0}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="累计申请"
              value={stats.total_requests || 0}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="已冻结预算"
              prefix="¥"
              value={stats.budget_frozen || 0}
              precision={2}
              valueStyle={{ color: '#eb2f96' }}
            />
          </Card>
        </Col>
      </Row>

      {budgets.length > 0 && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {budgets.map(b => (
            <Col span={8} key={b.id}>
              <Card size="small" title={`${b.year}年 - ${b.subject_name}`}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <span>年度预算</span>
                    <span style={{ fontWeight: 'bold' }}>¥{b.total_amount.toFixed(2)}</span>
                  </Space>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <span>已使用</span>
                    <span style={{ color: '#52c41a' }}>¥{b.used_amount.toFixed(2)}</span>
                  </Space>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <span>已冻结</span>
                    <span style={{ color: '#eb2f96' }}>¥{b.frozen_amount.toFixed(2)}</span>
                  </Space>
                  <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                    <span>可用余额</span>
                    <span style={{ fontWeight: 'bold', color: '#1890ff' }}>
                      ¥{(b.total_amount - b.used_amount - b.frozen_amount).toFixed(2)}
                    </span>
                  </Space>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Card title={<Title level={4} style={{ margin: 0 }}>维修申请列表（房管审核）</Title>}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={requests}
          columns={columns}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1200 }}
        />
      </Card>
    </div>
  );
}
