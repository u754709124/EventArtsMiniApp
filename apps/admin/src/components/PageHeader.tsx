import { Breadcrumb, Typography } from "antd";
import type React from "react";

type PageHeaderProps = {
  title: string;
  breadcrumbs?: string[];
  extra?: React.ReactNode;
  description?: React.ReactNode;
};

export function PageHeader({ title, breadcrumbs = [], extra, description }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        {breadcrumbs.length > 0 && <Breadcrumb className="page-header__breadcrumb" items={breadcrumbs.map((title) => ({ title }))} />}
        <Typography.Title level={2}>{title}</Typography.Title>
        {description && <div className="page-header__description">{description}</div>}
      </div>
      {extra && <div className="page-header__extra">{extra}</div>}
    </header>
  );
}
