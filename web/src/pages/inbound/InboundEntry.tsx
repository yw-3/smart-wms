import { useEffect, useState } from 'react';
import {
  Card, Form, Input, InputNumber, Select, Button, Space, Row, Col,
  Typography, App as AntApp, Alert, Table, Divider, AutoComplete,
} from 'antd';
import { ScanOutlined, SendOutlined, ReloadOutlined, InfoCircleOutlined } from '@ant-design/icons';
import api from '../../api';

export default function InboundEntry() {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [opts, setOpts] = useState<any>({ materials: [], suppliers: [], locations: [] });
  const [resolved, setResolved] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const loadOpts = async () => {
    const o = await api.get('/inbound/form-data');
    setOpts(o.data);
  };
  const loadRecent = async () => {
    const r = await api.get('/inbound', { params: { limit: 5 } });
    setRecent(r.data.slice(0, 5));
  };
  useEffect(() => { loadOpts(); loadRecent(); }, []);

  // PDA 扫码 / 手动输入料号 → 解析物料并回填
  const resolveMaterial = async (raw: string) => {
    const code = (raw || '').trim();
    if (!code) return;
    try {
      const r = await api.get('/inbound/resolve', { params: { code } });
      const m = r.data;
      setResolved(m);
      form.setFieldsValue({
        materialCode: m.code,
        materialName: m.name,
        supplierCode: m.supplier_code || undefined,
        locationCode: m.location_code || undefined,
      });
      message.success(`已识别：${m.code} ${m.name}`);
    } catch (e: any) {
      setResolved(null);
      form.setFieldsValue({ materialCode: undefined, materialName: undefined });
      message.warning(e.response?.data?.error || '未匹配到物料，请检查条码或手动选择');
    }
  };

  const submit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      const r = await api.post('/inbound', v);
      message.success(`入库成功，单号 ${r.data.orderNo}`);
      form.resetFields();
      setResolved(null);
      loadRecent();
    } catch (e: any) {
      message.error(e.response?.data?.error || '提交失败，请检查必填项');
    } finally {
      setSubmitting(false);
    }
  };

  const materialOptions = opts.materials.map((m: any) => ({
    value: m.code,
    label: `${m.code} · ${m.name}`,
  }));

  const recentColumns = [
    { title: '单号', dataIndex: 'order_no', width: 150 },
    { title: '物料', render: (_: any, r: any) => `${r.material_code} ${r.material_name}` },
    { title: '数量', dataIndex: 'qty', width: 70 },
    { title: '批次', dataIndex: 'batch_no', width: 110 },
    { title: '库位', dataIndex: 'location_code', width: 90 },
    { title: '操作员', dataIndex: 'operator_name', width: 90 },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>备料入库</Typography.Title>

      <Alert
        type="info" showIcon icon={<InfoCircleOutlined />}
        message="录入说明"
        description="PDA 扫描物料条码或手动输入料号自动识别物料；录入数量、批次、供应商与库位后提交，库存实时更新，提交后即可领用。"
        style={{ marginBottom: 12 }}
      />

      <Card size="small" style={{ marginBottom: 12 }}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                label="物料料号 / 条码（PDA 扫描或手动输入）"
                required
                validateStatus={!resolved && form.getFieldValue('materialCode') ? 'error' : undefined}
              >
                <AutoComplete
                  options={materialOptions}
                  value={form.getFieldValue('materialCode')}
                  onSearch={(v) => { form.setFieldsValue({ materialCode: v || undefined }); }}
                  onSelect={(v) => resolveMaterial(v)}
                  filterOption={(input, opt) => String(opt?.label || '').toLowerCase().includes(input.toLowerCase())}
                  notFoundContent={null}
                >
                  <Input
                    suffix={<Button size="small" type="text" icon={<ScanOutlined />} onClick={() => message.info('请将 PDA 光标对准条码，或手动输入料号后回车')} />}
                    onPressEnter={(e) => resolveMaterial((e.target as HTMLInputElement).value)}
                    placeholder="如 BM320 / M0001"
                  />
                </AutoComplete>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="物料名称" required>
                <Input value={resolved?.name} readOnly placeholder="扫码后自动带出" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="materialCode" label="物料料号" hidden><Input /></Form.Item>
              <Form.Item name="materialName" hidden><Input /></Form.Item>
              <Form.Item name="qty" label="入库数量" rules={[{ required: true, message: '请输入入库数量' }]}>
                <InputNumber style={{ width: '100%' }} min={0.001} placeholder="数量" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="batchNo" label="生产批次号" rules={[{ required: true, message: '请输入生产批次号' }]}>
                <Input placeholder="如 B20261020" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="supplierCode" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择供应商"
                  options={opts.suppliers.map((s: any) => ({ value: s.code, label: `${s.code} ${s.name}` }))} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="locationCode" label="指定库位" rules={[{ required: true, message: '请选择库位' }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择库位（主仓/线边仓）"
                  options={opts.locations.map((l: any) => ({ value: l.code, label: `${l.code} ${l.name}（${l.type}）` }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="remark" label="备注">
                <Input placeholder="选填" />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '4px 0 12px' }} />
          <Space>
            <Button type="primary" icon={<SendOutlined />} loading={submitting} onClick={submit}>提交入库</Button>
            <Button icon={<ReloadOutlined />} onClick={() => { form.resetFields(); setResolved(null); }}>重置</Button>
          </Space>
        </Form>
      </Card>

      <Card size="small" title="最近入库记录">
        <Table rowKey="id" size="small" dataSource={recent} columns={recentColumns} pagination={false} />
      </Card>
    </div>
  );
}