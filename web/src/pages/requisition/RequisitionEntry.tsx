import { useEffect, useMemo, useState } from 'react';
import {
  Card, Form, Select, InputNumber, Input, Button, Table, Tag, Alert, Tabs, Modal,
  App as AntApp, Space, Row, Col, Typography, Divider,
} from 'antd';
import { ThunderboltOutlined, PlusOutlined, DeleteOutlined, SendOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import api from '../../api';

export default function RequisitionEntry() {
  const { message, modal } = AntApp.useApp();
  const [form] = Form.useForm();
  const [fd, setFd] = useState<any>({ materials: [], lines: [], products: [], bomMap: {}, lineSideLocations: [] });
  const [allMain, setAllMain] = useState<any[]>([]); // 主仓全部可用批次（含不合格标识）
  const [activeTab, setActiveTab] = useState('bom');
  const [bomPlan, setBomPlan] = useState<any[]>([]);
  const [pickMap, setPickMap] = useState<Record<string, number>>({});
  const [manualItems, setManualItems] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const loadBase = async () => {
    const [f, m] = await Promise.all([
      api.get('/requisition/form-data'),
      api.get('/requisition/main-batches'),
    ]);
    setFd(f.data);
    setAllMain(m.data);
  };
  useEffect(() => { loadBase(); }, []);

  const lineOptions = fd.lines.map((l: any) => ({ value: l.line_no, label: `${l.line_no}号线${l.line_location_code ? `（${l.line_location_code}）` : ''}` }));
  const lineSideOptions = (fd.lineSideLocations || []).map((l: any) => ({ value: l.code, label: `${l.code} ${l.name}` }));
  // 选产线后自动带出该线绑定的线边仓（未绑定则留空由用户选）
  const onLineChange = (lineNo: number) => {
    const line = fd.lines.find((l: any) => l.line_no === Number(lineNo));
    form.setFieldsValue({ toLoc: line?.line_location_code || undefined });
  };
  const productOptions = fd.products.map((p: any) => ({ value: p.code, label: `${p.code} · ${p.name}` }));
  const materialOptions = fd.materials.map((m: any) => ({ value: m.code, label: `${m.code} · ${m.name}` }));

  // ===== BOM 模式 =====
  const genBomPlan = async () => {
    const productCode = form.getFieldValue('productCode');
    const planQty = Number(form.getFieldValue('planQty'));
    if (!productCode) return message.warning('请先选择成品');
    if (!(planQty > 0)) return message.warning('请输入计划产量');
    try {
      const r = await api.get('/requisition/bom-plan', { params: { productCode, qty: planQty } });
      setBomPlan(r.data.plan);
      const pm: Record<string, number> = {};
      for (const c of r.data.plan) pm[c.componentCode] = Math.min(c.need, c.allocated);
      setPickMap(pm);
    } catch (e: any) {
      message.error(e.response?.data?.error || '生成计划失败');
    }
  };

  const overPickList = useMemo(
    () => bomPlan.filter((c) => (pickMap[c.componentCode] || 0) > c.need),
    [bomPlan, pickMap]
  );

  const buildBomItems = () => {
    const items: any[] = [];
    for (const c of bomPlan) {
      let need = pickMap[c.componentCode] || 0;
      if (need <= 0) continue;
      for (const bat of c.batches) {
        if (need <= 0) break;
        const take = Math.min(need, bat.qty);
        items.push({ materialCode: c.componentCode, qty: take, batchNo: bat.batchNo, fromLocationCode: bat.fromLocationCode });
        need -= take;
      }
    }
    return items;
  };

  // ===== 手动模式 =====
  const batchesOf = (materialCode: string) =>
    allMain.filter((b) => b.material_code === materialCode);

  const addManual = () => setManualItems([...manualItems, { materialCode: undefined, qty: 1, batchNo: undefined, fromLocationCode: undefined }]);
  const updateManual = (idx: number, patch: any) => {
    const next = [...manualItems];
    next[idx] = { ...next[idx], ...patch };
    // 切换物料时自动推荐 FIFO 批次
    if (patch.materialCode && patch.materialCode !== manualItems[idx].materialCode) {
      const elig = batchesOf(patch.materialCode).filter((b) => b.eligible).sort((a, b) => (a.expiry_date || '').localeCompare(b.expiry_date || ''));
      if (elig[0]) { next[idx].batchNo = elig[0].batch_no; next[idx].fromLocationCode = elig[0].location_code; }
      else { next[idx].batchNo = undefined; next[idx].fromLocationCode = undefined; }
    }
    setManualItems(next);
  };
  const removeManual = (idx: number) => setManualItems(manualItems.filter((_, i) => i !== idx));

  const submit = async () => {
    const v = await form.validateFields();
    const lineNo = Number(v.lineNo);
    if (!(lineNo >= 1 && lineNo <= 6)) return message.error('请选择产线（1-6号线）');
    if (!v.toLoc) return message.error('请选择目标线边仓库位');

    let items: any[] = [];
    if (activeTab === 'bom') {
      if (!bomPlan.length) return message.error('请先按 BOM 生成领料计划');
      items = buildBomItems();
      if (overPickList.length) {
        const ok = await new Promise<boolean>((resolve) =>
          modal.confirm({
            title: '超领确认', icon: <WarningOutlined />,
            content: `以下物料实领数量超过 BOM 需求，确认为计划外超领？\n${overPickList.map((c) => `${c.componentCode} ${c.name}：需求 ${c.need} / 实领 ${pickMap[c.componentCode]}`).join('\n')}`,
            okText: '确认超领', cancelText: '取消', onOk: () => resolve(true), onCancel: () => resolve(false),
          })
        );
        if (!ok) return;
      }
    } else {
      items = manualItems
        .filter((it) => it.materialCode && it.batchNo && it.qty > 0)
        .map((it) => ({ materialCode: it.materialCode, qty: Number(it.qty), batchNo: it.batchNo, fromLocationCode: it.fromLocationCode }));
      if (!items.length) return message.error('请至少添加一条有效领料明细');
    }
    if (!items.length) return message.error('领料明细为空');

    setSubmitting(true);
    try {
      const payload = {
        lineNo, toLoc: v.toLoc, sourceType: activeTab === 'bom' ? 'BOM' : '手动',
        productCode: activeTab === 'bom' ? v.productCode : undefined,
        remark: v.remark, items,
      };
      const r = await api.post('/requisition', payload);
      message.success(`领料成功，单号 ${r.data.orderNo}（主仓→线边仓已调拨）`);
      form.resetFields();
      setBomPlan([]); setPickMap({}); setManualItems([]);
    } catch (e: any) {
      message.error(e.response?.data?.error || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  // ===== 表格列 =====
  const bomColumns = [
    { title: '组件物料', render: (_: any, c: any) => `${c.componentCode} ${c.name}` },
    { title: '单耗', dataIndex: 'qtyPerUnit', width: 70 },
    { title: '需求', dataIndex: 'need', width: 70 },
    {
      title: '已分配', dataIndex: 'allocated', width: 80,
      render: (t: number, c: any) => (t < c.need ? <Tag color="red">{t}（缺 {c.shortage}）</Tag> : <Tag color="green">{t}</Tag>),
    },
    {
      title: '实领数量', width: 110,
      render: (_: any, c: any) => (
        <InputNumber
          size="small" min={0} max={c.allocated} style={{ width: '100%' }}
          value={pickMap[c.componentCode] || 0}
          onChange={(val) => setPickMap({ ...pickMap, [c.componentCode]: Number(val) || 0 })}
        />
      ),
    },
    {
      title: 'FIFO 推荐批次', render: (_: any, c: any) => (
        <Space direction="vertical" size={0}>
          {c.batches.length ? c.batches.map((b: any) => (
            <Tag key={b.batchNo} color="blue">{b.batchNo} ×{b.qty} @ {b.fromLocationCode}{b.expiryDate ? ` / 效期 ${b.expiryDate}` : ''}</Tag>
          )) : <Tag>主仓无可用批次</Tag>}
        </Space>
      ),
    },
    {
      title: '状态', width: 80,
      render: (_: any, c: any) => {
        const pick = pickMap[c.componentCode] || 0;
        if (pick > c.need) return <Tag color="orange">超领</Tag>;
        if (c.shortage > 0) return <Tag color="red">缺料</Tag>;
        return <Tag color="green">正常</Tag>;
      },
    },
  ];

  const manualColumns = [
    {
      title: '物料', width: 220,
      render: (_: any, _r: any, idx: number) => (
        <Select showSearch optionFilterProp="label" placeholder="选择物料" style={{ width: '100%' }}
          value={manualItems[idx].materialCode}
          options={materialOptions}
          onChange={(val) => updateManual(idx, { materialCode: val })} />
      ),
    },
    {
      title: '数量', width: 110,
      render: (_: any, _r: any, idx: number) => (
        <InputNumber min={0.001} style={{ width: '100%' }} value={manualItems[idx].qty}
          onChange={(val) => updateManual(idx, { qty: val })} />
      ),
    },
    {
      title: '批次（FIFO 推荐，临期/不合格禁选）',
      render: (_: any, _r: any, idx: number) => {
        const it = manualItems[idx];
        const opts = batchesOf(it.materialCode || '').map((b) => ({
          value: b.batch_no,
          disabled: !b.eligible,
          label: `${b.batch_no} ×${b.qty} @${b.location_code}${b.expiry_date ? ` 效期${b.expiry_date}` : ''} [${b.quality_status}]${b.eligible ? '' : '（禁领）'}`,
        }));
        return (
          <Select showSearch placeholder="选择批次" style={{ width: '100%' }} value={it.batchNo}
            options={opts} onChange={(val, opt) => {
              const b = batchesOf(it.materialCode || '').find((x) => x.batch_no === val);
              updateManual(idx, { batchNo: val, fromLocationCode: b?.location_code });
            }} />
        );
      },
    },
    {
      title: '', width: 50,
      render: (_: any, _r: any, idx: number) => (
        <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeManual(idx)} />
      ),
    },
  ];

  const shortageAny = bomPlan.some((c) => c.shortage > 0);

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>产线领料</Typography.Title>
      <Alert
        type="info" showIcon
        message="领料规则"
        description="BOM 一键领料：选择成品与计划产量，系统按 BOM 单耗展开并 FIFO 推荐主仓合格批次（自动跳过不合格/过期/临期 ≤30 天）。手动增补：直接选物料与批次，超 BOM 需求将触发超领确认。所有领料均实时从主仓调拨至所选线边仓库位（线边仓库位在「库位档案」中自行维护）。"
        style={{ marginBottom: 12 }}
      />

      <Card size="small" style={{ marginBottom: 12 }}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="lineNo" label="目标产线（1-6号线）" rules={[{ required: true, message: '请选择产线' }]}>
                <Select placeholder="选择产线" options={lineOptions} onChange={onLineChange} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="toLoc" label="目标线边仓库位" rules={[{ required: true, message: '请选择线边仓库位' }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择线边仓库位"
                  options={lineSideOptions} notFoundContent="暂无线边仓库位，请先在「库位档案」新增类型为「线边仓」的库位" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="remark" label="备注">
                <Input placeholder="选填，如生产批次 / 工单号" />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'bom',
            label: <span><ThunderboltOutlined /> BOM 一键领料</span>,
            children: (
              <div>
                <Space style={{ marginBottom: 12 }}>
                  <Select showSearch optionFilterProp="label" placeholder="选择成品" style={{ width: 260 }}
                    value={form.getFieldValue('productCode')}
                    options={productOptions}
                    onChange={(v) => form.setFieldsValue({ productCode: v })} />
                  <InputNumber placeholder="计划产量" min={1} style={{ width: 140 }}
                    value={form.getFieldValue('planQty')}
                    onChange={(v) => form.setFieldsValue({ planQty: v })} />
                  <Button type="primary" ghost icon={<ThunderboltOutlined />} onClick={genBomPlan}>按 BOM 生成领料计划</Button>
                </Space>
                {shortageAny && <Alert type="error" showIcon style={{ marginBottom: 8 }} message="主仓库存不足：存在缺料组件，请减少计划产量或手动增补补足" />}
                {overPickList.length > 0 && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={`超领提醒：${overPickList.length} 个组件实领超过 BOM 需求，提交时将要求确认`} />}
                <Table rowKey="componentCode" size="small" dataSource={bomPlan} columns={bomColumns}
                  pagination={false} locale={{ emptyText: '暂未生成计划' }} />
              </div>
            ),
          },
          {
            key: 'manual',
            label: '手动增补',
            children: (
              <div>
                <Button type="dashed" icon={<PlusOutlined />} onClick={addManual} style={{ marginBottom: 8 }}>添加领料明细</Button>
                <Table rowKey={(_, i) => String(i)} size="small" dataSource={manualItems} columns={manualColumns}
                  pagination={false} locale={{ emptyText: '暂无明细' }} />
              </div>
            ),
          },
        ]} />
      </Card>

      <Divider style={{ margin: '4px 0 12px' }} />
      <Space>
        <Button type="primary" icon={<SendOutlined />} loading={submitting} onClick={submit}>提交领料</Button>
        <Button icon={<ReloadOutlined />} onClick={() => { form.resetFields(); setBomPlan([]); setPickMap({}); setManualItems([]); }}>重置</Button>
      </Space>
    </div>
  );
}
