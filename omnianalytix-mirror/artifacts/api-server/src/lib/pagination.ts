export function parsePagination(query: Record<string, unknown>): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  const rawSize = Math.floor(Number(query.page_size)) || 20;
  const pageSize = Math.min(Math.max(1, rawSize), 100);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginatedResponse<T>(data: T[], totalCount: number, page: number, pageSize: number) {
  return {
    data,
    total_count: totalCount,
    page,
    page_size: pageSize,
    has_more: (page - 1) * pageSize + data.length < totalCount,
  };
}
