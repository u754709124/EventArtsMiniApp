import type { MediaType } from "@event-arts/shared";

export type DetailPageMediaAsset = {
  id: number;
  mediaType: MediaType | string;
  url: string;
  width: number | null;
  height: number | null;
};

export class DetailPageDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "DetailPageDomainError";
  }
}

export class DetailPageValidationError extends DetailPageDomainError {
  constructor(message: string) {
    super("DETAIL_PAGE_VALIDATION_ERROR", message, 400);
    this.name = "DetailPageValidationError";
  }
}
