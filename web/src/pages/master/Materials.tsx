import { useEffect, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, Tag, Space, Popconfirm, App as AntApp, Typography, Row, Col } from 'antd';
import { PlusOutlined, QrcodeOutlined, EditOutlined, DeleteOutlined, BarcodeOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import api from '../../api';

const ABC_COLORS: any = { A: 'red', B: 'orange', C: 'green' };

export default function Materials() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [opts, setOpts] = useState<any>({ suppliers: [], locations: [] });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [qr, setQr] = useState<any>(null);
  const [form] = Form.useForm();
  const [kw, setKw] = useState('');

  const load = async () => {
    const [m, o] = await Promise.all([api.get('/master/materials', { params: { q: kw } }), api.get('/master/options')]);
    setRows(m.data); setOpts(o.data);
  };
  useEffect(() => { load(); }, [kw]);

  const openAdd = () => { setEditing(null); form.resetFields(); setOpen(true); };
  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({
      code: r.code, name: r.name, category: r.category, remark: r.remark, barcode: r.barcode,
      unitMain: r.unitMain, unitSub: r.unitSub, unitFactor: r.unitFactor,
      abcClass: r.abcClass, supplierCode: r.supplierCode, locationCode: r.locationCode, safetyStock: r.safetyStock,
    });
    setOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    if (editing) await api.patch(`/master/materials/${editing.id}`, v);
    else await api.post('/master/materials', v);
    message.success('已保存');
    setOpen(false); load();
  };

  const del = async (id: number) => {
    await api.delete(`/master/materials/${id}`);
    message.success('已删除'); load();
  };

  const showQr = (r: any) => setQr(r);

  const columns = [
    { title: '物料编码', dataIndex: 'code', width: 100 },
    { title: '名称', dataIndex: 'name' },
    { title: '类别', dataIndex: 'category', width: 90, render: (t: any) => t ? <Tag color="blue">{t}</Tag> : <span style={{ color: '#bbb' }}>-</span> },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (t: any) => t || '-' },
    { title: '条码', dataIndex: 'barcode', width: 100, render: (t: any) => t ? <Tag icon={<BarcodeOutlined />}>{t}</Tag> : <span style={{ color: '#bbb' }}>手动编码</span> },
    { title: '单位', width: 130, render: (_: any, r: any) => r.unitSub ? `${r.unitMain}/${r.unitSub}(×${r.unitFactor})` : r.unitMain },
    { title: '供应商', render: (_: any, r: any) => r.supplierName || '-' },
    { title: '库位', render: (_: any, r: any) => r.locationCode || '-' },
    { title: 'ABC', dataIndex: 'abcClass', width: 60, render: (t: any) => <Tag color={ABC_COLORS[t]}>{t}</Tag> },
    { title: '操作', width: 180, render: (_: any, r: any) => (
      <Space>
        <Button size="small" icon={<QrcodeOutlined />} onClick={() => showQr(r)}>标签</Button>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
        <Popconfirm title="确认删除该物料？" onConfirm={() => del(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      </Space>
    ) },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>物料主数据（一物一码）</Typography.Title>
      <Space style={{ marginBottom: 12 }}>
        <Input.Search placeholder="搜索编码/名称" allowClear value={kw} onChange={(e) => setKw(e.target.value)} style={{ width: 260 }} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增物料</Button>
      </Space>
      <Table rowKey="id" size="small" dataSource={rows} columns={columns} pagination={{ pageSize: 8 }} />

      <Modal title={editing ? '编辑物料' : '新增物料'} open={open} onOk={submit} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}><Form.Item name="code" label="物料编码（一物一码）" rules={[{ required: true }]}><Input disabled={!!editing} /></Form.Item></Col>
            <Col span={10}><Form.Item name="name" label="物料名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="category" label="类别"><Input placeholder="如：薄饼类" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="barcode" label="物理条码（与编码解耦，可空）"><Input placeholder="留空则走手动料号兜底" /></Form.Item></Col>
            <Col span={12}><Form.Item name="remark" label="备注"><Input placeholder="如：1000米/卷" /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="unitMain" label="主单位" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="unitSub" label="副单位"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="unitFactor" label="换算系数"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={8}><Form.Item name="abcClass" label="ABC 分类" initialValue="C"><Select options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }]} /></Form.Item></Col>
            <Col span={8}><Form.Item name="supplierCode" label="供应商"><Select showSearch optionFilterProp="label" options={opts.suppliers.map((s: any) => ({ value: s.code, label: `${s.code} ${s.name}` }))} /></Form.Item></Col>
            <Col span={8}><Form.Item name="locationCode" label="库位"><Select showSearch optionFilterProp="label" options={opts.locations.map((l: any) => ({ value: l.code, label: `${l.code} ${l.name}` }))} /></Form.Item></Col>
          </Row>
          <Form.Item name="safetyStock" label="安全库存"><InputNumber style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="二维码标签预览" open={!!qr} onCancel={() => setQr(null)} onOk={() => setQr(null)} okText="关闭">
        {qr && (
          <div style={{ textAlign: 'center' }}>
            <QRCodeSVG value={JSON.stringify({ code: qr.code, name: qr.name, batch: '', date: '', shelf: qr.safetyStock, supplier: qr.supplierName })} size={180} />
            <div style={{ marginTop: 10 }}>{qr.code} · {qr.name}</div>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
              扫码即带出：物料编码 + 批次 + 生产日期 + 保质期 + 供应商（入库模块补全批次/效期字段）
            </Typography.Paragraph>
          </div>
        )}
      </Modal>
    </div>
  );
}
