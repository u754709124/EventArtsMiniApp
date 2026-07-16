import { useEffect, useState } from "react";
import { Card, Space, Spin, Typography, message } from "antd";
import type { DashboardOverviewResponse } from "@event-arts/shared";
import { PageHeader } from "../components/PageHeader";
import { request } from "../api";

export function DashboardPage() {
  const [data, setData] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request<DashboardOverviewResponse>("/api/admin/dashboard/overview")
      .then(setData)
      .catch((error) => message.error(error.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page-stack">
      <PageHeader title="数据看板" breadcrumbs={["数据看板"]} />
      <Typography.Paragraph type="secondary">
        按北京时间统计，同一微信用户每天仅计一次；本周和本月为每日去重用户数累计。
      </Typography.Paragraph>
      <Spin spinning={loading}>
        <Space size={16} wrap>
          <Card
            className="metric-card"
            data-testid="dashboard-pv-today"
            title="今日浏览量"
          >
            <strong>{data?.todayUniqueUsers ?? 0}</strong>
          </Card>
          <Card
            className="metric-card"
            data-testid="dashboard-pv-week"
            title="本周浏览量"
          >
            <strong>{data?.weekDailyUniqueUsers ?? 0}</strong>
          </Card>
          <Card
            className="metric-card"
            data-testid="dashboard-pv-month"
            title="本月浏览量"
          >
            <strong>{data?.monthDailyUniqueUsers ?? 0}</strong>
          </Card>
        </Space>
      </Spin>
    </div>
  );
}
