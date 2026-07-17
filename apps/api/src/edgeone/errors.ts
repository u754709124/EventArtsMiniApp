export type EdgeOneErrorKind = "bad_request" | "validation" | "upstream" | "unavailable";

export class EdgeOneDomainError extends Error {
  readonly code: string;
  readonly publicMessage: string;
  readonly kind: EdgeOneErrorKind;

  constructor(kind: EdgeOneErrorKind, code: string, publicMessage: string) {
    super(code);
    this.name = "EdgeOneDomainError";
    this.kind = kind;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { code?: unknown; Code?: unknown };
  const value = candidate.code ?? candidate.Code;
  return typeof value === "string" ? value : "";
}

export function mapEdgeOneSdkError(error: unknown): EdgeOneDomainError {
  if (error instanceof EdgeOneDomainError) return error;
  const code = errorCode(error).toLowerCase();
  if (
    code.startsWith("authfailure") ||
    code.includes("invalidcredential") ||
    code.includes("invalidsecret") ||
    code.includes("signaturefailure")
  ) {
    return new EdgeOneDomainError(
      "validation",
      "EDGEONE_INVALID_CREDENTIALS",
      "CAM 凭证无效，请检查 SecretId 和 SecretKey"
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
      "CAM 子账号缺少 EdgeOne 查询权限"
    );
  }
  return new EdgeOneDomainError(
    "upstream",
    "EDGEONE_UPSTREAM_UNAVAILABLE",
    "腾讯云 EdgeOne 服务暂时不可用，请稍后重试"
  );
}

export function edgeOneErrorStatus(error: EdgeOneDomainError) {
  if (error.kind === "bad_request") return 400;
  if (error.kind === "validation") return 422;
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
