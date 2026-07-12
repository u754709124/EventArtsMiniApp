import { useEffect, useState } from "react";
import { Card, Space, Spin, message } from "antd";
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
      <Spin spinning={loading}>
        <Space size={16} wrap>
          <Card
            className="metric-card"
            data-testid="dashboard-pv-today"
            title={data?.estimated ? "今日估算浏览人次" : "今日浏览人次"}
          >
            <strong>{data?.todayPv ?? 0}</strong>
            {data?.estimated ? <span>估算</span> : null}
          </Card>
          <Card
            className="metric-card"
            data-testid="dashboard-pv-week"
            title={data?.estimated ? "本周估算浏览人次" : "本周浏览人次"}
          >
            <strong>{data?.weekPv ?? 0}</strong>
          </Card>
          <Card
            className="metric-card"
            data-testid="dashboard-pv-month"
            title={data?.estimated ? "本月估算浏览人次" : "本月浏览人次"}
          >
            <strong>{data?.monthPv ?? 0}</strong>
          </Card>
        </Space>
      </Spin>
    </div>
  );
}
