import React from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes/AppRoutes";
import { adminTheme } from "./theme";
import { NotificationProvider } from "./notifications/NotificationProvider";
import "./styles.css";

const rootElement = document.getElementById("root");

ConfigProvider.config({
  holderRender: (children) => (
    <ConfigProvider locale={zhCN} theme={adminTheme}>
      <AntApp>{children}</AntApp>
    </ConfigProvider>
  )
});

if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <ConfigProvider locale={zhCN} theme={adminTheme}>
        <AntApp>
          <NotificationProvider>
            <RouterProvider router={router} />
          </NotificationProvider>
        </AntApp>
      </ConfigProvider>
    </React.StrictMode>
  );
}
