import { Card } from "antd";
import type React from "react";

type FormSectionProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
};

export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <Card className="form-section" title={title}>
      {description && <div className="form-section__description">{description}</div>}
      <div className="form-section__grid">{children}</div>
    </Card>
  );
}
