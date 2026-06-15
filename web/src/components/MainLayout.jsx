import React from 'react';
import { Layout, Menu, Button, Dropdown, Avatar } from 'antd';
import {
  DashboardOutlined, UserOutlined, LogoutOutlined,
  HomeOutlined, ToolOutlined
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';

const { Header, Sider, Content } = Layout;

const roleNames = {
  tenant: '租户',
  housing_manager: '房管',
  supervisor: '主管',
  finance: '财务',
  inspector: '施工验收'
};

export default function MainLayout({ auth, children, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '工作台' }
  ];

  const userMenu = {
    items: [
      { key: 'user', icon: <UserOutlined />, label: `${auth.user.name} (${roleNames[auth.user.role]})` },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' }
    ],
    onClick: ({ key }) => {
      if (key === 'logout') onLogout();
    }
  };

  return (
    <Layout className="layout-container">
      <Sider theme="dark" width={200}>
        <div className="logo" style={{ height: 64, display: 'flex', alignItems: 'center' }}>
          <ToolOutlined style={{ marginRight: 8 }} />
          维修资金系统
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Dropdown menu={userMenu} placement="bottomRight">
            <Button type="text">
              <Avatar size="small" icon={<UserOutlined />} style={{ marginRight: 8 }} />
              {auth.user.name}
            </Button>
          </Dropdown>
        </Header>
        <Content style={{ margin: 0 }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
}
