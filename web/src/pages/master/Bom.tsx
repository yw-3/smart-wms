import { useEffect, useMemo, useState } from 'react';
import { Table, Button, Modal, Form, Input, Select, InputNumber, Space, Popconfirm, App as AntApp, Typography, Upload, Alert, AutoComplete } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ProfileOutlined, MinusCircleOutlined, UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import api from '../../api';

export default function Bom() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [opts, setOpts] = useState<any>({ products: [], materials: [] });
  const [productFilter, setProductFilter] = useState<string | undefined>(undefined);
  // 批量新增弹窗
  const [addOpen, setAddOpen] = useState(false);
  const [addForm] = Form.useForm();
  const [items, setItems] = useState<any[]>([{}]);
  // 编辑弹窗
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [editForm] = Form.useForm();
  // 导入
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);

  const load = async () => {
    const [list, o] = await Promise.all([api.get('/bom'), api.get('/bom/options')]);
    setRows(list.data); setOpts(o.data);
  };
  useEffect(() => { load(); }, []);

  const matLabel = (m: any) => `${m.code} ${m.name}`;
  const matName = (code: string) => {
    const m = opts.materials.find((x: any) => x.code === code);
    return m ? m.name : code;
  };

  // 成品选项 = 成品档案（新增时可输入新料号并填写成品品名自动建档）
  const productOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of opts.products) map.set(p.code, `${p.code} ${p.name}`);
    for (const r of rows) if (!map.has(r.product_code)) map.set(r.product_code, r.product_code + ' ' + (r.product_name || ''));
    return [...map.entries()].map(([value, label]) => ({ value, label }));
  }, [opts.products, rows]);

  const filtered = rows.filter((r) => !productFilter || r.product_code === productFilter);

  // ===== 批量新增 =====
  const openAdd = () => { addForm.resetFields(); setItems([{}]); setAddOpen(true); };
  const setItem = (i: number, patch: any) => setItems((arr) => arr.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const submitAdd = async () => {
    const v = await addForm.validateFields();
    const r = await api.post('/bom', { product_code: v.productCode, product_name: v.productName, items });
    const { added, skipped } = r.data;
    message.success(`已新增 ${added} 条组件${skipped ? `，跳过重复 ${skipped} 条` : ''}`);
    setAddOpen(false); load();
  };

  // ===== 编辑 =====
  const openEdit = (r: any) => {
    setEditing(r);
    editForm.setFieldsValue({ qtyPerUnit: r.qty_per_unit, usageUnit: r.usage_unit, remark: r.remark });
    setEditOpen(true);
  };
  const submitEdit = async () => {
    const v = await editForm.validateFields();
    await api.put(`/bom/${editing.id}`, { qty_per_unit: v.qtyPerUnit, usage_unit: v.usageUnit, remark: v.remark });
    message.success('已保存'); setEditOpen(false); load();
  };

  const del = async (id: number) => { await api.delete(`/bom/${id}`); message.success('已删除'); load(); };

  // 用量单位为空时回退显示物料主单位
  const unitRender = (r: any) => r.usage_unit || <span style={{ color: '#bbb' }}>{r.component_unit || '-'}</span>;

  // ===== Excel 导入 =====
  const beforeUpload = (file: any) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      message.error('仅支持 .xlsx / .xls / .csv');
      return Upload.LIST_IGNORE;
    }
    return true;
  };
  const doImport = async (options: any) => {
    const { file } = options;
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/bom/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(data);
      message.success(`导入完成：成功 ${data.imported} 条，跳过 ${data.skipped} 条${data.createdMaterials ? `，新建物料 ${data.createdMaterials} 条` : ''}`);
      load();
    } catch (e: any) {
      message.error(e.response?.data?.error || '导入失败');
    } finally {
      setImporting(false);
    }
  };
  const downloadTemplate = async () => {
    try {
      const res = await api.get('/bom/import-template', { responseType: 'blob' });
      const blob = new Blob([res.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'BOM导入模板.xlsx'; a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('模板下载失败');
    }
  };

  const columns = [
    {
      title: '成品料号 / 品名', dataIndex: 'product_code', width: 220,
      render: (t: string, r: any) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontFamily: 'monospace' }}>{t}</span>
          <span style={{ fontSize: 12, color: '#888' }}>{r.product_name || '-'}</span>
        </Space>
      ),
    },
    {
      title: '组件料号 / 名称', dataIndex: 'component_code',
      render: (t: string, r: any) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontFamily: 'monospace' }}>{t}</span>
          <span style={{ fontSize: 12, color: '#888' }}>{r.component_name || matName(t)}</span>
        </Space>
      ),
    },
    { title: '单层标准用量', dataIndex: 'qty_per_unit', width: 110, align: 'right' as const },
    { title: '单位', dataIndex: 'usage_unit', width: 70, render: (_: any, r: any) => unitRender(r) },
    { title: '备注', dataIndex: 'remark', render: (t: any) => t || '-' },
    {
      title: '操作', width: 130, render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该 BOM 组件？" onConfirm={() => del(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <ProfileOutlined /> BOM 配方管理
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -8 }}>
        一个成品挂多个组件，每组件一条「单层标准用量 + 用量单位」。支持 Excel 批量导入，领料录入「按 BOM 生成领料计划」实时读取本表。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear showSearch optionFilterProp="label"
          placeholder="按成品筛选" style={{ width: 260 }}
          value={productFilter} onChange={setProductFilter}
          options={productOptions}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增 BOM（可批量添加组件）</Button>
        <Button icon={<UploadOutlined />} onClick={() => { setImportResult(null); setImportOpen(true); }}>Excel 导入 BOM</Button>
      </Space>
      <Table rowKey="id" size="small" dataSource={filtered} columns={columns} pagination={{ pageSize: 10 }} />

      {/* 批量新增弹窗 */}
      <Modal
        title="新增 BOM（一个成品 + 多个组件）"
        open={addOpen}
        onOk={submitAdd}
        onCancel={() => setAddOpen(false)}
        okText="保存"
        cancelText="取消"
        width={820}
        destroyOnClose
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            name="productCode" label="成品料号"
            rules={[{ required: true, message: '请选择或输入成品料号' }]}
            extra="可从成品档案中选择，也可直接输入新料号并填写成品品名（保存时自动建档）"
          >
            <AutoComplete
              showSearch optionFilterProp="label"
              placeholder="选择或输入成品料号"
              options={productOptions}
            />
          </Form.Item>
          <Form.Item name="productName" label="成品品名（新建成品时必填）">
            <Input placeholder="如 礼包用旺旺仙贝单包_52g" />
          </Form.Item>
        </Form>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>组件清单（可添加多行；已存在的组合会自动跳过）：</Typography.Paragraph>
        {items.map((it, i) => (
          <Space key={i} align="baseline" style={{ display: 'flex', marginBottom: 6 }} wrap>
            <Select
              showSearch optionFilterProp="label"
              placeholder={`组件 ${i + 1}：料号/名称`}
              style={{ width: 300 }}
              value={it.component_code}
              onChange={(v) => setItem(i, { component_code: v })}
              options={opts.materials.map((m: any) => ({ value: m.code, label: matLabel(m) }))}
            />
            <InputNumber
              min={0.0001} step={0.1} placeholder="单层标准用量"
              style={{ width: 130 }}
              value={it.qty_per_unit}
              onChange={(v) => setItem(i, { qty_per_unit: v })}
            />
            <Input
              placeholder="单位（米/个/包）"
              style={{ width: 110 }}
              value={it.usage_unit}
              onChange={(e) => setItem(i, { usage_unit: e.target.value })}
            />
            <Input
              placeholder="备注（可选）"
              style={{ width: 130 }}
              value={it.remark}
              onChange={(e) => setItem(i, { remark: e.target.value })}
            />
            <Button
              size="small" danger icon={<MinusCircleOutlined />} disabled={items.length === 1}
              onClick={() => setItems((arr) => arr.filter((_, k) => k !== i))}
            />
          </Space>
        ))}
        <Button type="dashed" block icon={<PlusOutlined />} onClick={() => setItems((arr) => [...arr, {}])}>
          添加一行组件
        </Button>
      </Modal>

      {/* 编辑弹窗 */}
      <Modal
        title={`编辑 BOM 组件：${editing?.product_code} → ${editing?.component_code}`}
        open={editOpen}
        onOk={submitEdit}
        onCancel={() => setEditOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editForm} layout="vertical">
          <Space align="start" style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="qtyPerUnit" label="单层标准用量" rules={[{ required: true, message: '请输入用量' }]}>
              <InputNumber min={0.0001} step={0.1} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="usageUnit" label="用量单位">
              <Input placeholder="米/个/包" style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>

      {/* Excel 导入弹窗 */}
      <Modal
        title="Excel 导入 BOM"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={<Button onClick={() => setImportOpen(false)}>关闭</Button>}
        width={720}
        destroyOnClose
      >
        <Alert type="info" showIcon style={{ marginBottom: 12 }}
          message="支持 .xlsx / .xls / .csv。列名可写：成品料号、成品名称、组件料号、组件名称、单层标准用量、用量单位、备注（英文列名 product_code / component_code / qty_per_unit / usage_unit 也可识别）。"
        />
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space wrap>
            <Upload accept=".xlsx,.xls,.csv" beforeUpload={beforeUpload} customRequest={doImport} showUploadList={false} maxCount={1}>
              <Button type="primary" icon={<UploadOutlined />} loading={importing}>选择文件并导入</Button>
            </Upload>
            <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载导入模板(Excel)</Button>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            规则：成品/组件料号在物料档案中不存在时会自动建档；成品与组件组合已存在则跳过；用量非正数的行会被跳过并列出原因。
          </Typography.Text>
          {importResult && (
            <Table
              size="small" pagination={false}
              dataSource={[
                { k: '成功导入', v: importResult.imported },
                { k: '跳过', v: importResult.skipped },
                { k: '新建物料', v: importResult.createdMaterials || 0 },
                { k: '错误明细', v: (importResult.errors || []).join('；') || '无' },
              ]}
              columns={[{ title: '项目', dataIndex: 'k', width: 110 }, { title: '结果', dataIndex: 'v' }]}
            />
          )}
        </Space>
      </Modal>
    </div>
  );
}
