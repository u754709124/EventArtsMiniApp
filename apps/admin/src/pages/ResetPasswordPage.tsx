import { useEffect, useState } from "react";
import { Button, Card, Form, Input, Result } from "antd";
import { Link } from "react-router-dom";
import { passwordPolicy } from "@event-arts/shared";
import { clearToken, consumeAdminPasswordResetLink, type AdminPasswordResetConsumeRequest } from "../api";
import { firstValidationField } from "../forms/form-utils";
import { notify } from "../notifications/notification";

function passwordCharacterClassCount(value: string) {
  return [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ].filter(Boolean).length;
}

function validateStrongPassword(value: string | undefined) {
  if (!value) return Promise.resolve();
  if (/\s/.test(value)) return Promise.reject(new Error("密码不能包含空白字符"));
  if (passwordCharacterClassCount(value) < passwordPolicy.requiredCharacterClasses) {
    return Promise.reject(new Error("密码必须包含大小写字母、数字、符号中的至少三类"));
  }
  return Promise.resolve();
}

function readTokenFragment() {
  if (typeof window === "undefined") return "";
  const rawHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const token = new URLSearchParams(rawHash).get("token") ?? "";
  window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  return token;
}

function installNoReferrerMeta() {
  const existing = document.querySelector<HTMLMetaElement>('meta[name="referrer"]');
  const meta = existing ?? document.createElement("meta");
  const previous = existing?.content ?? null;
  meta.name = "referrer";
  meta.content = "no-referrer";
  if (!existing) document.head.appendChild(meta);
  return () => {
    if (existing && previous !== null) {
      existing.content = previous;
    } else if (!existing) {
      meta.remove();
    }
  };
}

export function ResetPasswordPage() {
  const [form] = Form.useForm<Omit<AdminPasswordResetConsumeRequest, "token">>();
  const [token] = useState(readTokenFragment);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => installNoReferrerMeta(), []);

  async function submit() {
    if (!token) return;
    setSaving(true);
    try {
      const values = await form.validateFields();
      const result = await consumeAdminPasswordResetLink({ ...values, token });
      clearToken();
      form.resetFields();
      setDone(true);
      notify.success(result.purpose === "activation" ? "账号已激活" : "密码已重置");
    } catch (error) {
      const field = firstValidationField(error);
      if (field) {
        form.scrollToField(field, { block: "center" });
        return;
      }
      notify.error(error instanceof Error ? error.message : "链接无效或已失效", { persist: false });
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <main className="login-page">
        <Card className="login-card">
          <Result
            status="success"
            title="密码已设置"
            subTitle="请使用新密码重新登录后台。"
            extra={<Button type="primary"><Link to="/login">返回登录</Link></Button>}
          />
        </Card>
      </main>
    );
  }

  if (!token) {
    return (
      <main className="login-page">
        <Card className="login-card">
          <Result
            status="error"
            title="链接无效"
            subTitle="请联系上级管理员重新生成一次性链接。"
            extra={<Button><Link to="/login">返回登录</Link></Button>}
          />
        </Card>
      </main>
    );
  }

  return (
    <main className="login-page">
      <Card className="login-card" title="设置后台密码">
        <Form data-testid="reset-password-form" form={form} layout="vertical">
          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: passwordPolicy.minLength, message: `密码至少 ${passwordPolicy.minLength} 个字符` },
              { max: passwordPolicy.maxLength, message: `密码不能超过 ${passwordPolicy.maxLength} 个字符` },
              { validator: (_, value) => validateStrongPassword(value) }
            ]}
          >
            <Input.Password data-testid="reset-new-password" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirmPassword"
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: "请再次输入新密码" },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("newPassword") === value) return Promise.resolve();
                  return Promise.reject(new Error("两次输入的新密码不一致"));
                }
              })
            ]}
          >
            <Input.Password data-testid="reset-confirm-password" autoComplete="new-password" />
          </Form.Item>
          <Button
            data-testid="reset-password-submit"
            type="primary"
            block
            loading={saving}
            disabled={saving}
            onClick={() => void submit()}
          >
            设置密码
          </Button>
        </Form>
      </Card>
    </main>
  );
}
