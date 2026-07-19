import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tree,
  Typography
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type {
  AdminGrantableMenuKey,
  AdminMenuGroupKey,
  AdminMenuKey,
  AdminPasswordResetPurpose,
  AdminRole,
  AdminUserDto
} from "@event-arts/shared";
import {
  adminEffectiveMenuKeys,
  adminGrantableMenuKeyValues,
  adminMenuCatalog,
  expandAdminMenuSelection
} from "@event-arts/shared";
import {
  createAdminUser,
  issueAdminPasswordResetLink,
  listAdminUsers,
  revokeAdminPasswordResetLinks,
  updateAdminUser,
  updateAdminUserPermissions,
  type AdminPasswordResetLinkResponse
} from "../api";
import { useAdminSession } from "../auth/session";
import { PageHeader } from "../components/PageHeader";
import { FormSection } from "../components/FormSection";
import { firstValidationField } from "../forms/form-utils";
import {
  adminRoleLabels,
  adminStatusLabels,
  assignablePermissionKeys,
  canAssignPermissions,
  canIssuePasswordLink,
  canManageAdminUser,
  canReadAdminUser,
  creatableRoles,
  editableRoles
} from "../navigation/permissions";
import { notify } from "../notifications/notification";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";

type CreateFormValues = {
  username: string;
  role: AdminRole;
  permissions?: string[];
  currentPassword: string;
  confirmation?: boolean;
};

type EditFormValues = {
  username: string;
  role: AdminRole;
  status?: "enabled" | "disabled";
  currentPassword?: string;
  confirmation?: boolean;
};

type PermissionsFormValues = {
  permissions: string[];
  confirmation?: boolean;
};

type LinkFormValues = {
  currentPassword: string;
  confirmation?: boolean;
};

const groupLabels: Record<AdminMenuGroupKey, string> = {
  home: "首页运营",
  content: "内容管理",
  assets: "素材管理",
  account: "账号安全"
};

const permissionStateLabels: Partial<Record<AdminMenuKey, string>> = {
  "user-management": "角色固有",
  "change-password": "账号固有",
  backups: "敏感权限",
  "scheduled-tasks": "敏感权限",
  "system-config": "敏感权限"
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function roleTag(role: AdminRole) {
  const color: Record<AdminRole, string> = {
    SUPER_ADMIN: "red",
    ADMIN: "orange",
    USER: "blue"
  };
  return <Tag color={color[role]}>{adminRoleLabels[role]}</Tag>;
}

function statusTag(status: AdminUserDto["status"]) {
  const color: Record<AdminUserDto["status"], string> = {
    pending_activation: "gold",
    enabled: "green",
    disabled: "default"
  };
  return <Tag color={color[status]}>{adminStatusLabels[status]}</Tag>;
}

function menuLabel(key: string) {
  return adminMenuCatalog.find((item) => item.key === key)?.label ?? key;
}

function roleOptions(roles: AdminRole[]) {
  return roles.map((role) => ({ value: role, label: adminRoleLabels[role] }));
}

function permissionNodeTitle(key: AdminMenuKey) {
  const label = menuLabel(key);
  const stateLabel = permissionStateLabels[key];
  if (!stateLabel) return label;
  return (
    <Space size={4}>
      <span>{label}</span>
      <Tag>{stateLabel}</Tag>
    </Space>
  );
}

function permissionTreeData(assignable: AdminGrantableMenuKey[]) {
  const allowed = new Set(assignable);
  const topLevel = adminMenuCatalog
    .filter((item) => !item.parentKey)
    .map((item) => ({
      key: item.key,
      title: permissionNodeTitle(item.key),
      disabled: item.access !== "grantable" || !allowed.has(item.key as AdminGrantableMenuKey)
    }));
  const groups = Object.entries(groupLabels).flatMap(([groupKey, title]) => {
    const children = adminMenuCatalog
      .filter((item) => item.parentKey === groupKey)
      .map((item) => ({
        key: item.key,
        title: permissionNodeTitle(item.key),
        disabled: item.access !== "grantable" || !allowed.has(item.key as AdminGrantableMenuKey)
      }));
    return children.length ? [{ key: groupKey, title, children }] : [];
  });
  return [...topLevel, ...groups];
}

function intrinsicCheckedKeys(role: AdminRole) {
  const grantable = new Set<string>(adminGrantableMenuKeyValues);
  return adminEffectiveMenuKeys(role, []).filter((key) => !grantable.has(key));
}

function checkedKeysForTree(keys: readonly string[], role: AdminRole) {
  return [...new Set([...expandAdminMenuSelection(keys), ...intrinsicCheckedKeys(role)])];
}

function normalizeCheckedKeys(keys: unknown, assignable: AdminGrantableMenuKey[]) {
  const rawKeys = Array.isArray(keys)
    ? keys
    : typeof keys === "object" && keys && "checked" in keys && Array.isArray((keys as { checked: unknown }).checked)
      ? (keys as { checked: unknown[] }).checked
      : [];
  const allowed = new Set(assignable);
  return expandAdminMenuSelection(rawKeys.map(String)).filter((key) => allowed.has(key));
}

export function AdminUsersPage() {
  const { identity, refreshIdentity } = useAdminSession();
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUserDto | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<AdminUserDto | null>(null);
  const [linkUser, setLinkUser] = useState<AdminUserDto | null>(null);
  const [linkPurpose, setLinkPurpose] = useState<AdminPasswordResetPurpose>("recovery");
  const [revokeUser, setRevokeUser] = useState<AdminUserDto | null>(null);
  const [linkResult, setLinkResult] = useState<(AdminPasswordResetLinkResponse & { target: AdminUserDto }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [createForm] = Form.useForm<CreateFormValues>();
  const [editForm] = Form.useForm<EditFormValues>();
  const [permissionsForm] = Form.useForm<PermissionsFormValues>();
  const [linkForm] = Form.useForm<LinkFormValues>();
  const [revokeForm] = Form.useForm<LinkFormValues>();
  const clickGuard = useRepeatClickGuard();
  const watchedCreateRole = Form.useWatch("role", createForm);

  const assignable = useMemo(() => assignablePermissionKeys(identity), [identity]);
  const treeData = useMemo(() => permissionTreeData(assignable), [assignable]);
  const visibleUsers = useMemo(() => users.filter((user) => canReadAdminUser(identity, user)), [identity, users]);
  const createRoleOptions = useMemo(() => roleOptions(creatableRoles(identity)), [identity]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listAdminUsers();
      setUsers(data.items.filter((user) => canReadAdminUser(identity, user)));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "后台账户加载失败");
    } finally {
      setLoading(false);
    }
  }, [identity]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    const role = creatableRoles(identity)[0] ?? "USER";
    createForm.resetFields();
    createForm.setFieldsValue({
      role,
      permissions: checkedKeysForTree([], role),
      confirmation: false
    });
    setCreateOpen(true);
  }

  function openEdit(user: AdminUserDto) {
    setEditingUser(user);
    editForm.resetFields();
    editForm.setFieldsValue({
      username: user.username,
      role: user.role,
      status: user.status === "pending_activation" ? undefined : user.status,
      confirmation: false
    });
  }

  function openPermissions(user: AdminUserDto) {
    setPermissionsUser(user);
    permissionsForm.resetFields();
    permissionsForm.setFieldsValue({
      permissions: checkedKeysForTree(
        user.permissions.filter((key) => adminGrantableMenuKeyValues.includes(key as AdminGrantableMenuKey)),
        user.role
      ),
      confirmation: false
    });
  }

  function openLink(user: AdminUserDto, purpose: AdminPasswordResetPurpose) {
    linkForm.resetFields();
    setLinkUser(user);
    setLinkPurpose(purpose);
  }

  async function submitCreate() {
    setSaving(true);
    try {
      const values = await createForm.validateFields();
      const result = await createAdminUser({
        username: values.username.trim(),
        role: values.role,
        permissions: normalizeCheckedKeys(values.permissions ?? [], assignable),
        currentPassword: values.currentPassword,
        confirmation: true
      });
      setCreateOpen(false);
      createForm.resetFields();
      setLinkResult({ ...result, purpose: "activation", resetLink: result.activationLink, target: result.user });
      notify.success("后台账户已创建，激活链接只显示一次");
      await Promise.all([load(), refreshIdentity()]);
    } catch (error) {
      const field = firstValidationField(error);
      if (field) {
        createForm.scrollToField(field, { block: "center" });
        return;
      }
      notify.error(error instanceof Error ? error.message : "创建后台账户失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit() {
    if (!editingUser) return;
    setSaving(true);
    try {
      const values = await editForm.validateFields();
      const payload = {
        username: values.username.trim(),
        role: values.role,
        ...(values.status ? { status: values.status } : {}),
        ...(values.currentPassword ? { currentPassword: values.currentPassword, confirmation: true as const } : {})
      };
      await updateAdminUser(editingUser.publicId, payload);
      setEditingUser(null);
      editForm.resetFields();
      notify.success("后台账户已更新，相关会话按需失效");
      await Promise.all([load(), refreshIdentity()]);
    } catch (error) {
      const field = firstValidationField(error);
      if (field) {
        editForm.scrollToField(field, { block: "center" });
        return;
      }
      notify.error(error instanceof Error ? error.message : "更新后台账户失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitPermissions() {
    if (!permissionsUser) return;
    setSaving(true);
    try {
      const values = await permissionsForm.validateFields();
      await updateAdminUserPermissions(permissionsUser.publicId, {
        permissions: normalizeCheckedKeys(values.permissions ?? [], assignable),
        confirmation: true
      });
      setPermissionsUser(null);
      permissionsForm.resetFields();
      notify.success("菜单权限已更新，目标账户会话和旧链接已撤销");
      await Promise.all([load(), refreshIdentity()]);
    } catch (error) {
      const field = firstValidationField(error);
      if (field) {
        permissionsForm.scrollToField(field, { block: "center" });
        return;
      }
      notify.error(error instanceof Error ? error.message : "更新菜单权限失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitLink() {
    if (!linkUser) return;
    setSaving(true);
    try {
      const values = await linkForm.validateFields();
      const result = await issueAdminPasswordResetLink(linkUser.publicId, {
        purpose: linkPurpose,
        currentPassword: values.currentPassword,
        confirmation: true
      });
      setLinkUser(null);
      linkForm.resetFields();
      setLinkResult({ ...result, target: linkUser });
      notify.success(linkPurpose === "activation" ? "激活链接已生成" : "恢复链接已生成");
      await load();
    } catch (error) {
      const field = firstValidationField(error);
      if (field) {
        linkForm.scrollToField(field, { block: "center" });
        return;
      }
      notify.error(error instanceof Error ? error.message : "生成一次性链接失败");
    } finally {
      setSaving(false);
    }
  }

  async function submitRevoke() {
    if (!revokeUser) return;
    setSaving(true);
    try {
      const values = await revokeForm.validateFields();
      const result = await revokeAdminPasswordResetLinks(revokeUser.publicId, {
        currentPassword: values.currentPassword,
        confirmation: true
      });
      setRevokeUser(null);
      revokeForm.resetFields();
      notify.success(`已撤销 ${result.revokedResetTokenCount} 个未使用链接`);
      await load();
    } catch (error) {
      const field = firstValidationField(error);
      if (field) {
        revokeForm.scrollToField(field, { block: "center" });
        return;
      }
      notify.error(error instanceof Error ? error.message : "撤销一次性链接失败");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!linkResult) return;
    try {
      await navigator.clipboard.writeText(linkResult.resetLink);
      notify.success("一次性链接已复制");
    } catch {
      notify.error("复制失败，请手动选择链接");
    }
  }

  const columns: ColumnsType<AdminUserDto> = [
    {
      title: "用户名",
      dataIndex: "username",
      render: (value, user) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{String(value)}</Typography.Text>
          <Typography.Text type="secondary" copyable={{ text: user.publicId }}>
            {user.publicId.slice(0, 8)}
          </Typography.Text>
        </Space>
      )
    },
    { title: "角色", dataIndex: "role", width: 120, render: (value: AdminRole) => roleTag(value) },
    { title: "状态", dataIndex: "status", width: 120, render: (value: AdminUserDto["status"]) => statusTag(value) },
    {
      title: "菜单权限",
      width: 260,
      render: (_, user) => user.role === "SUPER_ADMIN"
        ? <Tag color="red">隐式全权限</Tag>
        : (
          <Space wrap size={[4, 4]}>
            {user.permissions
              .filter((key) => key !== "change-password" && key !== "user-management")
              .map((key) => <Tag key={key}>{menuLabel(key)}</Tag>)}
            {user.permissions.filter((key) => key !== "change-password" && key !== "user-management").length === 0 && "-"}
          </Space>
        )
    },
    { title: "激活时间", dataIndex: "activatedAt", width: 180, render: (value) => formatDateTime(String(value ?? "")) },
    {
      title: "操作",
      fixed: "right",
      width: 360,
      render: (_, user) => {
        const manageable = canManageAdminUser(identity, user);
        const linkable = canIssuePasswordLink(identity, user);
        const permissionsAllowed = manageable && canAssignPermissions(identity, user.role);
        const canIssueActivation = linkable && user.status === "pending_activation";
        const canIssueRecovery = linkable && user.status === "enabled";
        return (
          <Space wrap>
            {manageable && (
              <Button data-testid={`admin-user-edit-${user.publicId}`} onClick={() => openEdit(user)}>
                编辑
              </Button>
            )}
            {permissionsAllowed && (
              <Button data-testid={`admin-user-permissions-${user.publicId}`} onClick={() => openPermissions(user)}>
                权限
              </Button>
            )}
            {canIssueActivation && (
              <Button data-testid={`admin-user-activation-${user.publicId}`} onClick={() => openLink(user, "activation")}>
                激活链接
              </Button>
            )}
            {canIssueRecovery && (
              <Button data-testid={`admin-user-reset-link-${user.publicId}`} onClick={() => openLink(user, "recovery")}>
                恢复链接
              </Button>
            )}
            {linkable && (
              <Button danger data-testid={`admin-user-revoke-links-${user.publicId}`} onClick={() => {
                revokeForm.resetFields();
                setRevokeUser(user);
              }}>
                撤销链接
              </Button>
            )}
            {!manageable && !linkable && <Typography.Text type="secondary">无可执行操作</Typography.Text>}
          </Space>
        );
      }
    }
  ];

  return (
    <div className="page-stack">
      <PageHeader
        title="用户管理"
        breadcrumbs={["账号安全", "用户管理"]}
        description="按固定层级管理后台账户、菜单权限和一次性设密链接。"
        extra={
          <Space wrap>
            <Button data-testid="admin-users-refresh" loading={loading} onClick={() => clickGuard("users:refresh", load)}>
              刷新
            </Button>
            {createRoleOptions.length > 0 && (
              <Button data-testid="admin-user-create-open" type="primary" onClick={() => clickGuard("users:create:open", openCreate)}>
                新增账户
              </Button>
            )}
          </Space>
        }
      />

      {loadError && (
        <Alert
          type="error"
          showIcon
          title="后台账户加载失败"
          description={loadError}
          action={<Button size="small" onClick={() => clickGuard("users:error:retry", load)}>重试</Button>}
        />
      )}

      <Card className="list-card">
        <Table
          data-testid="admin-users-table"
          rowKey="publicId"
          loading={loading}
          dataSource={visibleUsers}
          columns={columns}
          scroll={{ x: "max-content" }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="暂无可管理后台账户" /> }}
        />
      </Card>

      <Modal
        title="新增后台账户"
        open={createOpen}
        width={760}
        okText="创建并生成激活链接"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => clickGuard("users:create:submit", submitCreate)}
        onCancel={() => clickGuard("users:create:cancel", () => setCreateOpen(false))}
      >
        <Form form={createForm} layout="vertical">
          <FormSection title="账户信息">
            <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input data-testid="admin-user-create-username" autoComplete="off" />
            </Form.Item>
            <Form.Item label="角色" name="role" rules={[{ required: true, message: "请选择角色" }]}>
              <Select
                data-testid="admin-user-create-role"
                options={createRoleOptions}
                onChange={(role: AdminRole) => {
                  createForm.setFieldValue(
                    "permissions",
                    checkedKeysForTree(createForm.getFieldValue("permissions") ?? [], role)
                  );
                }}
              />
            </Form.Item>
          </FormSection>
          <FormSection title="菜单权限" description="只保存叶子菜单；分组选择会展开为当前可委派的叶子。">
            <Form.Item name="permissions" valuePropName="checkedKeys">
              <Tree
                checkable
                defaultExpandAll
                selectable={false}
                treeData={treeData}
                onCheck={(keys) => createForm.setFieldValue(
                  "permissions",
                  checkedKeysForTree(
                    normalizeCheckedKeys(keys, assignable),
                    watchedCreateRole ?? createRoleOptions[0]?.value ?? "USER"
                  )
                )}
              />
            </Form.Item>
          </FormSection>
          <FormSection title="安全确认">
            <Alert
              type="warning"
              showIcon
              className="admin-user-security-note"
              message="创建后只返回一次激活链接，目标账户在设密前不能登录。"
            />
            <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true, message: "请输入当前密码" }]}>
              <Input.Password data-testid="admin-user-create-password" autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              name="confirmation"
              valuePropName="checked"
              rules={[{
                validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error("请确认创建行为"))
              }]}
            >
              <Checkbox>确认创建账户并生成一次性激活链接</Checkbox>
            </Form.Item>
          </FormSection>
        </Form>
      </Modal>

      <Modal
        title="编辑后台账户"
        open={Boolean(editingUser)}
        width={680}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => clickGuard(`users:edit:submit:${editingUser?.publicId ?? "none"}`, submitEdit)}
        onCancel={() => clickGuard("users:edit:cancel", () => setEditingUser(null))}
      >
        {editingUser && (
          <Form form={editForm} layout="vertical">
            <Form.Item label="用户名" name="username" rules={[{ required: true, message: "请输入用户名" }]}>
              <Input data-testid="admin-user-edit-username" autoComplete="off" />
            </Form.Item>
            <Form.Item label="角色" name="role" rules={[{ required: true, message: "请选择角色" }]}>
              <Select data-testid="admin-user-edit-role" options={roleOptions(editableRoles(identity, editingUser))} />
            </Form.Item>
            {editingUser.status === "pending_activation" ? (
              <Alert type="info" showIcon message="待激活账户只能通过激活链接启用；可先保持待激活或禁用。" />
            ) : (
              <Form.Item label="状态" name="status" rules={[{ required: true, message: "请选择状态" }]}>
                <Select
                  data-testid="admin-user-edit-status"
                  options={[
                    { value: "enabled", label: "启用" },
                    { value: "disabled", label: "禁用" }
                  ]}
                />
              </Form.Item>
            )}
            {(editingUser.role === "SUPER_ADMIN" || editForm.getFieldValue("role") === "SUPER_ADMIN") && (
              <Alert
                type="warning"
                showIcon
                className="admin-user-security-note"
                message="超级管理员相关变更需要重新认证，并会撤销目标账户会话和未使用链接。"
              />
            )}
            <Form.Item label="当前密码" name="currentPassword">
              <Input.Password data-testid="admin-user-edit-password" autoComplete="current-password" />
            </Form.Item>
            <Form.Item name="confirmation" valuePropName="checked">
              <Checkbox>确认保存账户层级或状态变更</Checkbox>
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title="配置菜单权限"
        open={Boolean(permissionsUser)}
        width={700}
        okText="保存权限"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => clickGuard(`users:permissions:submit:${permissionsUser?.publicId ?? "none"}`, submitPermissions)}
        onCancel={() => clickGuard("users:permissions:cancel", () => setPermissionsUser(null))}
      >
        {permissionsUser && (
          <Form form={permissionsForm} layout="vertical">
            <Alert
              type="warning"
              showIcon
              className="admin-user-security-note"
              message="保存权限会立即撤销目标账户全部登录会话和未使用链接。"
            />
            <Form.Item name="permissions" valuePropName="checkedKeys">
              <Tree
                checkable
                defaultExpandAll
                selectable={false}
                treeData={treeData}
                onCheck={(keys) => permissionsForm.setFieldValue(
                  "permissions",
                  checkedKeysForTree(normalizeCheckedKeys(keys, assignable), permissionsUser.role)
                )}
              />
            </Form.Item>
            <Form.Item
              name="confirmation"
              valuePropName="checked"
              rules={[{
                validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error("请确认权限变更"))
              }]}
            >
              <Checkbox>确认更新菜单权限并撤销目标账户当前会话</Checkbox>
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={linkPurpose === "activation" ? "生成激活链接" : "生成恢复链接"}
        open={Boolean(linkUser)}
        okText="生成一次性链接"
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => clickGuard(`users:link:submit:${linkUser?.publicId ?? "none"}`, submitLink)}
        onCancel={() => clickGuard("users:link:cancel", () => setLinkUser(null))}
      >
        {linkUser && (
          <Form form={linkForm} layout="vertical">
            <Alert
              type={linkUser.role === "ADMIN" ? "error" : "warning"}
              showIcon
              className="admin-user-security-note"
              message={linkUser.role === "ADMIN"
                ? "生成管理员恢复链接将立即撤销该管理员全部登录会话和旧链接。"
                : "生成一次性链接将立即撤销目标账户全部登录会话和旧链接。"}
            />
            <Form.Item label="目标账户">
              <Input value={`${linkUser.username} · ${adminRoleLabels[linkUser.role]}`} readOnly />
            </Form.Item>
            <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true, message: "请输入当前密码" }]}>
              <Input.Password data-testid="admin-user-link-password" autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              name="confirmation"
              valuePropName="checked"
              rules={[{
                validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error("请确认生成链接"))
              }]}
            >
              <Checkbox>确认生成一次性链接并立即撤销目标账户会话</Checkbox>
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title="撤销一次性链接"
        open={Boolean(revokeUser)}
        okText="撤销链接"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={saving}
        onOk={() => clickGuard(`users:revoke:submit:${revokeUser?.publicId ?? "none"}`, submitRevoke)}
        onCancel={() => clickGuard("users:revoke:cancel", () => setRevokeUser(null))}
      >
        {revokeUser && (
          <Form form={revokeForm} layout="vertical">
            <Alert
              type="warning"
              showIcon
              className="admin-user-security-note"
              message="撤销后未使用的激活或恢复链接都会立即失效。"
            />
            <Form.Item label="目标账户">
              <Input value={`${revokeUser.username} · ${adminRoleLabels[revokeUser.role]}`} readOnly />
            </Form.Item>
            <Form.Item label="当前密码" name="currentPassword" rules={[{ required: true, message: "请输入当前密码" }]}>
              <Input.Password data-testid="admin-user-revoke-password" autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              name="confirmation"
              valuePropName="checked"
              rules={[{
                validator: (_, value) => value === true ? Promise.resolve() : Promise.reject(new Error("请确认撤销链接"))
              }]}
            >
              <Checkbox>确认撤销该账户未使用的一次性链接</Checkbox>
            </Form.Item>
          </Form>
        )}
      </Modal>

      <Modal
        title={linkResult?.purpose === "activation" ? "激活链接已生成" : "恢复链接已生成"}
        open={Boolean(linkResult)}
        okText="关闭"
        cancelButtonProps={{ style: { display: "none" } }}
        onOk={() => setLinkResult(null)}
        onCancel={() => setLinkResult(null)}
      >
        {linkResult && (
          <div data-testid="admin-user-link-result">
            <Alert
              type="success"
              showIcon
              className="admin-user-security-note"
              message="链接只显示一次；关闭后请重新生成。"
            />
            <Space direction="vertical" className="admin-user-link-result" size="middle">
              <Typography.Text>
                {linkResult.target.username} · {adminRoleLabels[linkResult.target.role]}，有效期至 {formatDateTime(linkResult.expiresAt)}
              </Typography.Text>
              <Input.TextArea
                data-testid="admin-user-reset-link-value"
                value={linkResult.resetLink}
                readOnly
                autoSize={{ minRows: 2, maxRows: 4 }}
              />
              <Button data-testid="admin-user-copy-link" onClick={() => void copyLink()}>
                复制链接
              </Button>
            </Space>
          </div>
        )}
      </Modal>
    </div>
  );
}
