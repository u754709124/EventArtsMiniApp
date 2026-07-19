import { useState } from "react";
import { Button, Card, Form, Input } from "antd";
import { useNavigate } from "react-router-dom";
import { request, setToken, type AdminLoginResponse } from "../api";
import { firstAccessibleAdminPath } from "../navigation/permissions";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { notify } from "../notifications/notification";

export function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const clickGuard = useRepeatClickGuard();

  async function onFinish(values: { username: string; password: string }) {
    setLoading(true);
    try {
      const data = await request<AdminLoginResponse>("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      });
      const { token, ...identity } = data;
      setToken(token, identity);
      notify.success("登录成功");
      navigate(firstAccessibleAdminPath(identity));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "登录失败", { persist: false });
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
