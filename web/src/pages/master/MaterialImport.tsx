import { useState } from 'react';
import { Upload, Button, App as AntApp, Typography, Table, Tag, Card, Alert, Space } from 'antd';
import { UploadOutlined, DownloadOutlined } from '@ant-design/icons';
import api from '../../api';

const COLUMNS = ['类别', '料号', '品名', '备注'];

export default function MaterialImport() {
  const { message } = AntApp.useApp();
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const beforeUpload = (file: any) => {
    const ok = /\.(xlsx|xls|csv)$/.test(file.name);
    if (!ok) message.error('仅支持 .xlsx / .xls / .csv');
    return ok || Upload.LIST_IGNORE;
  };

  const customUpload = async (options: any) => {
    const { file } = options;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/master/materials/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      message.success(`导入完成：新增 ${data.imported} 条，跳过 ${data.skipped} 条`);
    } catch (e: any) {
      message.error(e.response?.data?.error || '导入失败');
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const header = COLUMNS.join(',');
    const sample = '薄饼类,17101153000021,100g加拿大共版HK薄片米果外膜-无盐味200728,1000米/卷';
    const csv = '﻿' + header + '\n' + sample + '\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = '物料导入模板.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>物料批量导入</Typography.Title>
      <Alert type="info" showIcon style={{ marginBottom: 16 }}
        message="按「类别｜料号｜品名｜备注」四列导入；类别列留空时自动沿用上一条类别；料号重复或为空行将自动跳过。" />
      <Card>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <Upload accept=".xlsx,.xls,.csv" beforeUpload={beforeUpload} customRequest={customUpload} showUploadList={false} maxCount={1}>
              <Button type="primary" icon={<UploadOutlined />} loading={loading}>选择文件并导入</Button>
            </Upload>
            <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载导入模板(CSV)</Button>
          </Space>
          <div>
            <Typography.Text strong>模板列说明：</Typography.Text>
            <div style={{ marginTop: 6 }}>
              {COLUMNS.map((c) => <Tag key={c}>{c}</Tag>)}
            </div>
          </div>
          {result && (
            <Table
              size="small" pagination={false}
              dataSource={[
                { k: '新增导入', v: result.imported },
                { k: '重复跳过', v: `${result.duplicated ?? 0} 条（料号已存在，未覆盖）` },
                { k: '无效跳过', v: `${(result.skipped || 0) - (result.duplicated || 0)} 条` },
                { k: '导入类别', v: (result.categories || []).length ? (result.categories || []).map((c: string) => <Tag key={c} color="blue">{c}</Tag>) : '无' },
                { k: '错误明细', v: (result.errors || []).join('；') || '无' },
              ]}
              columns={[{ title: '项目', dataIndex: 'k', width: 120 }, { title: '结果', dataIndex: 'v' }]}
            />
          )}
        </Space>
      </Card>
    </div>
  );
}
