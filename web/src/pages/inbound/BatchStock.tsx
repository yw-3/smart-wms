import { useEffect, useState } from 'react';
import { Table, Card, Typography, Space, Statistic, Row, Col, Alert, Segmented, App as AntApp } from 'antd';
import { ReloadOutlined, WarningOutlined, CheckCircleOutlined } from '@ant-design/icons';
import api from '../../api';

export default function BatchStock() {
  const { message } = AntApp.useApp();
  const [batches, setBatches] = useState<any[]>([]);
  const [stock, setStock] = useState<any[]>([]);
  const [view, setView] = useState<string>('批次');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [b, s] = await Promise.all([api.get('/inbound/batches'), api.get('/inbound/stock')]);
      setBatches(b.data);
      setStock(s.data);
    } catch {
      message.error('加载库存失败');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const pendingCount = batches.filter((b) => b.quality_status !== '合格').length;
  const totalQty = batches.reduce((s, b) => s + b.qty, 0);
  const availableQty = batches.filter((b) => b.quality_status === '合格').reduce((s, b) => s + b.qty, 0);

  const batchColumns: any[] = [
    { title: '物料编码', dataIndex: 'material_code', width: 110 },
    { title: '物料名称', dataIndex: 'material_name' },
    { title: '库位', dataIndex: 'location_code', width: 100 },
    { title: '批次号', dataIndex: 'batch_no', width: 120 },
    { title: '批次数量', dataIndex: 'qty', width: 100 },
    { title: '供应商', dataIndex: 'supplier_code', width: 90 },
  ];

  const stockColumns: any[] = [
    { title: '物料编码', dataIndex: 'material_code', width: 110 },
    { title: '物料名称', dataIndex: 'material_name' },
    { title: '库位', dataIndex: 'location_code', width: 100 },
    { title: '总库存（含待检）', dataIndex: 'qty_total', width: 150 },
    {
      title: '可用库存（仅合格）', dataIndex: 'qty_available', width: 150,
      render: (v: number, r: any) => (
        <span style={{ color: r.qty_available < r.qty_total ? '#fa8c16' : '#52c41a', fontWeight: 600 }}>{v}</span>
      ),
    },
    { title: '更新时间', dataIndex: 'updated_at', width: 160 },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>库存查询（库位 + 批次）</Typography.Title>

      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}>
          <Card size="small"><Statistic title="批次总数" value={batches.length} suffix="批" /></Card>
        </Col>
        <Col span={6}>
          <Card size="small"><Statistic title="在库总量" value={totalQty} precision={3} /></Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="可用量（合格）" value={availableQty} precision={3} prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="受限批次（禁止领用）" value={pendingCount} suffix="批" prefix={<WarningOutlined style={{ color: '#fa541c' }} />} />
          </Card>
        </Col>
      </Row>

      {pendingCount > 0 && (
        <Alert
          type="warning" showIcon icon={<WarningOutlined />} style={{ marginBottom: 12 }}
          message={`存在 ${pendingCount} 个「待检/不合格」批次，已从可用库存中扣除，须质检确认转「合格」后方可领用`}
        />
      )}

      <Space style={{ marginBottom: 12 }}>
        <Segmented value={view} onChange={(v) => setView(v as string)} options={['批次', '库位汇总']} />
        <span style={{ color: '#888', fontSize: 12 }}>库存精确到「库位 + 批次」，数据随入库提交与质检实时更新</span>
      </Space>

      {view === '批次' ? (
        <Table rowKey="id" size="small" loading={loading} dataSource={batches} columns={batchColumns}
          pagination={{ pageSize: 10 }} rowClassName={(r: any) => (r.quality_status !== '合格' ? 'row-warn' : '')} />
      ) : (
        <Table rowKey="id" size="small" loading={loading} dataSource={stock} columns={stockColumns} pagination={{ pageSize: 10 }} />
      )}

      <style>{`.row-warn td { background: #fff7e6 !important; }`}</style>
    </div>
  );
}