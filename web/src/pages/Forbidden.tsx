import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function Forbidden() {
  const nav = useNavigate();
  return (
    <Result status="403" title="403" subTitle="抱歉，当前账号无权访问该页面（权限不足）。"
      extra={<Button type="primary" onClick={() => nav('/app')}>返回首页</Button>} />
  );
}
