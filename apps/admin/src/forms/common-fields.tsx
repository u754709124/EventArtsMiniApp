import { Form, InputNumber, Switch } from "antd";
import { secondsToMilliseconds, millisecondsToSeconds } from "./form-utils";

export function StatusSwitchField() {
  return (
    <Form.Item
      label="状态"
      name="status"
      valuePropName="checked"
      getValueProps={(value) => ({ checked: value !== "disabled" })}
      normalize={(checked) => (checked ? "enabled" : "disabled")}
      rules={[{ required: true }]}
      extra="停用后前台不会展示。"
    >
      <Switch data-testid="status-select" checkedChildren="启用" unCheckedChildren="停用" />
    </Form.Item>
  );
}

export function SortField() {
  return (
    <Form.Item label="排序" name="sortOrder" rules={[{ required: true }]} extra="数字越小越靠前；相同数字按创建顺序展示。">
      <InputNumber data-testid="sort-order" min={0} precision={0} />
    </Form.Item>
  );
}

export function DurationSecondsField({
  name,
  label,
  testid,
  initialSeconds
}: {
  name: string;
  label: string;
  testid: string;
  initialSeconds: number;
}) {
  return (
    <Form.Item
      label={label}
      name={name}
      initialValue={secondsToMilliseconds(initialSeconds)}
      getValueProps={(value) => ({ value: millisecondsToSeconds(value, initialSeconds) })}
      normalize={(value) => secondsToMilliseconds(value, secondsToMilliseconds(initialSeconds) as number)}
      rules={[{ required: true, message: `请输入${label}` }]}
      extra="运营后台以秒填写，接口仍保存为毫秒。"
    >
      <InputNumber data-testid={testid} min={1} step={0.1} suffix="秒" />
    </Form.Item>
  );
}
