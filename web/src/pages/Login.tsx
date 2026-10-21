import { Form, Input, Button, App as AntApp, Tag } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import api from '../api';
import { useAuth } from '../store';
import { ROLE_LABELS } from '../permissions';
import './login.css';

const DEMO = [
  ['admin', 'Admin@123'], ['manager', 'Manager@123'], ['leader', 'Leader@123'],
  ['picker', 'Picker@123'], ['preparer', 'Preparer@123'], ['supervisor', 'Supervisor@123'],
];

/* 动态装饰层参数 */
const HEARTS = [
  { left: '12%', size: 18, dur: 13, delay: 0 },
  { left: '24%', size: 13, dur: 17, delay: -4 },
  { left: '38%', size: 22, dur: 15, delay: -8 },
  { left: '55%', size: 15, dur: 19, delay: -2 },
  { left: '68%', size: 20, dur: 14, delay: -6 },
  { left: '80%', size: 12, dur: 18, delay: -10 },
  { left: '90%', size: 17, dur: 16, delay: -3 },
];
const STARS = [
  { left: '15%', top: '18%', s: 5, delay: 0 },
  { left: '32%', top: '65%', s: 4, delay: -1.2 },
  { left: '48%', top: '25%', s: 6, delay: -2.1 },
  { left: '58%', top: '72%', s: 4, delay: -0.6 },
  { left: '72%', top: '15%', s: 5, delay: -2.8 },
  { left: '85%', top: '55%', s: 5, delay: -1.7 },
  { left: '8%', top: '48%', s: 4, delay: -2.4 },
  { left: '92%', top: '82%', s: 5, delay: -0.9 },
];
const STREAKS = [
  { left: '85%', top: '12%', delay: 0 },
  { left: '70%', top: '30%', delay: -3.4 },
  { left: '92%', top: '45%', delay: -5.6 },
];
const ORBITS = [
  { cx: '30%', cy: '58%', r: 150, dur: 26, delay: 0, hue: '#ffd666' },
  { cx: '76%', cy: '38%', r: 110, dur: 20, delay: -7, hue: '#9fd0ff' },
];

/* ============ 页面（视频背景 + 流光层） ============ */
export default function Login() {
  const { setAuth } = useAuth();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = async (v: any) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', v);
      setAuth(data.token, data.user);
      if (data.user.mustChangePwd) message.warning('出于安全策略，请先修改密码');
      navigate('/app');
    } catch (e: any) {
      message.error(e.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ww-login">
      {/* 全屏视频背景（无缝循环、静音自动播放） */}
      <video
        className="ww-video"
        src={`${import.meta.env.BASE_URL}login-bg.mp4`}
        poster={`${import.meta.env.BASE_URL}login-bg.jpg`}
        autoPlay
        muted
        loop
        playsInline
      />
      <div className="ww-scrim" />

      {/* 流光极光（曲线漂移） */}
      <div className="ww-aurora a1" />
      <div className="ww-aurora a2" />
      <div className="ww-aurora a3" />
      <div className="ww-glow" />

      {/* 上浮爱心 */}
      {HEARTS.map((h, i) => (
        <svg
          key={`h${i}`}
          className="ww-heart"
          style={{ left: h.left, width: h.size, height: h.size, animationDuration: `${h.dur}s`, animationDelay: `${h.delay}s` }}
          viewBox="0 0 24 24"
        >
          <path
            d="M12 21s-7.5-4.9-9.8-9.2C.7 8.9 2.3 5 6 5c2.2 0 3.7 1.2 4.5 2.6h3C14.3 6.2 15.8 5 18 5c3.7 0 5.3 3.9 3.8 6.8C19.5 16.1 12 21 12 21z"
            fill="rgba(255, 90, 120, 0.85)"
          />
        </svg>
      ))}

      {/* 流星拖尾 */}
      {STREAKS.map((s, i) => (
        <span key={`s${i}`} className="ww-streak" style={{ left: s.left, top: s.top, animationDelay: `${s.delay}s` }} />
      ))}

      {/* 闪烁星光 */}
      {STARS.map((p, i) => (
        <span
          key={`p${i}`}
          className="ww-star"
          style={{ left: p.left, top: p.top, width: p.s, height: p.s, animationDelay: `${p.delay}s` }}
        />
      ))}

      {/* 轨道环绕光点 */}
      {ORBITS.map((o, i) => (
        <div
          key={`o${i}`}
          className="ww-orbit"
          style={{
            left: o.cx,
            top: o.cy,
            width: o.r * 2,
            height: o.r * 2,
            marginLeft: -o.r,
            marginTop: -o.r,
            animationDuration: `${o.dur}s`,
            animationDelay: `${o.delay}s`,
          }}
        >
          <i style={{ background: o.hue }} />
        </div>
      ))}

      {/* 彩色光带扫过 + 底部薄雾 */}
      <div className="ww-sweep" />
      <div className="ww-mist" />

      {/* 左上角系统标识（不遮挡居中人物） */}
      <div className="ww-brand">
        <span className="ww-brand-text">
          <b>广州永旺</b>
          <i>智能物料管理系统</i>
        </span>
      </div>

      {/* 右侧登录卡片（页面唯一登录文字区） */}
      <section className="ww-right">
        <div className="ww-card">
          <div className="accent-bar" />
          <h2>欢迎登录</h2>
          <div className="card-sub">企业智能仓储管理系统</div>

          <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
            <div className="ww-field">
              <label className="lbl">账号</label>
              <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]} style={{ marginBottom: 0 }}>
                <Input prefix={<UserOutlined />} placeholder="请输入账号" size="large" autoComplete="username" />
              </Form.Item>
            </div>
            <div className="ww-field">
              <label className="lbl">密码</label>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]} style={{ marginBottom: 0 }}>
                <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" size="large" autoComplete="current-password" />
              </Form.Item>
            </div>

            <div className="ww-row">
              <span className="safe">
                <SafetyCertificateOutlined className="ic" />
                演示环境 · 数据已脱敏
              </span>
              <span className="link">忘记密码？</span>
            </div>

            <Button className="ww-submit" block htmlType="submit" loading={loading}>
              登 录
            </Button>
          </Form>

          <div className="ww-divider">演示账号（点击填充）</div>
          <div className="ww-chips">
            {DEMO.map(([u, p]) => (
              <Tag
                key={u}
                className="ww-chip"
                onClick={() => form.setFieldsValue({ username: u, password: p })}
              >
                {ROLE_LABELS[u]} / {u}
              </Tag>
            ))}
          </div>

          <div className="ww-foot">© 2026 智能仓储管理系统 · 内部使用</div>
        </div>
      </section>
    </div>
  );
}
