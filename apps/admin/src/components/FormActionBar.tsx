import { Button, Space } from "antd";
import { ArrowLeftOutlined, SaveOutlined } from "@ant-design/icons";
import type React from "react";
import { useRepeatClickGuard } from "../utils/repeat-click-guard";

type FormActionBarProps = {
  saving?: boolean;
  saveText?: string;
  saveTestid?: string;
  continueText?: string;
  continueTestid?: string;
  returnText?: string;
  onSave: () => void;
  onSaveAndContinue?: () => void;
  onReturn?: () => void;
  extra?: React.ReactNode;
};

export function FormActionBar({
  saving = false,
  saveText = "保存",
  saveTestid = "form-save",
  continueText = "保存并继续",
  continueTestid = "form-save-continue",
  returnText = "返回",
  onSave,
  onSaveAndContinue,
  onReturn,
  extra
}: FormActionBarProps) {
  const clickGuard = useRepeatClickGuard();
  return (
    <div className="form-action-bar">
      <Space>
        {onReturn && <Button icon={<ArrowLeftOutlined />} onClick={() => clickGuard("form-action:return", onReturn)}>{returnText}</Button>}
        {extra}
      </Space>
      <Space>
        {onSaveAndContinue && (
          <Button data-testid={continueTestid} icon={<SaveOutlined />} loading={saving} disabled={saving} onClick={() => clickGuard(continueTestid, onSaveAndContinue)}>
            {continueText}
          </Button>
        )}
        <Button data-testid={saveTestid} type="primary" icon={<SaveOutlined />} loading={saving} disabled={saving} onClick={() => clickGuard(saveTestid, onSave)}>
          {saveText}
        </Button>
      </Space>
    </div>
  );
}
