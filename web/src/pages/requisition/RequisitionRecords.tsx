import { useEffect, useState, useMemo } from 'react';
import {
  Card, Table, Tag, Button, Space, Input, Select, App as AntApp, Drawer, Popconfirm,
  Typography, Row, Col, Form,
} from 'antd';
import { SearchOutlined, ReloadOutlined, ExportOutlined, EyeOutlined, EditOutlined, StopOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../api';
import { useAuth } from '../../store';

const STATUS_COLORS: Record<string, string> = { 已提交: 'green', 已作废: 'default' };

export default function RequisitionRecords() {
  const { message } = AntApp.useApp();
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [lineNo, setLineNo] = useState<number | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [detail, setDetail] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const [editItems, setEditItems] = useState<any[]>([]);
  const [allMain, setAllMain] = useState<any[]>([]);
  const [fd, setFd] = useState<any>({ materials: [], lines: [] });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/requisition', { params: { q: q || undefined, lineNo, status } });
      setRows(r.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const loadBase = async () => {
    const [f, m] = await Promise.all([api.get('/requisition/form-data'), api.get('/requisition/main-batches')]);
    setFd(f.data); setAllMain(m.data);
  };

  const canModify = (o: any) =>
    ['manager', 'supervisor', 'admin'].includes(user?.role || '') ||
    (user?.role === 'picker' && o.operator_id === user?.id);

  const openDetail = async (id: number) => {
    const r = await api.get('/requisition/' + id);
    setDetail(r.data); setDetailOpen(true);
  };

  const openModify = async (o: any) => {
    await loadBase();
    const r = await api.get('/requisition/' + o.id);
    setEditItems(r.data.items.map((it: any) => ({
      materialCode: it.material_code, qty: it.qty, batchNo: it.batch_no, fromLocationCode: it.from_location_code,
    })));
    setDetail({ ...o, source_type: o.source_type });
    setModifyOpen(true);
  };

  const batchesOf = (code: string) => allMain.filter((b) => b.material_code === code);

  const updateEdit = (idx: number, patch: any) => {
    const next = [...editItems];
    next[idx] = { ...next[idx], ...patch };
    if (patch.materialCode && patch.materialCode !== editItems[idx].materialCode) {
      const elig = batchesOf(patch.materialCode).filter((b) => b.eligible).sort((a, b) => (a.expiry_date || '').localeCompare(b.expiry_date || ''));
      if (elig[0]) { next[idx].batchNo = elig[0].batch_no; next[idx].fromLocationCode = elig[0].location_code; }
      else { next[idx].batchNo = undefined; next[idx].fromLocationCode = undefined; }
    }
    setEditItems(next);
  };

  const saveModify = async () => {
    const items = editItems.filter((it) => it.materialCode && it.batchNo && it.qty > 0)
      .map((it) => ({ materialCode: it.materialCode, qty: Number(it.qty), batchNo: it.batchNo, fromLocationCode: it.fromLocationCode }));
    if (!items.length) return message.error('请至少保留一条有效明细');
    setSaving(true);
    try {
      await api.patch('/requisition/' + detail.id, { items, sourceType: detail.source_type, remark: detail.remark });
      message.success('修改成功，库存已重算');
      setModifyOpen(false); load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '修改失败');
    } finally { setSaving(false); }
  };

  const doVoid = async (id: number) => {
    try {
      await api.post('/requisition/' + id + '/void');
      message.success('已作废并冲销线边仓');
      load(); setDetailOpen(false);
    } catch (e: any) { message.error(e.response?.data?.error || '作废失败'); }
  };

  const materialOptions = fd.materials.map((m: any) => ({ value: m.code, label: `${m.code} · ${m.name}` }));
  const lineOptions = [{ value: undefined, label: '全部线别' }, ...fd.lines.map((l: any) => ({ value: l.line_no, label: `${l.line_no}号线` }))];

  const columns = [
    { title: '领料单号', dataIndex: 'order_no', width: 160 },
    { title: '线别', render: (_: any, r: any) => `${r.line_no}号线`, width: 80 },
    { title: '来源', dataIndex: 'source_type', width: 80, render: (t: string) => <Tag color={t === 'BOM' ? 'blue' : 'purple'}>{t}</Tag> },
    { title: '明细项', dataIndex: 'item_count', width: 70 },
    { title: '领料人', dataIndex: 'operator_name', width: 90 },
    { title: '状态', dataIndex: 'status', width: 90, render: (t: string) => <Tag color={STATUS_COLORS[t] || 'default'}>{t}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 160 },
    {
      title: '操作', width: 200, fixed: 'right' as const,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)}>查看</Button>
          {canModify(r) && r.status !== '已作废' && (
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openModify(r)}>改单</Button>
          )}
          {canModify(r) && r.status !== '已作废' && (
            <Popconfirm title="确认作废并冲销线边仓？" onConfirm={() => doVoid(r.id)} okText="作废" cancelText="取消">
              <Button size="small" danger icon={<StopOutlined />}>作废</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const detailColumns = [
    { title: '物料', render: (_: any, r: any) => `${r.material_code} ${r.material_name}` },
    { title: '数量', dataIndex: 'qty', width: 80 },
    { title: '批次', dataIndex: 'batch_no', width: 120 },
    { title: '来源库位', dataIndex: 'from_location_code', width: 110 },
    { title: '目标库位', dataIndex: 'to_location_code', width: 110 },
    { title: '效期', dataIndex: 'expiry_date', width: 120 },
  ];

  const editColumns = [
    { title: '物料', width: 220, render: (_: any, _r: any, idx: number) => (
      <Select showSearch optionFilterProp="label" style={{ width: '100%' }} value={editItems[idx].materialCode} options={materialOptions}
        onChange={(v) => updateEdit(idx, { materialCode: v })} /> ),
    },
    { title: '数量', width: 110, render: (_: any, _r: any, idx: number) => (
      <Input placeholder="数量" value={editItems[idx].qty} onChange={(e) => updateEdit(idx, { qty: e.target.value })} /> ),
    },
    { title: '批次', render: (_: any, _r: any, idx: number) => {
      const it = editItems[idx];
      const opts = batchesOf(it.materialCode || '').map((b) => ({ value: b.batch_no, disabled: !b.eligible, label: `${b.batch_no} ×${b.qty} @${b.location_code} 效期${b.expiry_date}${b.eligible ? '' : '（禁领）'}` }));
      return <Select showSearch style={{ width: '100%' }} value={it.batchNo} options={opts}
        onChange={(v) => { const b = batchesOf(it.materialCode || '').find((x) => x.batch_no === v); updateEdit(idx, { batchNo: v, fromLocationCode: b?.location_code }); }} />;
    } },
    { title: '', width: 50, render: (_: any, _r: any, idx: number) => <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => setEditItems(editItems.filter((_, i) => i !== idx))} /> },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>领料记录</Typography.Title>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Row gutter={8} align="middle">
          <Col><Input allowClear prefix={<SearchOutlined />} placeholder="单号/备注" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 180 }} onPressEnter={load} /></Col>
          <Col><Select value={lineNo} options={lineOptions} style={{ width: 130 }} onChange={setLineNo} /></Col>
          <Col><Select value={status} placeholder="状态" style={{ width: 120 }} onChange={setStatus}
            options={[{ value: undefined, label: '全部状态' }, { value: '已提交', label: '已提交' }, { value: '已作废', label: '已作废' }]} /></Col>
          <Col><Button type="primary" icon={<SearchOutlined />} onClick={load}>查询</Button></Col>
          <Col><Button icon={<ReloadOutlined />} onClick={() => { setQ(''); setLineNo(undefined); setStatus(undefined); load(); }}>重置</Button></Col>
          <Col><Button icon={<ExportOutlined />} onClick={() => {
            const params = new URLSearchParams();
            if (q) params.set('q', q); if (lineNo) params.set('lineNo', String(lineNo)); if (status) params.set('status', status);
            window.open('/api/requisition/export?' + params.toString(), '_blank');
          }}>导出 Excel</Button></Col>
        </Row>
      </Card>

      <Card size="small">
        <Table rowKey="id" size="small" loading={loading} dataSource={rows} columns={columns}
          scroll={{ x: 1000 }} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer title={detail ? `领料单 ${detail.order_no}` : '详情'} open={detailOpen} width={680} onClose={() => setDetailOpen(false)}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            <Typography.Text>线别：{detail.line_no}号线　来源：{detail.source_type}　领料人：{detail.operator_name}　状态：<Tag color={STATUS_COLORS[detail.status]}>{detail.status}</Tag></Typography.Text>
            <Typography.Text>备注：{detail.remark || '—'}</Typography.Text>
            <Table rowKey="id" size="small" dataSource={detail.items} columns={detailColumns} pagination={false} />
          </Space>
        )}
      </Drawer>

      <Drawer title="改单" open={modifyOpen} width={720} onClose={() => setModifyOpen(false)}
        extra={<Space>
          <Button onClick={() => setModifyOpen(false)}>取消</Button>
          <Button type="primary" loading={saving} onClick={saveModify}>保存修改</Button>
        </Space>}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">单号 {detail.order_no}（{detail.line_no}号线，来源 {detail.source_type}）— 仅可调整明细，库存将按新明细重算调拨。</Typography.Text>
            <Button type="dashed" icon={<PlusOutlined />} onClick={() => setEditItems([...editItems, { materialCode: undefined, qty: 1, batchNo: undefined, fromLocationCode: undefined }])}>添加明细</Button>
            <Table rowKey={(_, i) => String(i)} size="small" dataSource={editItems} columns={editColumns} pagination={false} />
          </Space>
        )}
      </Drawer>
    </div>
  );
}
