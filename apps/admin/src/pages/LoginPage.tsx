import { useState } from "react";
import { Button, Card, Form, Input, message } from "antd";
import { useNavigate } from "react-router-dom";
import { request, setToken } from "../api";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";

export function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const clickGuard = useRepeatClickGuard();

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      const data = await request<{ token: string }>("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      });
      setToken(data.token);
      message.success("登录成功");
      navigate("/dashboard");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <Card className="login-card" title="后台管理系统">
        <Form layout="vertical" onFinish={(values) => clickGuard("login:submit", () => onFinish(values))}>
          <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
            <Input data-testid="login-username" autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password data-testid="login-password" autoComplete="current-password" />
          </Form.Item>
          <Button data-testid="login-submit" type="primary" htmlType="submit" block loading={loading} disabled={loading}>
            登录
          </Button>
        </Form>
      </Card>
    </main>
  );
}
