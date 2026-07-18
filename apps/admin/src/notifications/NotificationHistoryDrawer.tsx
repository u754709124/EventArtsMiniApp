import { Alert, Button, Drawer, Empty, Skeleton, Spin, Tooltip } from "antd";
import { useEffect, useState } from "react";
import type { AdminNotificationDto } from "@event-arts/shared";
import { listAdminNotifications } from "../api";

const pageSize = 20;

function formatLogTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export function NotificationHistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<AdminNotificationDto[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextPage: number, append: boolean) {
    setLoading(true);
    setError(null);
    try {
      const result = await listAdminNotifications(nextPage, pageSize, { level: "error" });
      setItems((current) => append
        ? [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]
        : result.items);
      setPage(result.pagination.page);
      setTotal(result.pagination.total);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "失败日志加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setItems([]);
    setPage(1);
    setTotal(0);
    void load(1, false);
  }, [open]);

  const hasMore = items.length < total;
  function clearVisibleLogs() {
    setItems([]);
    setPage(1);
    setTotal(0);
    setError(null);
  }

  return (
    <Drawer
      className="notification-history"
      title="最近 7 天失败日志"
      size={420}
      open={open}
      onClose={onClose}
      destroyOnHidden
      extra={
        <Button
          aria-label="清空界面日志"
          disabled={loading || items.length === 0}
          onClick={clearVisibleLogs}
        >
          清空
        </Button>
      }
    >
      {error && !items.length ? (
        <Alert
          data-testid="notification-history-error"
          type="error"
          showIcon
          title="失败日志加载失败"
          description={error}
          action={<Button onClick={() => void load(1, false)}>重试</Button>}
        />
      ) : (
        <Skeleton loading={loading && !items.length} active>
          {!items.length ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="最近 7 天暂无失败日志" />
          ) : (
            <>
              <div className="notification-history__list" aria-busy={loading}>
                {items.map((item) => (
                  <Tooltip key={item.id} title={item.message} placement="topLeft">
                    <article
                      className="notification-history__item notification-history__item--error"
                      tabIndex={0}
                      aria-label={`发生时间 ${formatLogTime(item.occurredAt)}，错误原因 ${item.message}`}
                    >
                      <time dateTime={item.occurredAt}>{formatLogTime(item.occurredAt)}</time>
                      <p>{item.message}</p>
                    </article>
                  </Tooltip>
                ))}
              </div>
              {error && (
                <Alert
                  className="notification-history__append-error"
                  type="error"
                  showIcon
                  title="更多失败日志加载失败"
                  action={<Button onClick={() => void load(page + 1, true)}>重试</Button>}
                />
              )}
              {hasMore && !error && (
                <Button
                  className="notification-history__more"
                  block
                  disabled={loading}
                  onClick={() => void load(page + 1, true)}
                >
                  {loading ? <><Spin size="small" /> 正在加载</> : "加载更多"}
                </Button>
              )}
            </>
          )}
        </Skeleton>
      )}
    </Drawer>
  );
}
