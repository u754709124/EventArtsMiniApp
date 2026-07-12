import { useState } from "react";
import { Form, Input, message } from "antd";
import { useNavigate } from "react-router-dom";
import { passwordPolicy, type AdminChangePasswordRequest, type AdminPasswordChangedResponse } from "@event-arts/shared";
import { clearToken, request } from "../api";
import { FormActionBar } from "../components/FormActionBar";
import { FormSection } from "../components/FormSection";
import { PageHeader } from "../components/PageHeader";
import { firstValidationField } from "../forms/form-utils";

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

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const [form] = Form.useForm<AdminChangePasswordRequest>();
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const values = await form.validateFields();
      await request<AdminPasswordChangedResponse>("/api/admin/auth/change-password", {
        method: "POST",
        body: JSON.stringify(values)
      });
      clearToken();
      form.resetFields();
      message.success("密码已修改，请重新登录");
      navigate("/login", { replace: true });
    } catch (error) {
      const field = firstValidationField(error);
      if (field) {
        form.scrollToField(field, { block: "center" });
        return;
      }
      message.error(error instanceof Error ? error.message : "修改密码失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader title="修改密码" breadcrumbs={["账号安全", "修改密码"]} />
      <Form
        data-testid="change-password-form"
        form={form}
        layout="vertical"
      >
        <FormSection title="账号密码">
          <Form.Item
            label="当前密码"
            name="currentPassword"
            rules={[{ required: true, message: "请输入当前密码" }]}
          >
            <Input.Password data-testid="change-current-password" autoComplete="current-password" />
          </Form.Item>
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
            <Input.Password data-testid="change-new-password" autoComplete="new-password" />
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
            <Input.Password data-testid="change-confirm-password" autoComplete="new-password" />
          </Form.Item>
        </FormSection>
        <FormActionBar
          saving={saving}
          saveText="修改密码"
          saveTestid="change-password-submit"
          onSave={() => void submit()}
        />
      </Form>
    </div>
  );
}
