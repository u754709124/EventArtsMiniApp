import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useNavigate } from "react-router-dom";
import { Button, Result } from "antd";
import type { AdminMenuKey } from "@event-arts/shared";
import { setSessionExpiredHandler } from "../api";
import { useAdminSession } from "../auth/session";
import { canAccessRouteMenu, firstAccessibleAdminPath } from "../navigation/permissions";
import { ADMIN_BASENAME, isAdminLoginPathname } from "./admin-paths";
import { notify } from "../notifications/notification";

type CrudConfigKey = "announcements" | "banners" | "menu-items" | "artists" | "cases" | "recent-activities" | "articles";

function lazyNamed<TModule extends Record<string, unknown>, TKey extends keyof TModule>(
  loader: () => Promise<TModule>,
  key: TKey
) {
  return lazy(async () => ({
    default: (await loader())[key] as ComponentType
  }));
}

function lazyCrudPage(configKey: CrudConfigKey) {
  return lazy(async () => {
    const [{ CrudPage }, { configs }] = await Promise.all([
      import("../crud/CrudPage"),
      import("../crud/config")
    ]);
    return {
      default: function CrudRoute() {
        return <CrudPage config={configs[configKey]} />;
      }
    };
  });
}

function lazyRecordFormPage(configKey: CrudConfigKey) {
  return lazy(async () => {
    const [{ RecordFormPage }, { configs }] = await Promise.all([
      import("../crud/RecordFormPage"),
      import("../crud/config")
    ]);
    return {
      default: function RecordFormRoute() {
        return <RecordFormPage config={configs[configKey]} />;
      }
    };
  });
}

const LoginPage = lazyNamed(() => import("../pages/LoginPage"), "LoginPage");
const DashboardPage = lazyNamed(() => import("../pages/DashboardPage"), "DashboardPage");
const SystemConfigPage = lazyNamed(() => import("../pages/SystemConfigPage"), "SystemConfigPage");
const SiteConfigPage = lazyNamed(() => import("../pages/SiteConfigPage"), "SiteConfigPage");
const DetailPageList = lazyNamed(() => import("../detail-pages/DetailPageList"), "DetailPageList");
const DetailPageDesigner = lazyNamed(() => import("../detail-pages/DetailPageDesigner"), "DetailPageDesigner");
const MediaPage = lazyNamed(() => import("../media/MediaPage"), "MediaPage");
const BackupPage = lazyNamed(() => import("../pages/BackupPage"), "BackupPage");
const ScheduledTasksPage = lazyNamed(() => import("../pages/ScheduledTasksPage"), "ScheduledTasksPage");
const ChangePasswordPage = lazyNamed(() => import("../pages/ChangePasswordPage"), "ChangePasswordPage");
const AdminUsersPage = lazyNamed(() => import("../pages/AdminUsersPage"), "AdminUsersPage");
const ResetPasswordPage = lazyNamed(() => import("../pages/ResetPasswordPage"), "ResetPasswordPage");
const NotFoundPage = lazy(async () => {
  const { Result } = await import("antd");
  return {
    default: function NotFoundRoute() {
      return <Result status="404" title="未找到页面" subTitle="请从左侧菜单选择要管理的内容。" />;
    }
  };
});
const AdminShell = lazy(async () => {
  const [{ Protected }, { UnsavedChangesProvider }, { AdminLayout }] = await Promise.all([
    import("../pages/Protected"),
    import("../forms/unsaved-changes"),
    import("../layout/AdminLayout")
  ]);
  return {
    default: function AdminShellRoute() {
      return (
        <Protected>
          <UnsavedChangesProvider>
            <AdminLayout />
          </UnsavedChangesProvider>
        </Protected>
      );
    }
  };
});

const AnnouncementListPage = lazyCrudPage("announcements");
const BannerListPage = lazyCrudPage("banners");
const MenuItemListPage = lazyCrudPage("menu-items");
const ArtistListPage = lazyCrudPage("artists");
const ArtistFormPage = lazyRecordFormPage("artists");
const CaseListPage = lazyCrudPage("cases");
const CaseFormPage = lazyRecordFormPage("cases");
const RecentActivityListPage = lazyCrudPage("recent-activities");
const RecentActivityFormPage = lazyRecordFormPage("recent-activities");
const ArticleListPage = lazyCrudPage("articles");
const ArticleFormPage = lazyRecordFormPage("articles");

function RouteLoading() {
  return (
    <div aria-live="polite" style={{ display: "grid", minHeight: 220, placeItems: "center" }}>
      页面加载中
    </div>
  );
}

function lazyElement(children: ReactNode) {
  return <Suspense fallback={<RouteLoading />}>{children}</Suspense>;
}

export function ForbiddenPage() {
  const { identity } = useAdminSession();
  const navigate = useNavigate();
  const target = firstAccessibleAdminPath(identity);
  return (
    <Result
      status="403"
      title="无权访问"
      subTitle="当前后台账户没有此页面权限。"
      extra={<Button onClick={() => navigate(target, { replace: true })}>返回可访问页面</Button>}
    />
  );
}

export function PermissionRoute({ menuKey, children }: { menuKey: AdminMenuKey; children: ReactNode }) {
  const { identity } = useAdminSession();
  if (!canAccessRouteMenu(identity, menuKey)) return <ForbiddenPage />;
  return <>{children}</>;
}

function protectedElement(menuKey: AdminMenuKey, children: ReactNode) {
  return <PermissionRoute menuKey={menuKey}>{lazyElement(children)}</PermissionRoute>;
}

function DefaultAdminRoute() {
  const { identity } = useAdminSession();
  return <Navigate to={firstAccessibleAdminPath(identity)} replace />;
}

export const router = createBrowserRouter(
  [
    { path: "/login", element: lazyElement(<LoginPage />) },
    { path: "/reset-password", element: lazyElement(<ResetPasswordPage />) },
    {
      path: "/",
      element: lazyElement(<AdminShell />),
      children: [
        { index: true, element: <DefaultAdminRoute /> },
        { path: "dashboard", element: protectedElement("dashboard", <DashboardPage />) },
        { path: "system-config", element: protectedElement("system-config", <SystemConfigPage />) },
        { path: "site-config", element: protectedElement("site-config", <SiteConfigPage />) },
        { path: "announcements", element: protectedElement("announcements", <AnnouncementListPage />) },
        { path: "banners", element: protectedElement("banners", <BannerListPage />) },
        { path: "menu-items", element: protectedElement("menu-items", <MenuItemListPage />) },
        { path: "artists", element: protectedElement("artists", <ArtistListPage />) },
        { path: "artists/new", element: protectedElement("artists", <ArtistFormPage />) },
        { path: "artists/:id/edit", element: protectedElement("artists", <ArtistFormPage />) },
        { path: "cases", element: protectedElement("cases", <CaseListPage />) },
        { path: "cases/new", element: protectedElement("cases", <CaseFormPage />) },
        { path: "cases/:id/edit", element: protectedElement("cases", <CaseFormPage />) },
        { path: "recent-activities", element: protectedElement("recent-activities", <RecentActivityListPage />) },
        { path: "recent-activities/new", element: protectedElement("recent-activities", <RecentActivityFormPage />) },
        { path: "recent-activities/:id/edit", element: protectedElement("recent-activities", <RecentActivityFormPage />) },
        { path: "articles", element: protectedElement("articles", <ArticleListPage />) },
        { path: "articles/new", element: protectedElement("articles", <ArticleFormPage />) },
        { path: "articles/:id/edit", element: protectedElement("articles", <ArticleFormPage />) },
        { path: "detail-pages", element: protectedElement("detail-pages", <DetailPageList />) },
        { path: "detail-pages/new", element: protectedElement("detail-pages", <DetailPageDesigner />) },
        { path: "detail-pages/:id/edit", element: protectedElement("detail-pages", <DetailPageDesigner />) },
        { path: "media-assets", element: protectedElement("media-assets", <MediaPage />) },
        { path: "users", element: protectedElement("user-management", <AdminUsersPage />) },
        { path: "backups", element: protectedElement("backups", <BackupPage />) },
        { path: "scheduled-tasks", element: protectedElement("scheduled-tasks", <ScheduledTasksPage />) },
        { path: "change-password", element: protectedElement("change-password", <ChangePasswordPage />) },
        { path: "*", element: lazyElement(<NotFoundPage />) }
      ]
    }
  ],
  { basename: ADMIN_BASENAME }
);

setSessionExpiredHandler(() => {
  if (!isAdminLoginPathname(window.location.pathname)) {
    notify.warning("登录已失效，请重新登录");
  }
  void router.navigate("/login", { replace: true });
});
