import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, App as AntApp, Popconfirm, Tag, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../api';

export default function Suppliers() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = () => api.get('/master/suppliers').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); form.resetFields(); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const submit = async () => {
    const v = await form.validateFields();
    if (editing) await api.patch(`/master/suppliers/${editing.id}`, v);
    else await api.post('/master/suppliers', v);
    message.success('已保存'); setOpen(false); load();
  };
  const del = async (id: number) => { await api.delete(`/master/suppliers/${id}`); message.success('已删除'); load(); };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>供应商档案</Typography.Title>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={openAdd}>新增供应商</Button>
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 8 }} columns={[
        { title: '编码', dataIndex: 'code', width: 100 },
        { title: '名称', dataIndex: 'name' },
        { title: '联系人', dataIndex: 'contact', render: (t: any) => t || '-' },
        { title: '电话', dataIndex: 'phone', render: (t: any) => t || '-' },
        { title: '地址', dataIndex: 'address', render: (t: any) => t || '-' },
        { title: '状态', dataIndex: 'status', width: 80, render: (t: any) => <Tag color={t === 'active' ? 'green' : 'red'}>{t === 'active' ? '启用' : '停用'}</Tag> },
        { title: '操作', width: 130, render: (_: any, r: any) => (
          <span>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />{' '}
            <Popconfirm title="确认删除？" onConfirm={() => del(r.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
          </span>
        ) },
      ]} />
      <Modal title={editing ? '编辑供应商' : '新增供应商'} open={open} onOk={submit} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="供应商编码" rules={[{ required: true }]}><Input disabled={!!editing} /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="contact" label="联系人"><Input /></Form.Item>
          <Form.Item name="phone" label="电话"><Input /></Form.Item>
          <Form.Item name="address" label="地址"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
