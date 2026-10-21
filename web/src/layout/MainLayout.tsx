import { useState } from 'react';
import { Layout, Menu, Avatar, Dropdown, Button, Modal, Form, Input, App as AntApp, Tag } from 'antd';
import {
  DashboardOutlined, DatabaseOutlined, ImportOutlined, ShopOutlined,
  EnvironmentOutlined, SwapOutlined, PieChartOutlined, HistoryOutlined, ProfileOutlined,
  UserOutlined, LogoutOutlined, LockOutlined,
  InboxOutlined, FileSearchOutlined, StockOutlined, ScanOutlined,
  ThunderboltOutlined, UnorderedListOutlined, ClusterOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../store';
import { canAccess, ROLE_LABELS } from '../permissions';
import api from '../api';

const { Header, Sider, Content } = Layout;

export default function MainLayout() {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = AntApp.useApp();
  const [cpOpen, setCpOpen] = useState(false);
  const [form] = Form.useForm();

  if (!user) return <Navigate to="/login" replace />;
  const role = user.role;

  const items: any[] = [{ key: '/app/dashboard', icon: <DashboardOutlined />, label: '概览仪表盘' }];
  if (canAccess(role, 'master')) {
    items.push({
      key: 'master',
      icon: <DatabaseOutlined />,
      label: '主数据管理',
      children: [
        { key: '/app/master/materials', label: '物料管理' },
        { key: '/app/master/materials/import', icon: <ImportOutlined />, label: '物料批量导入' },
        { key: '/app/master/suppliers', icon: <ShopOutlined />, label: '供应商档案' },
        { key: '/app/master/locations', icon: <EnvironmentOutlined />, label: '库位档案' },
        { key: '/app/master/units', icon: <SwapOutlined />, label: '单位与换算' },
        { key: '/app/master/abc', icon: <PieChartOutlined />, label: 'ABC 分类' },
        { key: '/app/master/products', label: '成品档案' },
        { key: '/app/master/bom', icon: <ProfileOutlined />, label: 'BOM 配方' },
      ],
    });
  }
  if (canAccess(role, 'inbound')) {
    items.push({
      key: 'inbound',
      icon: <InboxOutlined />,
      label: '备料入库',
      children: [
        { key: '/app/inbound/entry', icon: <ScanOutlined />, label: '入库录入' },
        { key: '/app/inbound/records', icon: <FileSearchOutlined />, label: '入库记录' },
        { key: '/app/inbound/stock', icon: <StockOutlined />, label: '批次库存' },
      ],
    });
  }
  if (canAccess(role, 'logs')) {
    items.push({ key: '/app/logs', icon: <HistoryOutlined />, label: '操作日志' });
  }
  if (canAccess(role, 'requisition')) {
    items.push({
      key: 'requisition',
      icon: <ThunderboltOutlined />,
      label: '产线领料',
      children: [
        { key: '/app/requisition/entry', icon: <ScanOutlined />, label: '领料录入' },
        { key: '/app/requisition/records', icon: <UnorderedListOutlined />, label: '领料记录' },
        { key: '/app/requisition/ledger', icon: <ClusterOutlined />, label: '产线台账' },
      ],
    });
  }

  const selected = [location.pathname];

  const onLogout = () => {
    logout();
    navigate('/login');
  };

  const changePwd = async () => {
    const v = await form.validateFields();
    await api.post('/auth/change-password', v);
    setUser({ ...user, mustChangePwd: false });
    message.success('密码修改成功');
    setCpOpen(false);
    form.resetFields();
  };

  return (
    <Layout style={{ height: '100%' }}>
      <Sider theme="dark" width={220} style={{ overflow: 'auto' }}>
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 15 }}>
          智能物料仓储系统
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={selected} items={items}
          onClick={({ key }) => key.startsWith('/') && navigate(key)} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 4px rgba(0,21,41,.08)' }}>
          <span style={{ color: '#888', fontSize: 13 }}>广州永旺食品有限公司 · 物料出入库管理平台</span>
          <Dropdown menu={{ items: [
            { key: 'cp', icon: <LockOutlined />, label: '修改密码', onClick: () => setCpOpen(true) },
            { key: 'out', icon: <LogoutOutlined />, label: '退出登录', onClick: onLogout },
          ] }}>
            <span style={{ cursor: 'pointer' }}>
              <Avatar icon={<UserOutlined />} style={{ background: '#1677ff', marginRight: 8 }} />
              {user.realName}
              <Tag color="blue" style={{ marginLeft: 8 }}>{ROLE_LABELS[role]}</Tag>
            </span>
          </Dropdown>
        </Header>
        <Content style={{ margin: 16, padding: 20, background: '#fff', borderRadius: 8, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>

      <Modal title="修改密码" open={cpOpen} onOk={changePwd} onCancel={() => setCpOpen(false)} okText="确定" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码（≥8位，含大小写与数字）" rules={[{ required: true, pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/, message: '需至少8位，含大小写字母与数字' }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}
