import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, App as AntApp, Popconfirm, Tag, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../api';

export default function Locations() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = () => api.get('/master/locations').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ type: '主仓' }); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const submit = async () => {
    const v = await form.validateFields();
    if (editing) await api.patch(`/master/locations/${editing.id}`, v);
    else await api.post('/master/locations', v);
    message.success('已保存'); setOpen(false); load();
  };
  const del = async (id: number) => { await api.delete(`/master/locations/${id}`); message.success('已删除'); load(); };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>库位档案（货架-层-位）</Typography.Title>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={openAdd}>新增库位</Button>
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 8 }} columns={[
        { title: '库位编码', dataIndex: 'code', width: 110, render: (t: any) => <Tag color="geekblue">{t}</Tag> },
        { title: '名称', dataIndex: 'name' },
        { title: '类型', dataIndex: 'type', width: 90, render: (t: any) => <Tag color={t === '主仓' ? 'blue' : 'purple'}>{t}</Tag> },
        { title: '说明', dataIndex: 'description', render: (t: any) => t || '-' },
        { title: '操作', width: 120, render: (_: any, r: any) => (
          <span>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />{' '}
            <Popconfirm title="确认删除？" onConfirm={() => del(r.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
          </span>
        ) },
      ]} />
      <Modal title={editing ? '编辑库位' : '新增库位'} open={open} onOk={submit} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="库位编码（如 A-03-02）" rules={[{ required: true }]}><Input disabled={!!editing} /></Form.Item>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true }]}><Select options={[{ value: '主仓', label: '主仓' }, { value: '线边仓', label: '线边仓' }]} /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
