export type DashboardMetricDisplay = {
  value: string;
  unit: string;
  text: string;
};

const decimalMegabyte = 1_000_000;
const decimalGigabyte = 1_000_000_000;
const decimalThousand = 1_000;
const decimalMillion = 1_000_000;

const decimalFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const integerFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0
});

function scaledMetric(value: number, divisor: number, unit: string): DashboardMetricDisplay {
  const formattedValue = decimalFormatter.format(value / divisor);
  return {
    value: formattedValue,
    unit,
    text: `${formattedValue} ${unit}`
  };
}

export function formatLast24Traffic(value: number): DashboardMetricDisplay {
  return value < decimalGigabyte
    ? scaledMetric(value, decimalMegabyte, "MB")
    : scaledMetric(value, decimalGigabyte, "GB");
}

export function formatLast24Requests(value: number): DashboardMetricDisplay {
  if (value < decimalThousand) {
    const formattedValue = integerFormatter.format(value);
    return {
      value: formattedValue,
      unit: "次",
      text: `${formattedValue} 次`
    };
  }
  return value < decimalMillion
    ? scaledMetric(value, decimalThousand, "K")
    : scaledMetric(value, decimalMillion, "M");
}

export function formatPackageTraffic(value: number): DashboardMetricDisplay {
  return formatLast24Traffic(value);
}

export function formatPackageRequests(value: number): DashboardMetricDisplay {
  return formatLast24Requests(value);
}
