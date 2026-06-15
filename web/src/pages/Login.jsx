import React, { useState } from 'react';
import { Form, Input, Button, Card, Typography, message, Alert } from 'antd';
import { UserOutlined, LockOutlined, ToolOutlined } from '@ant-design/icons';
import { login } from '../api.js';

const { Title, Text } = Typography;

const demoAccounts = [
  { user: 'tenant01', name: '张三（租户-正常）', desc: '无欠租' },
  { user: 'tenant02', name: '李四（租户-欠租）', desc: '欠租3500元/45天' },
  { user: 'manager01', name: '王房管（房管）', desc: '预算审核' },
  { user: 'supervisor01', name: '赵主管（主管）', desc: '超预算复核' },
  { user: 'inspector01', name: '孙验收（验收）', desc: '施工验收' },
  { user: 'finance01', name: '钱会计（财务）', desc: '拨款' }
];

export default function Login({ onLogin }) {
  const [loading, setLoading] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const data = await login(values.username, values.password);
      message.success(`登录成功，欢迎 ${data.user.name}`);
      onLogin(data);
    } catch (e) {
      message.error(e.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)'
    }}>
      <Card style={{ width: 480, boxShadow: '0 4px 20px rgba(0,0,0,0.15)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <ToolOutlined style={{ fontSize: 48, color: '#1677ff' }} />
          <Title level={3} style={{ marginTop: 12, marginBottom: 4 }}>公租房维修资金管理系统</Title>
          <Text type="secondary">维修审批 · 预算管控 · 资金拨付</Text>
        </div>
        <Form onFinish={onFinish} size="large" initialValues={{ username: 'tenant01', password: '123456' }}>
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>登 录</Button>
          </Form.Item>
        </Form>
        <Alert
          type="info"
          showIcon
          message="演示账号（密码均为 123456）"
          description={
            <div>
              {demoAccounts.map(a => (
                <div key={a.user} style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <Text strong>{a.user}</Text> - {a.name}
                  <Text type="secondary"> ({a.desc})</Text>
                </div>
              ))}
            </div>
          }
        />
      </Card>
    </div>
  );
}
