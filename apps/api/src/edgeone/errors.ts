export type EdgeOneErrorKind = "bad_request" | "validation" | "upstream" | "unavailable";

export type EdgeOneUpstreamDiagnostics = {
  upstreamCode?: string;
  upstreamRequestId?: string;
};

const upstreamCodePattern = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const upstreamRequestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function sanitizeEdgeOneUpstreamCode(value: unknown) {
  return typeof value === "string" && upstreamCodePattern.test(value) ? value : undefined;
}

export function sanitizeEdgeOneUpstreamRequestId(value: unknown) {
  return typeof value === "string" && upstreamRequestIdPattern.test(value) ? value : undefined;
}

function readErrorField(error: unknown, field: string) {
  if (!error || typeof error !== "object") return undefined;
  try {
    return (error as Record<string, unknown>)[field];
  } catch {
    return undefined;
  }
}

export function extractEdgeOneUpstreamDiagnostics(error: unknown): EdgeOneUpstreamDiagnostics {
  const upstreamCode =
    sanitizeEdgeOneUpstreamCode(readErrorField(error, "code")) ??
    sanitizeEdgeOneUpstreamCode(readErrorField(error, "Code"));
  const upstreamRequestId =
    sanitizeEdgeOneUpstreamRequestId(readErrorField(error, "requestId")) ??
    sanitizeEdgeOneUpstreamRequestId(readErrorField(error, "RequestId"));
  return {
    ...(upstreamCode ? { upstreamCode } : {}),
    ...(upstreamRequestId ? { upstreamRequestId } : {})
  };
}

export class EdgeOneDomainError extends Error {
  readonly code: string;
  readonly publicMessage: string;
  readonly kind: EdgeOneErrorKind;
  readonly upstreamCode?: string;
  readonly upstreamRequestId?: string;

  constructor(
    kind: EdgeOneErrorKind,
    code: string,
    publicMessage: string,
    diagnostics: EdgeOneUpstreamDiagnostics = {}
  ) {
    super(code);
    this.name = "EdgeOneDomainError";
    this.kind = kind;
    this.code = code;
    this.publicMessage = publicMessage;
    this.upstreamCode = sanitizeEdgeOneUpstreamCode(diagnostics.upstreamCode);
    this.upstreamRequestId = sanitizeEdgeOneUpstreamRequestId(diagnostics.upstreamRequestId);
  }
}

export function edgeOneUpstreamDiagnosticFields(error: EdgeOneDomainError) {
  return {
    ...(error.upstreamCode ? { upstreamCode: error.upstreamCode } : {}),
    ...(error.upstreamRequestId ? { upstreamRequestId: error.upstreamRequestId } : {})
  };
}

export function mapEdgeOneSdkError(error: unknown): EdgeOneDomainError {
  if (error instanceof EdgeOneDomainError) return error;
  const diagnostics = extractEdgeOneUpstreamDiagnostics(error);
  const code = diagnostics.upstreamCode?.toLowerCase() ?? "";
  if (
    code.startsWith("authfailure") ||
    code.includes("invalidcredential") ||
    code.includes("invalidsecret") ||
    code.includes("signaturefailure")
  ) {
    return new EdgeOneDomainError(
      "validation",
      "EDGEONE_INVALID_CREDENTIALS",
      "CAM 凭证无效，请检查 SecretId 和 SecretKey",
      diagnostics
    );
  }
  if (code.includes("requestlimitexceeded") || code.includes("throttl")) {
    return new EdgeOneDomainError(
      "upstream",
      "EDGEONE_RATE_LIMITED",
      "腾讯云 EdgeOne 请求过于频繁，请稍后重试",
      diagnostics
    );
  }
  if (code.includes("quota") || code.includes("resourceinsufficient")) {
    return new EdgeOneDomainError(
      "upstream",
      "EDGEONE_PREFETCH_QUOTA_EXCEEDED",
      "EdgeOne 预热配额不足，请检查套餐后重试",
      diagnostics
    );
  }
  if (
    code.includes("unauthorizedoperation") ||
    code.includes("operationdenied") ||
    code.includes("permissiondenied")
  ) {
    return new EdgeOneDomainError(
      "validation",
      "EDGEONE_PERMISSION_DENIED",
      "CAM 子账号缺少 EdgeOne 查询权限",
      diagnostics
    );
  }
  return new EdgeOneDomainError(
    "upstream",
    "EDGEONE_UPSTREAM_UNAVAILABLE",
    "腾讯云 EdgeOne 服务暂时不可用，请稍后重试",
    diagnostics
  );
}

export function edgeOneErrorStatus(error: EdgeOneDomainError) {
  if (error.kind === "bad_request") return 400;
  if (error.kind === "validation") return 422;
  if (error.code === "EDGEONE_RATE_LIMITED") return 429;
  if (error.code === "EDGEONE_PREFETCH_QUOTA_EXCEEDED") return 422;
  if (error.kind === "upstream") return 502;
  return 503;
}

export function asEdgeOneDomainError(error: unknown) {
  if (error instanceof EdgeOneDomainError) return error;
  return new EdgeOneDomainError(
    "unavailable",
    "EDGEONE_CONFIGURATION_UNAVAILABLE",
    "EdgeOne 配置暂时不可用"
  );
}
