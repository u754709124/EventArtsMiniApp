import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Select, Space, Tooltip } from "antd";
import { ExportOutlined, PlusOutlined } from "@ant-design/icons";
import type { DetailPageOptionDto, DetailPageType } from "@event-arts/shared";
import { request } from "../api";
import { withAdminBasename } from "../routes/admin-paths";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";
import { notify } from "../notifications/notification";
import "./detail-page-reference.css";

type OptionsResponse = { items: DetailPageOptionDto[] };

export type DetailPageReferenceFieldProps = {
  value?: number | null;
  onChange?: (value: number | null) => void;
  detailPageType?: DetailPageType;
  disabled?: boolean;
};

const channelName = "eventarts-detail-page-reference";

function optionLabel(option: DetailPageOptionDto) {
  return `#${option.id} ${option.name} [${option.typeLabel}]`;
}

export function DetailPageReferenceField({
  value,
  onChange,
  detailPageType,
  disabled = false
}: DetailPageReferenceFieldProps) {
  const [options, setOptions] = useState<DetailPageOptionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const returnToken = useRef(`detail-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const loadSequence = useRef(0);
  const valueKey = value ?? null;
  const clickGuard = useRepeatClickGuard();

  async function load(q = ""): Promise<DetailPageOptionDto[] | null> {
    if (disabled) return [];
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (detailPageType) params.set("type", detailPageType);
      params.set("limit", "50");
      const data = await request<OptionsResponse>(`/api/admin/detail-pages/options?${params.toString()}`);
      if (sequence === loadSequence.current) setOptions(data.items);
      return data.items;
    } catch (error) {
      if (sequence === loadSequence.current) notify.error(error instanceof Error ? error.message : "详情页选项加载失败");
      return null;
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadSequence.current += 1;
    setOptions([]);
    if (!disabled) void load();
  }, [detailPageType, disabled]);

  useEffect(() => {
    if (!valueKey || disabled) return;
    if (options.some((option) => option.id === valueKey)) return;
    request<DetailPageOptionDto & { typeLabel: string }>(`/api/admin/detail-pages/${valueKey}`)
      .then((detail) => {
        if (detailPageType && detail.type !== detailPageType) {
          notify.warning("已选详情页类型不匹配，请重新选择");
          onChange?.(null);
          return;
        }
        setOptions((current) => current.some((option) => option.id === detail.id) ? current : [
          { id: detail.id, name: detail.name, type: detail.type, typeLabel: detail.typeLabel },
          ...current
        ]);
      })
      .catch(() => {
        setOptions((current) => current.filter((option) => option.id !== valueKey));
        notify.warning("已选详情页不存在，请重新选择");
        onChange?.(null);
      });
  }, [detailPageType, disabled, onChange, options, valueKey]);

  useEffect(() => {
    const refreshOnFocus = () => {
      if (!disabled) void load();
    };
    window.addEventListener("focus", refreshOnFocus);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent<{ token?: string; id?: number }>) => {
        if (event.data?.token !== returnToken.current || !event.data.id) return;
        void load(String(event.data.id)).then((items) => {
          if (items === null) return;
          const returned = items.find((item) => item.id === event.data.id);
          if (!returned || (detailPageType && returned.type !== detailPageType)) {
            notify.warning("新建详情页类型不匹配，请重新选择");
            return;
          }
          onChange?.(returned.id);
        });
      };
    } catch {
      channel = null;
    }
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      channel?.close();
    };
  }, [detailPageType, disabled, onChange]);

  const selectOptions = useMemo(
    () => options.map((option) => ({ value: option.id, label: optionLabel(option) })),
    [options]
  );

  function openNew() {
    const params = new URLSearchParams({ returnToken: returnToken.current });
    if (detailPageType) params.set("type", detailPageType);
    window.open(withAdminBasename(`/detail-pages/new?${params.toString()}`), "_blank", "noopener");
  }

  function openSelected() {
    if (!valueKey) return;
    window.open(withAdminBasename(`/detail-pages/${valueKey}/edit`), "_blank", "noopener");
  }

  return (
    <Space.Compact className="detail-page-reference-field" block>
      <Select
        data-testid="detail-page-reference-select"
        className="detail-page-reference-select"
        allowClear
        showSearch
        value={valueKey}
        placeholder="请选择详情页"
        loading={loading}
        disabled={disabled}
        filterOption={false}
        options={selectOptions}
        onSearch={(q) => void load(q)}
        onFocus={() => void load()}
        onChange={(next) => onChange?.(next ?? null)}
      />
      <Button data-testid="detail-page-reference-create" icon={<PlusOutlined />} disabled={disabled} onClick={() => clickGuard("detail-page-reference:create", openNew)}>
        新建
      </Button>
      <Tooltip title="编辑已选详情页">
        <Button
          data-testid="detail-page-reference-jump"
          icon={<ExportOutlined />}
          disabled={disabled || !valueKey}
          onClick={() => clickGuard(`detail-page-reference:open:${valueKey ?? "none"}`, openSelected)}
        >
          跳转页面
        </Button>
      </Tooltip>
    </Space.Compact>
  );
}
