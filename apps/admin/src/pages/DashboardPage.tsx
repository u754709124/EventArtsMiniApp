import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Empty, Skeleton, Typography, message } from "antd";
import { ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import type { DashboardOverviewResponse, EdgeOneDashboardState } from "@event-arts/shared";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { request } from "../api";

const decimalGigabyte = 1_000_000_000;
const decimalMillion = 1_000_000;

function formatDecimal(value: number, divisor: number, unit: string) {
  return `${(value / divisor).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${unit}`;
}

function formatTraffic(value: number) {
  return formatDecimal(value, decimalGigabyte, "GB");
}

function formatRequests(value: number) {
  return formatDecimal(value, decimalMillion, "M");
}

function formatBeijingDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function formatBeijingDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function MetricCard({
  testid,
  title,
  value,
  description
}: {
  testid: string;
  title: string;
  value: string | number;
  description?: string;
}) {
  return (
    <Card className="metric-card" data-testid={testid} title={title}>
      <strong className="metric-card__value">{value}</strong>
      {description && <Typography.Text className="metric-card__description">{description}</Typography.Text>}
    </Card>
  );
}

function EdgeOneReadyCards({ state }: { state: Extract<EdgeOneDashboardState, { status: "ready" }> }) {
  return (
    <>
      <div className="dashboard-metric-grid dashboard-metric-grid--edgeone">
        <MetricCard
          testid="dashboard-edgeone-last24-traffic"
          title="近 24 小时流量"
          value={formatTraffic(state.last24Hours.trafficBytes)}
          description={`${formatBeijingDateTime(state.last24Hours.startTime)} 至 ${formatBeijingDateTime(state.last24Hours.endTime)}`}
        />
        <MetricCard
          testid="dashboard-edgeone-last24-requests"
          title="近 24 小时请求数"
          value={formatRequests(state.last24Hours.requestCount)}
          description="HTTP/HTTPS 请求"
        />
        <MetricCard
          testid="dashboard-edgeone-package-traffic"
          title="套餐流量"
          value={`${formatTraffic(state.package.trafficUsedBytes)} / ${formatTraffic(state.package.trafficCapacityBytes)}`}
          description={`${formatBeijingDate(state.package.periodStart)} 至 ${formatBeijingDate(state.package.periodEnd)}`}
        />
        <MetricCard
          testid="dashboard-edgeone-package-requests"
          title="套餐请求次数"
          value={`${formatRequests(state.package.requestUsed)} / ${formatRequests(state.package.requestCapacity)}`}
          description={`套餐 ${state.package.planId}`}
        />
      </div>
      <Typography.Paragraph className="dashboard-updated-at" type="secondary">
        最近成功刷新：{formatBeijingDateTime(state.fetchedAt)}（北京时间）
      </Typography.Paragraph>
    </>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardOverviewResponse | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [edgeOneRefreshError, setEdgeOneRefreshError] = useState<string | null>(null);
  const dataRef = useRef<DashboardOverviewResponse | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const requestSequenceRef = useRef(0);

  const loadDashboard = useCallback(async (reason: "initial" | "refresh") => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const requestSequence = ++requestSequenceRef.current;
    if (reason === "initial" && !dataRef.current) setInitialLoading(true);
    if (reason === "refresh") setRefreshing(true);

    try {
      const next = await request<DashboardOverviewResponse>("/api/admin/dashboard/overview");
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;

      const previous = dataRef.current;
      const nextEdgeOneErrorMessage = next.edgeOne.status === "error" ? next.edgeOne.message : null;
      const preservePreviousEdgeOne =
        next.edgeOne.status === "error" && previous?.edgeOne.status === "ready";
      const merged = preservePreviousEdgeOne
        ? { ...next, edgeOne: previous.edgeOne }
        : next;
      dataRef.current = merged;
      setData(merged);
      setLoadError(null);
      setRefreshError(null);
      setEdgeOneRefreshError(preservePreviousEdgeOne ? nextEdgeOneErrorMessage : null);
      if (reason === "refresh" && next.edgeOne.status === "error") {
        message.warning("本地统计已刷新，EdgeOne 数据刷新失败");
      }
    } catch (error) {
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) return;
      const errorMessage = error instanceof Error ? error.message : "数据看板加载失败";
      if (dataRef.current) {
        setRefreshError(errorMessage);
        message.error("刷新失败，当前继续显示上次成功数据");
      } else {
        setLoadError(errorMessage);
      }
    } finally {
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setInitialLoading(false);
        setRefreshing(false);
      }
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadDashboard("initial");
    return () => {
      mountedRef.current = false;
    };
  }, [loadDashboard]);

  const edgeOne = data?.edgeOne;
  const refreshButtonLoading = initialLoading || refreshing;

  return (
    <div className="page-stack" aria-busy={refreshButtonLoading}>
      <PageHeader
        title="数据看板"
        breadcrumbs={["数据看板"]}
        extra={
          <Button
            data-testid="dashboard-refresh-all"
            aria-label="刷新全部"
            icon={<ReloadOutlined spin={refreshButtonLoading} />}
            loading={refreshButtonLoading}
            disabled={refreshButtonLoading}
            onClick={() => void loadDashboard("refresh")}
          >
            刷新全部
          </Button>
        }
      />

      {loadError && !data ? (
        <Alert
          data-testid="dashboard-load-error"
          type="error"
          showIcon
          title="数据看板加载失败"
          description={loadError}
          action={<Button onClick={() => void loadDashboard("initial")}>重新加载</Button>}
        />
      ) : (
        <Skeleton active loading={initialLoading && !data}>
          {refreshError && (
            <Alert
              data-testid="dashboard-refresh-error"
              type="warning"
              showIcon
              title="刷新失败，当前显示上次成功数据"
              description={refreshError}
              action={<Button onClick={() => void loadDashboard("refresh")}>重试</Button>}
            />
          )}

          <section className="dashboard-section" aria-labelledby="dashboard-local-title">
            <div className="dashboard-section__heading">
              <Typography.Title id="dashboard-local-title" level={3}>小程序访问</Typography.Title>
              <Typography.Text type="secondary">
                按北京时间统计，同一微信用户每天仅计一次；本周和本月为每日去重用户数累计。
              </Typography.Text>
            </div>
            <div className="dashboard-metric-grid dashboard-metric-grid--local">
              <MetricCard testid="dashboard-pv-today" title="今日浏览量" value={data?.todayUniqueUsers ?? 0} />
              <MetricCard testid="dashboard-pv-week" title="本周浏览量" value={data?.weekDailyUniqueUsers ?? 0} />
              <MetricCard testid="dashboard-pv-month" title="本月浏览量" value={data?.monthDailyUniqueUsers ?? 0} />
            </div>
          </section>

          <section className="dashboard-section" aria-labelledby="dashboard-edgeone-title">
            <div className="dashboard-section__heading">
              <Typography.Title id="dashboard-edgeone-title" level={3}>EdgeOne</Typography.Title>
              <Typography.Text type="secondary">单 Zone 套餐与近 24 小时用量</Typography.Text>
            </div>
            <Alert
              className="dashboard-edgeone-delay"
              type="info"
              showIcon
              title="官方计费数据可能延迟约 3 小时"
            />
            {edgeOneRefreshError && edgeOne?.status === "ready" && (
              <Alert
                data-testid="dashboard-edgeone-stale-warning"
                type="warning"
                showIcon
                title="EdgeOne 刷新失败，当前显示上次成功数据"
                description={edgeOneRefreshError}
                action={<Button onClick={() => void loadDashboard("refresh")}>再次刷新</Button>}
              />
            )}
            {edgeOne?.status === "ready" && <EdgeOneReadyCards state={edgeOne} />}
            {edgeOne?.status === "not_configured" && (
              <Card>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="尚未配置 EdgeOne CAM 凭证与 ZoneId"
                >
                  <Button icon={<SettingOutlined />} type="primary" onClick={() => navigate("/system-config")}>
                    前往系统配置
                  </Button>
                </Empty>
              </Card>
            )}
            {edgeOne?.status === "error" && (
              <Alert
                data-testid="dashboard-edgeone-error"
                type="error"
                showIcon
                title="EdgeOne 数据加载失败"
                description={edgeOne.message}
                action={<Button onClick={() => void loadDashboard("refresh")}>重新加载</Button>}
              />
            )}
          </section>
        </Skeleton>
      )}
    </div>
  );
}
