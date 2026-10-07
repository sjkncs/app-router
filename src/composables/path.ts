// 解析完整路径为 path 和 query
export function parseFullPath(fullPath: string): { path: string, query: Record<string, string>, search: string } {
  const [path, search] = fullPath.split('?')
  const params = new URLSearchParams(search || '')
  const query: Record<string, string> = {}
  params.forEach((value, key) => { query[key] = value })
  return { path: path || '/', query, search: search ? `?${search}` : '' }
}

// 将 path 和 query 组合成完整路径
export function buildFullPath(path: string, query?: Record<string, any>): string {
  if (!query || Object.keys(query).length === 0) return path
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value))
    }
  })
  const queryString = params.toString()
  return queryString ? `${path}?${queryString}` : path
}

// 标准化路径（处理空格、自动补全根路径前缀；base 为当前路径或 tab 的真实根路径，与 tab 名无关）
export function normalizePath(input: string, rootPath: string, currentPath: string): string {
  let path: string
  if (input.startsWith('/')) {
    path = input
  } else {
    const basePath = currentPath || rootPath
    const segments = basePath.split('/').filter(s => s)
    const inputSegments = input.split('/').filter(s => s)

    for (const seg of inputSegments) {
      if (seg === '..') {
        if (segments.length > 0) segments.pop()
      } else if (seg === '.') {
        continue
      } else {
        segments.push(seg)
      }
    }
    path = '/' + segments.join('/')
  }
  return path.replace(/\s+/g, '-')
}
