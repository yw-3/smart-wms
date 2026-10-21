import { useEffect, useState, useMemo } from 'react';
import { Card, Table, Tabs, Typography, Space, Alert, Statistic, Row, Col } from 'antd';
import { AppstoreOutlined } from '@ant-design/icons';
import api from '../../api';

export default function LineLedger() {
  const [data, setData] = useState<any[]>([]);
  const [active, setActive] = useState<string>('1');

  const load = async () => {
    const r = await api.get('/requisition/line-ledger');
    setData(r.data);
    if (r.data.length && !r.data.find((l: any) => String(l.lineNo) === active)) setActive(String(r.data[0].lineNo));
  };
  useEffect(() => { load(); }, []);

  const columns = [
    { title: '物料编码', dataIndex: 'material_code', width: 110 },
    { title: '物料名称', dataIndex: 'material_name', width: 140 },
    { title: '批次', dataIndex: 'batch_no', width: 120 },
    { title: '数量', dataIndex: 'qty', width: 80 },
  ];

  const tabs = data.map((l) => {
    const totalQty = l.batches.reduce((s: number, b: any) => s + (b.qty || 0), 0);
    return {
      key: String(l.lineNo),
      label: `${l.lineNo}号线（${l.locationCode}）`,
      children: (
        <div>
          <Space style={{ marginBottom: 10 }}>
            <Statistic title="在库物料种类" value={l.batches.length} />
            <Statistic title="在库总数量" value={totalQty} style={{ marginLeft: 24 }} />
            <Statistic title="线边仓库位" value={l.locationCode} style={{ marginLeft: 24 }} />
          </Space>
          {l.batches.length === 0 ? (
            <Alert type="info" showIcon message="该线边仓当前无物料（尚未领料或已清空）" />
          ) : (
            <Table rowKey={(r: any) => r.material_code + r.batch_no} size="small" dataSource={l.batches} columns={columns} pagination={false} />
          )}
        </div>
      ),
    };
  });

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>产线台账</Typography.Title>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="线边仓实时在库"
        description="展示各产线线边仓（B-01-01 ~ B-06-01）当前在库物料与批次。领料调拨入线边仓后在此体现；产线耗用后由对应业务扣减（本演示以领料调拨为边界）。" />
      <Card size="small">
        <Tabs activeKey={active} onChange={setActive} items={tabs} />
      </Card>
    </div>
  );
}
