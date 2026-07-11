import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Select, Space, Tooltip, message } from "antd";
import { ExportOutlined, PlusOutlined } from "@ant-design/icons";
import type { DetailPageOptionDto } from "@event-arts/shared";
import { request } from "../api";
import "./detail-page-reference.css";

type OptionsResponse = { items: DetailPageOptionDto[] };

export type DetailPageReferenceFieldProps = {
  value?: number | null;
  onChange?: (value: number | null) => void;
};

const channelName = "eventarts-detail-page-reference";

function optionLabel(option: DetailPageOptionDto) {
  return `#${option.id} ${option.name} [${option.typeLabel}]`;
}

export function DetailPageReferenceField({ value, onChange }: DetailPageReferenceFieldProps) {
  const [options, setOptions] = useState<DetailPageOptionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const returnToken = useRef(`detail-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const loadSequence = useRef(0);
  const valueKey = value ?? null;

  async function load(q = "") {
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "50");
      const data = await request<OptionsResponse>(`/api/admin/detail-pages/options?${params.toString()}`);
      if (sequence === loadSequence.current) setOptions(data.items);
    } catch (error) {
      if (sequence === loadSequence.current) message.error(error instanceof Error ? error.message : "详情页选项加载失败");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!valueKey) return;
    if (options.some((option) => option.id === valueKey)) return;
    request<DetailPageOptionDto & { typeLabel: string }>(`/api/admin/detail-pages/${valueKey}`)
      .then((detail) => setOptions((current) => current.some((option) => option.id === detail.id) ? current : [
        { id: detail.id, name: detail.name, type: detail.type, typeLabel: detail.typeLabel },
        ...current
      ]))
      .catch(() => {
        setOptions((current) => current.filter((option) => option.id !== valueKey));
        message.warning("已选详情页不存在，请重新选择");
        onChange?.(null);
      });
  }, [onChange, options, valueKey]);

  useEffect(() => {
    const refreshOnFocus = () => void load();
    window.addEventListener("focus", refreshOnFocus);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = (event: MessageEvent<{ token?: string; id?: number }>) => {
        if (event.data?.token !== returnToken.current || !event.data.id) return;
        void load(String(event.data.id));
        onChange?.(event.data.id);
      };
    } catch {
      channel = null;
    }
    return () => {
      window.removeEventListener("focus", refreshOnFocus);
      channel?.close();
    };
  }, [onChange]);

  const selectOptions = useMemo(
    () => options.map((option) => ({ value: option.id, label: optionLabel(option) })),
    [options]
  );

  function openNew() {
    window.open(`/detail-pages/new?returnToken=${encodeURIComponent(returnToken.current)}`, "_blank", "noopener");
  }

  function openSelected() {
    if (!valueKey) return;
    window.open(`/detail-pages/${valueKey}/edit`, "_blank", "noopener");
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
        filterOption={false}
        options={selectOptions}
        onSearch={(q) => void load(q)}
        onFocus={() => void load()}
        onChange={(next) => onChange?.(next ?? null)}
      />
      <Button data-testid="detail-page-reference-create" icon={<PlusOutlined />} onClick={openNew}>
        新建
      </Button>
      <Tooltip title="编辑已选详情页">
        <Button
          data-testid="detail-page-reference-jump"
          icon={<ExportOutlined />}
          disabled={!valueKey}
          onClick={openSelected}
        >
          跳转页面
        </Button>
      </Tooltip>
    </Space.Compact>
  );
}
