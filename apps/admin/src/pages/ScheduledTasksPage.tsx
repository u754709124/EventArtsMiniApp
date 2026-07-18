import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Modal, Space, Spin, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ExclamationCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { ScheduledTaskDto, ScheduledTaskKey, ScheduledTaskStatus } from "@event-arts/shared";
import { listScheduledTasks, runScheduledTask } from "../api";
import { PageHeader } from "../components/PageHeader";
import { notify } from "../notifications/notification";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";

const beijingTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

export function formatBeijingTime(value: string | null) {
  if (!value) return "从未执行";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = Object.fromEntries(
    beijingTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function taskErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "定时任务执行失败";
  const code = (error as Error & { code?: string }).code;
  if (code === "SCHEDULED_TASK_BUSY") return "任务正在执行，请稍后再试";
  if (code === "SCHEDULED_TASK_NOT_FOUND") return "定时任务不存在，请刷新列表";
  if (code === "SCHEDULED_TASK_FAILED") return "任务执行失败，请稍后重试";
  return error.message || "定时任务执行失败";
}

function statusTag(status: ScheduledTaskStatus | null, isRunning: boolean) {
  if (isRunning || status === "running") return <Tag color="processing">执行中</Tag>;
  if (status === "success") return <Tag color="success">成功</Tag>;
  if (status === "failed") return <Tag color="error">失败</Tag>;
  return <Tag>未执行</Tag>;
}

export function ScheduledTasksPage() {
  const [tasks, setTasks] = useState<ScheduledTaskDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [executingKeys, setExecutingKeys] = useState<ScheduledTaskKey[]>([]);
  const clickGuard = useRepeatClickGuard();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await listScheduledTasks();
      setTasks(result.items);
    } catch (error) {
      setLoadError(taskErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function confirmRun(task: ScheduledTaskDto) {
    Modal.confirm({
      title: `立即执行“${task.name}”？`,
      icon: <ExclamationCircleOutlined />,
      content: "任务将使用服务器现有配置立即运行，执行期间不能重复触发同一任务。",
      okText: "立即执行",
      cancelText: "取消",
      onOk() {
        return clickGuard(`scheduled-task:run:${task.taskKey}`, async () => {
          setExecutingKeys((current) => [...current, task.taskKey]);
          try {
            await runScheduledTask(task.taskKey);
            notify.success(`${task.name}执行成功`);
          } catch (error) {
            notify.error(taskErrorMessage(error));
          } finally {
            setExecutingKeys((current) => current.filter((key) => key !== task.taskKey));
            await load();
          }
        });
      }
    });
  }

  const columns: ColumnsType<ScheduledTaskDto> = [
    {
      title: "任务名称",
      dataIndex: "name",
      width: 170,
      render: (value, task) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{String(value)}</Typography.Text>
          <Typography.Text type="secondary">{task.description}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Cron 表达式",
      dataIndex: "cron",
      width: 150,
      render: (value) => <Typography.Text code>{String(value)}</Typography.Text>
    },
    {
      title: "计划下次执行",
      dataIndex: "nextExecutionAt",
      width: 190,
      render: (value) => formatBeijingTime(String(value))
    },
    {
      title: "上次执行时间",
      dataIndex: "lastExecutionAt",
      width: 190,
      render: (value: string | null) => formatBeijingTime(value)
    },
    {
      title: "状态",
      dataIndex: "lastStatus",
      width: 100,
      render: (value: ScheduledTaskStatus | null, task) => statusTag(value, task.isRunning)
    },
    {
      title: "操作",
      key: "action",
      fixed: "right",
      width: 130,
      render: (_, task) => {
        const executing = executingKeys.includes(task.taskKey);
        return (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={executing}
            disabled={executing || task.isRunning}
            data-testid={`scheduled-task-run-${task.taskKey}`}
            onClick={() => clickGuard(`scheduled-task:confirm:${task.taskKey}`, () => confirmRun(task))}
          >
            立即执行
          </Button>
        );
      }
    }
  ];

  let content;
  if (loading && tasks.length === 0) {
    content = (
      <Card>
        <div className="scheduled-tasks-state" data-testid="scheduled-tasks-loading">
          <Spin />
          <Typography.Text type="secondary">正在加载定时任务</Typography.Text>
        </div>
      </Card>
    );
  } else if (loadError && tasks.length === 0) {
    content = (
      <Alert
        type="error"
        showIcon
        data-testid="scheduled-tasks-error"
        title="定时任务加载失败"
        description={loadError}
        action={<Button onClick={() => void load()}>重试</Button>}
      />
    );
  } else if (tasks.length === 0) {
    content = <Card><Empty description="暂无定时任务" /></Card>;
  } else {
    content = (
      <Card className="scheduled-tasks-card">
        {loadError && (
          <Alert
            className="scheduled-tasks-inline-error"
            type="error"
            showIcon
            title={loadError}
            action={<Button onClick={() => void load()}>重试</Button>}
          />
        )}
        <Table<ScheduledTaskDto>
          rowKey="taskKey"
          columns={columns}
          dataSource={tasks}
          loading={loading}
          pagination={false}
          scroll={{ x: 1030 }}
          locale={{ emptyText: "暂无定时任务" }}
        />
      </Card>
    );
  }

  return (
    <div className="page-stack scheduled-tasks-page">
      <PageHeader
        title="定时任务"
        breadcrumbs={["定时任务"]}
        description="服务器会按北京时间自动调度；这里展示真实执行状态，也可在确认后立即执行。"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} data-testid="scheduled-tasks-refresh">
            刷新
          </Button>
        }
      />
      {content}
    </div>
  );
}
