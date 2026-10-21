import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, App as AntApp, Popconfirm, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../api';

export default function Units() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();

  const load = () => api.get('/master/units').then((r) => setRows(r.data));
  useEffect(() => { load(); }, []);

  const openAdd = () => { setEditing(null); form.resetFields(); setOpen(true); };
  const openEdit = (r: any) => { setEditing(r); form.setFieldsValue(r); setOpen(true); };
  const submit = async () => {
    const v = await form.validateFields();
    if (editing) await api.patch(`/master/units/${editing.id}`, v);
    else await api.post('/master/units', v);
    message.success('已保存'); setOpen(false); load();
  };
  const del = async (id: number) => { await api.delete(`/master/units/${id}`); message.success('已删除'); load(); };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>单位与换算</Typography.Title>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={openAdd}>新增换算规则</Button>
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 8 }} columns={[
        { title: '主单位', dataIndex: 'main_unit', width: 100 },
        { title: '副单位', dataIndex: 'sub_unit', width: 100, render: (t: any) => t || '-' },
        { title: '换算关系', render: (_: any, r: any) => r.sub_unit ? `1 ${r.main_unit} = ${r.factor} ${r.sub_unit}` : '无副单位（标准核算单位）' },
        { title: '说明', dataIndex: 'note', render: (t: any) => t || '-' },
        { title: '操作', width: 120, render: (_: any, r: any) => (
          <span>
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />{' '}
            <Popconfirm title="确认删除？" onConfirm={() => del(r.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
          </span>
        ) },
      ]} />
      <Modal title={editing ? '编辑换算' : '新增换算'} open={open} onOk={submit} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="mainUnit" label="主单位" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="subUnit" label="副单位（可空）"><Input /></Form.Item>
          <Form.Item name="factor" label="换算系数（1 主单位 = ? 副单位）"><InputNumber style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="note" label="说明"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
