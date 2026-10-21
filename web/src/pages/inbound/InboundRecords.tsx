import { useEffect, useState } from 'react';
import {
  Card, Table, Button, Space, Input, Select, DatePicker, Tag, Popconfirm,
  Modal, Form, InputNumber, App as AntApp, Typography, Row, Col,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, DownloadOutlined, EditOutlined, StopOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api';
import { useAuth } from '../../store';

const { RangePicker } = DatePicker;

export default function InboundRecords() {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [range, setRange] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (q) params.q = q;
      if (status) params.status = status;
      if (range?.[0] && range?.[1]) {
        params.from = dayjs(range[0]).format('YYYY-MM-DD');
        params.to = dayjs(range[1]).format('YYYY-MM-DD');
      }
      const r = await api.get('/inbound', { params });
      setRows(r.data);
    } catch {
      message.error('加载入库记录失败');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [status]);

  const canModify = (r: any) => {
    if (['manager', 'supervisor', 'admin'].includes(user?.role || '')) return true;
    return user?.role === 'preparer' && r.operator_id === user?.id;
  };

  const openEdit = (r: any) => {
    setEditing(r);
    form.setFieldsValue({
      qty: r.qty, batchNo: r.batch_no, supplierCode: r.supplier_code,
      locationCode: r.location_code, remark: r.remark,
    });
    setOpen(true);
  };

  const saveEdit = async () => {
    const v = await form.validateFields();
    await api.patch(`/inbound/${editing.id}`, v);
    message.success('单据已更新，库存已同步');
    setOpen(false); load();
  };

  const voidOrder = async (r: any) => {
    await api.post(`/inbound/${r.id}/void`);
    message.success('单据已作废，库存已冲销');
    load();
  };

  const doExport = async () => {
    const params: any = {};
    if (q) params.q = q;
    if (status) params.status = status;
    const res = await api.get('/inbound/export', { params, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `入库记录_${dayjs().format('YYYY-MM-DD')}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('已导出 Excel');
  };

  const columns: any[] = [
    { title: '单号', dataIndex: 'order_no', width: 150 },
    {
      title: '物料', width: 180,
      render: (_: any, r: any) => (
        <span>{r.material_code} <span style={{ color: '#888' }}>{r.material_name}</span></span>
      ),
    },
    { title: '数量', dataIndex: 'qty', width: 80 },
    { title: '批次号', dataIndex: 'batch_no', width: 110 },
    { title: '供应商', dataIndex: 'supplier_code', width: 90 },
    { title: '库位', dataIndex: 'location_code', width: 90 },
    { title: '操作员', dataIndex: 'operator_name', width: 90 },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (t: any) => <Tag color={t === '已提交' ? 'blue' : 'default'}>{t}</Tag>,
    },
    {
      title: '操作', width: 160, fixed: 'right',
      render: (_: any, r: any) => (
        <Space size={4}>
          {r.status !== '已作废' && canModify(r) && (
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>修改</Button>
          )}
          {r.status !== '已作废' && canModify(r) && (
            <Popconfirm title="作废后将冲销对应库存，确认？" onConfirm={() => voidOrder(r)}>
              <Button size="small" danger icon={<StopOutlined />}>作废</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>入库记录</Typography.Title>

      <Space style={{ marginBottom: 12 }} wrap>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索物料/批次" allowClear value={q}
          onChange={(e) => setQ(e.target.value)} onPressEnter={load} style={{ width: 200 }}
        />
        <Select
          allowClear placeholder="单据状态" value={status} onChange={setStatus} style={{ width: 130 }}
          options={[{ value: '已提交', label: '已提交' }, { value: '已作废', label: '已作废' }]}
        />
        <RangePicker value={range} onChange={setRange} />
        <Button type="primary" icon={<SearchOutlined />} onClick={load}>查询</Button>
        <Button icon={<ReloadOutlined />} onClick={() => { setQ(''); setStatus(undefined); setRange(null); }}>重置</Button>
        <Button icon={<DownloadOutlined />} onClick={doExport}>导出 Excel</Button>
      </Space>

      {!['manager', 'supervisor', 'admin'].includes(user?.role || '') && (
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
          提示：当前账号可修改「本人提交」的单据；修改 / 作废由物管 / 生产组长 / 管理员无限制执行。
        </div>
      )}

      <Table
        rowKey="id" size="small" loading={loading} dataSource={rows} columns={columns}
        scroll={{ x: 1250 }} pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
      />

      <Modal title={`修改入库单 ${editing?.order_no || ''}`} open={open} onOk={saveEdit} onCancel={() => setOpen(false)} okText="保存" cancelText="取消" destroyOnClose>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}><Form.Item name="qty" label="入库数量" rules={[{ required: true }]}><InputNumber style={{ width: '100%' }} min={0.001} /></Form.Item></Col>
            <Col span={12}><Form.Item name="batchNo" label="生产批次号" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="supplierCode" label="供应商" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="locationCode" label="指定库位" rules={[{ required: true }]}><Input /></Form.Item></Col>
          </Row>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}