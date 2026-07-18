import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { setSessionExpiredHandler } from "../api";
import { ADMIN_BASENAME, isAdminLoginPathname } from "./admin-paths";
import { notify } from "../notifications/notification";

type CrudConfigKey = "announcements" | "banners" | "menu-items" | "artists" | "cases" | "articles";

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

export const router = createBrowserRouter(
  [
    { path: "/login", element: lazyElement(<LoginPage />) },
    {
      path: "/",
      element: lazyElement(<AdminShell />),
      children: [
        { index: true, element: <Navigate to="/dashboard" replace /> },
        { path: "dashboard", element: lazyElement(<DashboardPage />) },
        { path: "system-config", element: lazyElement(<SystemConfigPage />) },
        { path: "site-config", element: lazyElement(<SiteConfigPage />) },
        { path: "announcements", element: lazyElement(<AnnouncementListPage />) },
        { path: "banners", element: lazyElement(<BannerListPage />) },
        { path: "menu-items", element: lazyElement(<MenuItemListPage />) },
        { path: "artists", element: lazyElement(<ArtistListPage />) },
        { path: "artists/new", element: lazyElement(<ArtistFormPage />) },
        { path: "artists/:id/edit", element: lazyElement(<ArtistFormPage />) },
        { path: "cases", element: lazyElement(<CaseListPage />) },
        { path: "cases/new", element: lazyElement(<CaseFormPage />) },
        { path: "cases/:id/edit", element: lazyElement(<CaseFormPage />) },
        { path: "articles", element: lazyElement(<ArticleListPage />) },
        { path: "articles/new", element: lazyElement(<ArticleFormPage />) },
        { path: "articles/:id/edit", element: lazyElement(<ArticleFormPage />) },
        { path: "detail-pages", element: lazyElement(<DetailPageList />) },
        { path: "detail-pages/new", element: lazyElement(<DetailPageDesigner />) },
        { path: "detail-pages/:id/edit", element: lazyElement(<DetailPageDesigner />) },
        { path: "media-assets", element: lazyElement(<MediaPage />) },
        { path: "backups", element: lazyElement(<BackupPage />) },
        { path: "scheduled-tasks", element: lazyElement(<ScheduledTasksPage />) },
        { path: "change-password", element: lazyElement(<ChangePasswordPage />) },
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
