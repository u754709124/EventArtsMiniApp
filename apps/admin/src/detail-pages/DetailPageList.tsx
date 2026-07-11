import { useEffect, useState } from "react";
import { Button, Card, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { detailPageTypeDefinitions, detailPageTypeValues, type DetailPageSummaryDto } from "@event-arts/shared";
import { useNavigate } from "react-router-dom";
import { request } from "../api";

type DetailPageListResponse = {
  items: DetailPageSummaryDto[];
  total: number;
  page: number;
  pageSize: number;
};

export function DetailPageList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DetailPageSummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (type) params.set("type", type);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const data = await request<DetailPageListResponse>(`/api/admin/detail-pages?${params.toString()}`);
      setItems(data.items);
      setTotal(data.total);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "详情页加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [page, pageSize, q, type]);

  function remove(record: DetailPageSummaryDto) {
    Modal.confirm({
      title: "确认删除详情页？",
      content: record.referenceCount > 0 ? "该详情页仍被引用，无法删除。请先查看引用来源。" : "删除后将解除详情页媒体关系，但不会删除资源库文件。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true, disabled: record.referenceCount > 0 },
      async onOk() {
        await request(`/api/admin/detail-pages/${record.id}`, { method: "DELETE" });
        message.success("删除成功");
        await load();
      }
    });
  }

  const columns: ColumnsType<DetailPageSummaryDto> = [
    { title: "ID", dataIndex: "id", width: 86 },
    {
      title: "详情页名称",
      dataIndex: "name",
      render: (value, record) => <Button type="link" className="detail-page-name-link" onClick={() => navigate(`/detail-pages/${record.id}/edit`)}>{value}</Button>
    },
    { title: "类型", dataIndex: "typeLabel", width: 150, render: (value) => <Tag>{value}</Tag> },
    { title: "BANNER", dataIndex: "bannerCount", width: 100 },
    { title: "正文媒体", dataIndex: "detailMediaCount", width: 110 },
    {
      title: "引用次数",
      dataIndex: "referenceCount",
      width: 120,
      render: (value) => <span data-testid="detail-page-reference-count">{value}</span>
    },
    { title: "更新时间", dataIndex: "updatedAt", width: 190, render: (value) => new Date(value).toLocaleString() },
    {
      title: "操作",
      width: 190,
      render: (_, record) => (
        <Space>
          <Button data-testid="detail-page-edit" onClick={() => navigate(`/detail-pages/${record.id}/edit`)}>编辑</Button>
          <Button danger data-testid="detail-page-delete" disabled={record.referenceCount > 0} onClick={() => remove(record)}>删除</Button>
        </Space>
      )
    }
  ];

  return (
    <Card
      data-testid="detail-page-management"
      title="详情页管理"
      extra={<Button data-testid="detail-page-create" type="primary" onClick={() => navigate("/detail-pages/new")}>新建详情页</Button>}
    >
      <Space className="detail-page-list-filters" wrap>
        <Input.Search
          data-testid="detail-page-search"
          allowClear
          placeholder="搜索 ID 或名称"
          value={q}
          onChange={(event) => {
            setPage(1);
            setQ(event.target.value);
          }}
        />
        <Select
          data-testid="detail-page-type-filter"
          allowClear
          placeholder="全部类型"
          value={type}
          style={{ width: 180 }}
          options={detailPageTypeValues.map((value) => ({ value, label: detailPageTypeDefinitions[value].label }))}
          onChange={(next) => {
            setPage(1);
            setType(next);
          }}
        />
      </Space>
      <Table
        data-testid="detail-page-table"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          }
        }}
      />
    </Card>
  );
}
