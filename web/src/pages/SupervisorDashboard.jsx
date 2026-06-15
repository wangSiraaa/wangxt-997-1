import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Statistic, Row, Col, Space, Typography, message } from 'antd';
import { EyeOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getRepairRequests, getStats } from '../api.js';

const { Title } = Typography;

const statusMap = {
  draft: { text: '草稿', color: 'default' },
  submitted: { text: '待房管审核', color: 'processing' },
  manager_approved: { text: '待主管复核', color: 'processing' },
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

export default function SupervisorDashboard({ auth }) {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, statData] = await Promise.all([
        getRepairRequests({ role: 'supervisor' }),
        getStats()
      ]);
      setRequests(data);
      setStats(statData);
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
    { title: '预估金额', dataIndex: 'estimated_amount', render: v => `¥${v?.toFixed(2) || '0.00'}`, width: 120 },
    { title: '状态', dataIndex: 'status', width: 130, render: v => {
      const s = statusMap[v] || { text: v, color: 'default' };
      return <Tag color={s.color}>{s.text}</Tag>;
    }},
    { title: '超预算金额', dataIndex: 'estimated_amount', width: 140, render: v => {
      const over = (v || 0) - 10000;
      return over > 0 ? (
        <Tag color="red"><WarningOutlined /> 超¥{over.toFixed(2)}</Tag>
      ) : (
        <Tag color="green">未超阈值</Tag>
      );
    }},
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
              title="待主管复核"
              value={stats.pending_supervisor || 0}
              valueStyle={{ color: '#faad14' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="本月已复核"
              value={stats.supervisor_approved || 0}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="超预算申请(≥1万)"
              value={stats.over_budget_count || 0}
              valueStyle={{ color: '#f5222d' }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="复核涉及金额"
              prefix="¥"
              value={stats.supervisor_review_amount || 0}
              precision={2}
            />
          </Card>
        </Col>
      </Row>

      <Card title={<Title level={4} style={{ margin: 0 }}>维修申请列表（主管复核 - 超预算项目）</Title>}>
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
