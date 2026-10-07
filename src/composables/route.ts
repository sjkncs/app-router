import type { RouteConfig } from '@/router/createAppRouter'
import { normalizePath } from './path'

// 路径匹配器
function compilePath(path: string) {
  const keys: string[] = []
  const pattern = path.replace(/\/$/, '').replace(/:([^/]+)/g, (_, key) => {
    keys.push(key)
    return '([^/]+)'
  })
  const regex = new RegExp(`^${pattern}$`)
  return { regex, keys }
}

export type FlatRouteRecord = {
  fullPath: string
  config: RouteConfig
  regex: RegExp
  keys: string[]
  tab: string
}

export function flattenRoutes(routes: Record<string, RouteConfig>) {
  const list: FlatRouteRecord[] = []
  function walk(route: RouteConfig, parentPath = '', tab?: string) {
    // path 语义：以 / 开头为绝对路径（忽略父路径，直接作为根路径）；
    // 否则为相对路径，基于父路径做目录式解析（支持 ./ 与 .. 段）
    const full = route.path.startsWith('/')
      ? route.path.replace(/\/+/g, '/')
      : normalizePath(route.path, parentPath, parentPath)
    const { regex, keys } = compilePath(full)
    const currentTab = tab || full.split('/')[1]
    list.push({ fullPath: full, config: route, regex, keys, tab: currentTab })
    route.children?.forEach(child => walk(child, full, currentTab))
  }
  Object.entries(routes).forEach(([tab, r]) => walk(r, '', tab))
  return list
}

/**
 * 获取 tab 对应的根路径（该 tab 下第一条顶层路由的完整路径）
 * flattenRoutes 中 walk 先 push 顶层再递归 children，因此每个 tab 的第一条记录即为顶层路由。
 * tab 名与 URL 完全解耦：根路径只由 routes 配置决定，与 tab 名无关。
 */
export function getTabRootPath(flatRoutes: FlatRouteRecord[], tab: string): string | null {
  const record = flatRoutes.find(r => r.tab === tab)
  return record ? record.fullPath : null
}

export function matchRoute(pathWithoutQuery: string, flatRoutes: FlatRouteRecord[]) {
  for (const r of flatRoutes) {
    const m = r.regex.exec(pathWithoutQuery)
    if (!m) continue
    const params: Record<string, string> = {}
    r.keys.forEach((k, i) => (params[k] = m[i + 1]))
    return { route: r.config, params, tab: r.tab }
  }
  return null
}
