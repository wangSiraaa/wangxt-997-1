import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Statistic, Row, Col, Space, Typography, message, Progress } from 'antd';
import { EyeOutlined, CheckCircleOutlined, ClockCircleOutlined, ToolOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getRepairRequests, getStats } from '../api.js';

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

export default function InspectorDashboard({ auth }) {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, statData] = await Promise.all([
        getRepairRequests({ role: 'inspector' }),
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

  const getConstructionProgress = (r) => {
    if (r.status === 'in_construction') {
      return { percent: 50, status: 'active', text: '施工中' };
    } else if (r.status === 'awaiting_acceptance') {
      return { percent: 90, status: 'exception', text: '待验收' };
    } else if (r.status === 'accepted' || r.status === 'paid' || r.status === 'completed') {
      return { percent: 100, status: 'success', text: '已验收' };
    }
    return { percent: 0, status: 'normal', text: '未开始' };
  };

  const columns = [
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
    { title: '合同金额', dataIndex: 'final_amount', width: 120, render: v => `¥${v?.toFixed(2) || '0.00'}` },
    { title: '施工进度', width: 160, render: (_, r) => {
      const p = getConstructionProgress(r);
      return <Progress percent={p.percent} status={p.status} size="small" />;
    }},
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

  return (
    <div className="page-content">
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="待验收项目"
              value={stats.awaiting_acceptance || 0}
              valueStyle={{ color: '#fa8c16' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="施工中"
              value={stats.in_construction || 0}
              valueStyle={{ color: '#13c2c2' }}
              prefix={<ToolOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="本月已验收"
              value={stats.accepted || 0}
              valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="验收一次通过率"
              suffix="%"
              value={stats.acceptance_rate || 0}
              precision={1}
              valueStyle={{ color: '#722ed1' }}
            />
          </Card>
        </Col>
      </Row>

      <Card title={<Title level={4} style={{ margin: 0 }}>施工验收列表</Title>}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={requests}
          columns={columns}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1300 }}
        />
      </Card>
    </div>
  );
}
