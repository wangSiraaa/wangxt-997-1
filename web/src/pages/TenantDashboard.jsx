import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Modal, Form, Input, Select, InputNumber, Alert, Space, Typography, message } from 'antd';
import { PlusOutlined, ExclamationCircleOutlined, EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  getRepairRequests, getRepairTypes, createRepairRequest, checkTenantArrears
} from '../api.js';

const { Title, Text } = Typography;
const { TextArea } = Input;

const statusMap = {
  draft: { text: '草稿', color: 'default' },
  submitted: { text: '已提交', color: 'processing' },
  approved: { text: '已审批', color: 'blue' },
  in_construction: { text: '施工中', color: 'cyan' },
  awaiting_acceptance: { text: '待验收', color: 'orange' },
  accepted: { text: '已验收', color: 'geekblue' },
  completed: { text: '已完成', color: 'success' },
  rejected: { text: '已驳回', color: 'error' },
  rework: { text: '待返工', color: 'warning' }
};

export default function TenantDashboard({ auth }) {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [repairTypes, setRepairTypes] = useState([]);
  const [arrearsInfo, setArrearsInfo] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, types, arrears] = await Promise.all([
        getRepairRequests({ role: 'tenant', tenantId: auth.tenant?.id }),
        getRepairTypes(),
        auth.tenant ? checkTenantArrears(auth.tenant.id) : Promise.resolve(null)
      ]);
      setRequests(data);
      setRepairTypes(types);
      setArrearsInfo(arrears);
    } catch (e) {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const canSubmitType = (typeId) => {
    if (!arrearsInfo || !arrearsInfo.hasArrears) return true;
    const t = repairTypes.find(r => r.id === typeId);
    return t?.is_safety === 1;
  };

  const handleSubmit = async (values) => {
    if (!canSubmitType(values.repair_type_id)) {
      message.error('您存在欠租，仅可提交安全类维修申请');
      return;
    }
    try {
      await createRepairRequest({
        ...values,
        tenant_id: auth.tenant.id,
        room_number: auth.tenant.room_number
      });
      message.success('报修申请已提交');
      setModalOpen(false);
      form.resetFields();
      loadData();
    } catch (e) {
      message.error(e.response?.data?.error || '提交失败');
    }
  };

  const columns = [
    { title: '申请编号', dataIndex: 'request_no', width: 180 },
    { title: '标题', dataIndex: 'title' },
    { title: '维修类型', dataIndex: 'type_name', render: (v, r) => (
      <Space>
        {v}
        {r.is_safety ? <Tag color="red">安全类</Tag> : <Tag>普通</Tag>}
      </Space>
    )},
    { title: '预估金额', dataIndex: 'estimated_amount', render: v => `¥${v?.toFixed(2) || '0.00'}` },
    { title: '状态', dataIndex: 'status', render: v => {
      const s = statusMap[v] || { text: v, color: 'default' };
      return <Tag color={s.color}>{s.text}</Tag>;
    }},
    { title: '创建时间', dataIndex: 'created_at', width: 170 },
    { title: '操作', key: 'action', render: (_, r) => (
      <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/requests/${r.id}`)}>详情</Button>
    )}
  ];

  return (
    <div className="page-content">
      {arrearsInfo?.hasArrears && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <Space>
              <ExclamationCircleOutlined />
              <span>您当前存在欠租：¥{arrearsInfo.arrearsAmount.toFixed(2)}（{arrearsInfo.arrearsDays}天），仅可提交安全类维修申请</span>
            </Space>
          }
        />
      )}
      <Card
        title={<Title level={4} style={{ margin: 0 }}>我的维修申请</Title>}
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>发起报修</Button>}
      >
        <Table
          rowKey="id"
          loading={loading}
          dataSource={requests}
          columns={columns}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="发起报修申请"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        footer={null}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="repair_type_id" label="维修类型" rules={[{ required: true }]}>
            <Select
              placeholder="请选择维修类型"
              options={repairTypes.map(t => ({
                value: t.id,
                label: (
                  <Space>
                    {t.name}
                    {t.is_safety ? <Tag color="red">安全类</Tag> : <Tag>普通</Tag>}
                    {arrearsInfo?.hasArrears && !t.is_safety ? <Tag color="default" disabled>欠租不可选</Tag> : null}
                  </Space>
                ),
                disabled: arrearsInfo?.hasArrears && !t.is_safety
              }))}
            />
          </Form.Item>
          <Form.Item name="title" label="报修标题" rules={[{ required: true }]}>
            <Input placeholder="简要描述报修问题" />
          </Form.Item>
          <Form.Item name="description" label="详细描述">
            <TextArea rows={4} placeholder="请详细描述故障情况" />
          </Form.Item>
          <Form.Item name="estimated_amount" label="预估金额（元）">
            <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="选填" />
          </Form.Item>
          <Form.Item name="contact_phone" label="联系电话">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="urgency" label="紧急程度" initialValue="normal">
            <Select options={[
              { value: 'normal', label: '普通' },
              { value: 'urgent', label: '紧急' },
              { value: 'critical', label: '特急' }
            ]} />
          </Form.Item>
          <Form.Item>
            <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button onClick={() => setModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit">提交申请</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
