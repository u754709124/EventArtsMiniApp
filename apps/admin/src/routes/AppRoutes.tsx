import { createBrowserRouter, Navigate } from "react-router-dom";
import { Result } from "antd";
import { UnsavedChangesProvider } from "../forms/unsaved-changes";
import { AdminLayout } from "../layout/AdminLayout";
import { CrudPage } from "../crud/CrudPage";
import { RecordFormPage } from "../crud/RecordFormPage";
import { configs } from "../crud/config";
import { DetailPageDesigner } from "../detail-pages/DetailPageDesigner";
import { DetailPageList } from "../detail-pages/DetailPageList";
import { MediaPage } from "../media/MediaPage";
import { DashboardPage } from "../pages/DashboardPage";
import { LoginPage } from "../pages/LoginPage";
import { Protected } from "../pages/Protected";
import { SiteConfigPage } from "../pages/SiteConfigPage";

function NotFoundPage() {
  return <Result status="404" title="未找到页面" subTitle="请从左侧菜单选择要管理的内容。" />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <Protected>
        <UnsavedChangesProvider>
          <AdminLayout />
        </UnsavedChangesProvider>
      </Protected>
    ),
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "site-config", element: <SiteConfigPage /> },
      { path: "announcements", element: <CrudPage config={configs.announcements} /> },
      { path: "banners", element: <CrudPage config={configs.banners} /> },
      { path: "menu-items", element: <CrudPage config={configs["menu-items"]} /> },
      { path: "artists", element: <CrudPage config={configs.artists} /> },
      { path: "artists/new", element: <RecordFormPage config={configs.artists} /> },
      { path: "artists/:id/edit", element: <RecordFormPage config={configs.artists} /> },
      { path: "cases", element: <CrudPage config={configs.cases} /> },
      { path: "cases/new", element: <RecordFormPage config={configs.cases} /> },
      { path: "cases/:id/edit", element: <RecordFormPage config={configs.cases} /> },
      { path: "detail-pages", element: <DetailPageList /> },
      { path: "detail-pages/new", element: <DetailPageDesigner /> },
      { path: "detail-pages/:id/edit", element: <DetailPageDesigner /> },
      { path: "media-assets", element: <MediaPage /> },
      { path: "*", element: <NotFoundPage /> }
    ]
  }
]);
