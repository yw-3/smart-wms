import { useEffect, useState } from 'react';
import { Table, Tag, Select, Typography, Card, Row, Col, App as AntApp } from 'antd';
import api from '../../api';

const ABC_COLORS: any = { A: 'red', B: 'orange', C: 'green' };
const ABC_DESC: any = { A: '高价值/高频：重点盘点', B: '中价值：定期盘点', C: '低价值/低耗：抽盘' };

export default function Abc() {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [dist, setDist] = useState<any>({ A: 0, B: 0, C: 0 });

  const load = async () => {
    const { data } = await api.get('/master/materials');
    setRows(data);
    const d = { A: 0, B: 0, C: 0 };
    data.forEach((r: any) => { d[r.abcClass] = (d[r.abcClass] || 0) + 1; });
    setDist(d);
  };
  useEffect(() => { load(); }, []);

  const change = async (id: number, val: string) => {
    await api.patch(`/master/materials/${id}`, { abcClass: val });
    message.success('ABC 分类已更新');
    load();
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>ABC 分类管理</Typography.Title>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {(['A', 'B', 'C'] as const).map((k) => (
          <Col span={8} key={k}>
            <Card size="small">
              <Tag color={ABC_COLORS[k]}>类 {k}</Tag> 共 {dist[k]} 种
              <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>{ABC_DESC[k]}</div>
            </Card>
          </Col>
        ))}
      </Row>
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 10 }} columns={[
        { title: '物料编码', dataIndex: 'code', width: 100 },
        { title: '名称', dataIndex: 'name' },
        { title: '供应商', dataIndex: 'supplierName', render: (t: any) => t || '-' },
        { title: '当前分类', dataIndex: 'abcClass', width: 90, render: (t: any) => <Tag color={ABC_COLORS[t]}>{t}</Tag> },
        { title: '调整', width: 130, render: (_: any, r: any) => (
          <Select value={r.abcClass} style={{ width: 90 }} onChange={(v) => change(r.id, v)}
            options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }]} />
        ) },
      ]} />
    </div>
  );
}
