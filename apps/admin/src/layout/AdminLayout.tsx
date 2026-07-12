import { useEffect, useMemo, useState } from "react";
import { Button, Layout, Menu, Tooltip, message } from "antd";
import { LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import type { ItemType } from "antd/es/menu/interface";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearToken, request } from "../api";
import { adminMenuConfig, isMenuGroup } from "../navigation/menu-config";
import { defaultOpenKeys, matchAdminRoute, validOpenKeys } from "../navigation/route-matching";
import { useUnsavedChanges } from "../forms/unsaved-changes";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { stripAdminBasename } from "../routes/admin-paths";

const collapsedKey = "event-arts-admin-sider-collapsed";
const openKeysKey = "event-arts-admin-menu-open-keys";

function readCollapsed() {
  return localStorage.getItem(collapsedKey) === "true";
}

function readOpenKeys() {
  try {
    const parsed = JSON.parse(localStorage.getItem(openKeysKey) ?? "[]");
    return validOpenKeys(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return [];
  }
}

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const dirtyGuard = useUnsavedChanges();
  const routePathname = stripAdminBasename(location.pathname);
  const routeMatch = matchAdminRoute(routePathname);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [openKeys, setOpenKeys] = useState(() => readOpenKeys().length ? readOpenKeys() : defaultOpenKeys());
  const clickGuard = useRepeatClickGuard();

  useEffect(() => {
    localStorage.setItem(collapsedKey, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (!routeMatch.openKeys.length) return;
    setOpenKeys((current) => {
      const next = [...new Set([...current, ...routeMatch.openKeys])];
      localStorage.setItem(openKeysKey, JSON.stringify(next));
      return next;
    });
  }, [routeMatch.openKeys.join("|")]);

  const menuItems = useMemo<ItemType[]>(() => adminMenuConfig.map((item) => {
    if (!isMenuGroup(item)) {
      return {
        key: item.key,
        icon: item.icon,
        label: <span data-testid={item.testid}>{item.label}</span>
      };
    }
    return {
      key: item.key,
      icon: item.icon,
      label: <span data-testid={item.testid}>{item.label}</span>,
      children: item.children.map((child) => ({
        key: child.key,
        label: <span data-testid={child.testid}>{child.label}</span>
      }))
    };
  }), []);

  async function logout() {
    if (!dirtyGuard.confirmIfDirty()) return;
    try {
      await request<Record<string, never>>("/api/admin/auth/logout", { method: "POST" });
    } catch (error) {
      message.error(error instanceof Error ? error.message : "退出登录失败");
      return;
    }
    clearToken();
    navigate("/login");
  }

  return (
    <Layout className="admin-layout">
      <Layout.Sider width={248} collapsedWidth={72} collapsed={collapsed} theme="light">
        <Tooltip title={collapsed ? "喜缘 CMS" : ""} placement="right">
          <div className={collapsed ? "brand is-collapsed" : "brand"}>{collapsed ? "喜" : "喜缘 CMS"}</div>
        </Tooltip>
        <Menu
          mode="inline"
          selectedKeys={routeMatch.selectedKeys}
          openKeys={collapsed ? [] : openKeys}
          items={menuItems}
          onOpenChange={(keys) => {
            const next = validOpenKeys(keys);
            setOpenKeys(next);
            localStorage.setItem(openKeysKey, JSON.stringify(next));
          }}
          onClick={({ key }) => {
            clickGuard(`admin-menu:${key}`, () => {
              const target = adminMenuConfig.flatMap((item) => isMenuGroup(item) ? item.children : [item]).find((item) => item.key === key);
              if (!target || target.path === routePathname) return;
              navigate(target.path);
            });
          }}
        />
        <Button
          data-testid="sidebar-collapse"
          aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          className="sidebar-collapse"
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => clickGuard("admin:sidebar:collapse", () => setCollapsed((value) => !value))}
        >
          {collapsed ? "" : "收起菜单"}
        </Button>
      </Layout.Sider>
      <Layout className="admin-main">
        <Layout.Header className="admin-header">
          <div className="admin-header__account">
            <span>管理员</span>
            <Button data-testid="logout-button" icon={<LogoutOutlined />} onClick={() => clickGuard("admin:logout", logout)}>
              退出登录
            </Button>
          </div>
        </Layout.Header>
        <Layout.Content className="admin-content">
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
