import type React from "react";
import {
  AppstoreOutlined,
  DashboardOutlined,
  FileImageOutlined,
  FileTextOutlined,
  HomeOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  PictureOutlined,
  SettingOutlined,
  TeamOutlined
} from "@ant-design/icons";

export type AdminMenuLeaf = {
  key: string;
  label: string;
  icon?: React.ReactNode;
  path: string;
  matchPaths: string[];
  breadcrumb: string;
  testid: string;
};

export type AdminMenuGroup = {
  key: string;
  label: string;
  icon: React.ReactNode;
  breadcrumb: string;
  testid: string;
  children: AdminMenuLeaf[];
};

export type AdminMenuItem = AdminMenuLeaf | AdminMenuGroup;

export const dashboardMenu: AdminMenuLeaf = {
  key: "dashboard",
  label: "数据看板",
  icon: <DashboardOutlined />,
  path: "/dashboard",
  matchPaths: ["/", "/dashboard"],
  breadcrumb: "数据看板",
  testid: "sidebar-dashboard"
};

export const adminMenuConfig: AdminMenuItem[] = [
  dashboardMenu,
  {
    key: "home",
    label: "首页运营",
    icon: <HomeOutlined />,
    breadcrumb: "首页运营",
    testid: "sidebar-group-home",
    children: [
      {
        key: "site-config",
        label: "首页配置",
        path: "/site-config",
        matchPaths: ["/site-config"],
        breadcrumb: "首页配置",
        testid: "sidebar-site-config"
      },
      {
        key: "announcements",
        label: "公告管理",
        path: "/announcements",
        matchPaths: ["/announcements"],
        breadcrumb: "公告管理",
        testid: "sidebar-announcements"
      },
      {
        key: "banners",
        label: "首页轮播",
        path: "/banners",
        matchPaths: ["/banners"],
        breadcrumb: "首页轮播",
        testid: "sidebar-banners"
      },
      {
        key: "menu-items",
        label: "分类菜单",
        path: "/menu-items",
        matchPaths: ["/menu-items"],
        breadcrumb: "分类菜单",
        testid: "sidebar-menu-items"
      }
    ]
  },
  {
    key: "content",
    label: "内容管理",
    icon: <AppstoreOutlined />,
    breadcrumb: "内容管理",
    testid: "sidebar-group-content",
    children: [
      {
        key: "artists",
        label: "人员管理",
        icon: <TeamOutlined />,
        path: "/artists",
        matchPaths: ["/artists", "/artists/new", "/artists/:id/edit"],
        breadcrumb: "人员管理",
        testid: "sidebar-artists"
      },
      {
        key: "cases",
        label: "案例管理",
        icon: <FileImageOutlined />,
        path: "/cases",
        matchPaths: ["/cases", "/cases/new", "/cases/:id/edit"],
        breadcrumb: "案例管理",
        testid: "sidebar-cases"
      },
      {
        key: "articles",
        label: "文章管理",
        icon: <FileTextOutlined />,
        path: "/articles",
        matchPaths: ["/articles", "/articles/new", "/articles/:id/edit"],
        breadcrumb: "文章管理",
        testid: "sidebar-articles"
      },
      {
        key: "detail-pages",
        label: "详情页管理",
        icon: <FileTextOutlined />,
        path: "/detail-pages",
        matchPaths: ["/detail-pages", "/detail-pages/new", "/detail-pages/:id/edit"],
        breadcrumb: "详情页管理",
        testid: "sidebar-detail-pages"
      }
    ]
  },
  {
    key: "assets",
    label: "素材管理",
    icon: <PictureOutlined />,
    breadcrumb: "素材管理",
    testid: "sidebar-group-assets",
    children: [
      {
        key: "media-assets",
        label: "素材库",
        path: "/media-assets",
        matchPaths: ["/media-assets"],
        breadcrumb: "素材库",
        testid: "sidebar-media-assets"
      }
    ]
  },
  {
    key: "account",
    label: "账号安全",
    icon: <LockOutlined />,
    breadcrumb: "账号安全",
    testid: "sidebar-group-account",
    children: [
      {
        key: "backups",
        label: "备份与恢复",
        icon: <SafetyCertificateOutlined />,
        path: "/backups",
        matchPaths: ["/backups"],
        breadcrumb: "备份与恢复",
        testid: "sidebar-backups"
      },
      {
        key: "change-password",
        label: "修改密码",
        path: "/change-password",
        matchPaths: ["/change-password"],
        breadcrumb: "修改密码",
        testid: "sidebar-change-password"
      }
    ]
  },
  {
    key: "system-config",
    label: "系统配置",
    icon: <SettingOutlined />,
    path: "/system-config",
    matchPaths: ["/system-config"],
    breadcrumb: "系统配置",
    testid: "sidebar-system-config"
  }
];

export function isMenuGroup(item: AdminMenuItem): item is AdminMenuGroup {
  return "children" in item;
}

export function menuLeaves(items: AdminMenuItem[] = adminMenuConfig): Array<AdminMenuLeaf & { group?: AdminMenuGroup }> {
  return items.flatMap((item) => {
    if (!isMenuGroup(item)) return [{ ...item }];
    return item.children.map((child) => ({ ...child, group: item }));
  });
}
