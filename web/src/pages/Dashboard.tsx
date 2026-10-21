import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Typography, Empty } from 'antd';
import { DatabaseOutlined, ShopOutlined, EnvironmentOutlined, SwapOutlined } from '@ant-design/icons';
import api from '../api';

export default function Dashboard() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.get('/dashboard').then((r) => setData(r.data)).catch(() => {});
  }, []);

  if (!data) return <Empty description="加载中…" />;
  const { stats, recentOps } = data;

  const abcColors: any = { A: 'red', B: 'orange', C: 'green' };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>概览仪表盘</Typography.Title>
      <Row gutter={16}>
        <Col span={6}><Card><Statistic title="物料种类" value={stats.materials} prefix={<DatabaseOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="活跃供应商" value={stats.suppliers} prefix={<ShopOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="库位数" value={stats.locations} prefix={<EnvironmentOutlined />} /></Card></Col>
        <Col span={6}><Card><Statistic title="单位换算规则" value={stats.units} prefix={<SwapOutlined />} /></Card></Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col span={10}>
          <Card title="ABC 分类分布（指导盘点频率）">
            {Object.entries(stats.abc).map(([k, v]: any) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <Tag color={abcColors[k]}>类 {k}</Tag> {v} 种
              </div>
            ))}
          </Card>
        </Col>
        <Col span={14}>
          <Card title="最近操作动态">
            <Table
              rowKey="id" size="small" pagination={false}
              dataSource={recentOps}
              columns={[
                { title: '操作人', dataIndex: 'real_name', width: 90 },
                { title: '动作', dataIndex: 'action', width: 100 },
                { title: '明细', dataIndex: 'detail' },
                { title: '时间', dataIndex: 'created_at', width: 160 },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
