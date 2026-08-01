import { z } from "zod";

export type Id = string;
export type IsoDateTime = string;

export const idSchema = z.string().min(1);
export const isoDateTimeSchema = z.string().datetime();

export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface PageResponse<TItem> {
  items: TItem[];
  page: number;
  pageSize: number;
  total: number;
}
