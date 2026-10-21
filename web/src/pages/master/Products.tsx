import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Space, Popconfirm, App as AntApp, Typography, Tag, Upload, Alert } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, GiftOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import api from '../../api';

const COLS = ['成品料号', '成品品名', '规格', '单位', '备注'];

export default function Products() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [kw, setKw] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const load = async () => {
    const r = await api.get('/products', { params: { q: kw } });
    setRows(r.data);
  };
  useEffect(() => { load(); }, [kw]);

  const openAdd = () => { setEditing(null); form.resetFields(); setOpen(true); };
  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({ code: r.code, name: r.name, spec: r.spec, unitMain: r.unit_main, remark: r.remark });
    setOpen(true);
  };
  const submit = async () => {
    const v = await form.validateFields();
    if (editing) await api.patch(`/products/${editing.id}`, v);
    else await api.post('/products', v);
    message.success('已保存'); setOpen(false); load();
  };
  const del = async (id: number) => {
    try {
      await api.delete(`/products/${id}`);
      message.success('已删除'); load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '删除失败');
    }
  };

  const beforeUpload = (file: any) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { message.error('仅支持 .xlsx / .xls / .csv'); return Upload.LIST_IGNORE; }
    return true;
  };
  const doImport = async (options: any) => {
    setImporting(true); setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', options.file);
      const { data } = await api.post('/products/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(data);
      message.success(`导入完成：成功 ${data.imported} 条，跳过 ${data.skipped} 条`);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '导入失败');
    } finally { setImporting(false); }
  };
  const downloadTemplate = () => {
    const csv = '﻿' + COLS.join(',') + '\n20105040000012,礼包用旺旺仙贝单包_52g,52g,包,\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '成品导入模板.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const columns = [
    { title: '成品料号', dataIndex: 'code', width: 160, render: (t: string) => <span style={{ fontFamily: 'monospace' }}>{t}</span> },
    { title: '成品品名', dataIndex: 'name' },
    { title: '规格', dataIndex: 'spec', render: (t: any) => t || '-' },
    { title: '单位', dataIndex: 'unit_main', width: 80, render: (t: any) => t || '-' },
    { title: '备注', dataIndex: 'remark', render: (t: any) => t || '-' },
    { title: '状态', dataIndex: 'status', width: 80, render: (t: string) => <Tag color={t === 'active' ? 'green' : 'default'}>{t === 'active' ? '启用' : '停用'}</Tag> },
    {
      title: '操作', width: 130, render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该成品？" onConfirm={() => del(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}><GiftOutlined /> 成品档案</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
        成品（产成品）独立于物料档案管理：成品不参与入库与库存，只有在此建档后才能在 BOM 配方中作为「成品料号」选用。物料档案只放包装物料。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search placeholder="搜索成品料号/品名/规格" allowClear value={kw} onChange={(e) => setKw(e.target.value)} style={{ width: 260 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增成品</Button>
        <Upload accept=".xlsx,.xls,.csv" beforeUpload={beforeUpload} customRequest={doImport} showUploadList={false} maxCount={1}>
          <Button icon={<UploadOutlined />} loading={importing}>Excel 导入成品</Button>
        </Upload>
        <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>
      </Space>
      {importResult && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message={`成功 ${importResult.imported} 条，跳过 ${importResult.skipped} 条。${(importResult.errors || []).join('；') || ''}`} />
      )}
      <Table rowKey="id" size="small" dataSource={rows} columns={columns} pagination={{ pageSize: 8 }} />

      <Modal title={editing ? '编辑成品' : '新增成品'} open={open} onOk={submit} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="code" label="成品料号" rules={[{ required: true, message: '请输入成品料号' }]}>
            <Input disabled={!!editing} placeholder="如 20105040000012" />
          </Form.Item>
          <Form.Item name="name" label="成品品名" rules={[{ required: true, message: '请输入成品品名' }]}>
            <Input placeholder="如 礼包用旺旺仙贝单包_52g" />
          </Form.Item>
          <Space align="start" style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="spec" label="规格"><Input style={{ width: 200 }} /></Form.Item>
            <Form.Item name="unitMain" label="单位"><Input style={{ width: 120 }} placeholder="包/箱" /></Form.Item>
          </Space>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
