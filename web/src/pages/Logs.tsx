import { useEffect, useState } from 'react';
import { Table, Select, Typography, Tag } from 'antd';
import api from '../api';

export default function Logs() {
  const [rows, setRows] = useState<any[]>([]);
  const [mod, setMod] = useState<string | undefined>();

  const load = () => {
    api.get('/logs', { params: { limit: 200, module: mod } }).then((r) => setRows(r.data)).catch(() => {});
  };
  useEffect(() => { load(); }, [mod]);

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>操作日志（追加式留痕，可追溯）</Typography.Title>
      <Select placeholder="按模块筛选" allowClear style={{ width: 200, marginBottom: 12 }} value={mod}
        onChange={(v) => setMod(v)} options={[
          { value: 'system', label: '系统/登录' },
          { value: 'master', label: '主数据管理' },
        ]} />
      <Table rowKey="id" size="small" dataSource={rows} pagination={{ pageSize: 12 }} columns={[
        { title: 'ID', dataIndex: 'id', width: 60 },
        { title: '操作人', dataIndex: 'real_name', width: 90 },
        { title: '动作', dataIndex: 'action', width: 100, render: (t: any) => <Tag>{t}</Tag> },
        { title: '模块', dataIndex: 'module', width: 90 },
        { title: '明细', dataIndex: 'detail' },
        { title: '时间', dataIndex: 'created_at', width: 160 },
      ]} />
    </div>
  );
}
