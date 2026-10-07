/* =============================
   栈管理 & 组件更新
============================= */

import { ref, computed, reactive } from 'vue'
import { parseFullPath } from './path'
import { flattenRoutes, matchRoute, getTabRootPath, FlatRouteRecord } from './route'
import { getCachedComponent } from './component'
import type { CachedComponent, RouteConfig } from '@/router/createAppRouter'

export interface StackEntry {
  _id: number
  fullPath: string
  params: Record<string, string>
  lastAccessAt: number
}

export interface StackManager {
  stacks: Record<string, StackEntry[]>
  activeTab: string
  historyStack: StackEntry[]
  currentFullPath: string
  currentPath: string
  query: Record<string, string>
  params: Record<string, string>
  allComponents: CachedComponent[]
  currentStack: CachedComponent[]
  flatRoutes: FlatRouteRecord[]
  createEntry: (fullPath: string, params?: Record<string, string>) => StackEntry
  updateAllComponents: () => void
  syncUrl: (fullPath: string) => void
  switchTab: (tab: string) => void
  /** 更新当前栈顶条目的最近访问时间 */
  touchCurrent: () => void
}

export function createStackManager(
  tabs: string[],
  routes: Record<string, RouteConfig>,
  defaultTab: string,
): StackManager {
  const flatRoutes = flattenRoutes(routes)

  const stacks = ref<Record<string, StackEntry[]>>(
    Object.fromEntries(tabs.map(t => [t, []]))
  )
  const activeTab = ref(defaultTab)
  const historyStack = computed(() => stacks.value[activeTab.value])

  const currentFullPath = computed(() => {
    const stack = historyStack.value
    return stack.length ? stack[stack.length - 1].fullPath : ''
  })

  const currentPath = computed(() => {
    if (!currentFullPath.value) return ''
    return parseFullPath(currentFullPath.value).path
  })

  const query = computed(() => parseFullPath(currentFullPath.value).query)

  const params = computed(() => {
    const m = matchRoute(currentPath.value, flatRoutes)
    if (!m) return {}
    const result: Record<string, string> = {}
    Object.entries(m.params).forEach(([k, v]) => { result[k] = v.replace(/-/g, ' ') })
    return result
  })

  const allComponents = ref<CachedComponent[]>([])

  let _nextId = 0
  function createEntry(fullPath: string, params: Record<string, string> = {}): StackEntry {
    return { _id: _nextId++, fullPath, params, lastAccessAt: Date.now() }
  }

  const currentStack = computed(() => {
    const stack = stacks.value[activeTab.value]
    const result: CachedComponent[] = []

    for (const entry of stack) {
      const { path: routePath, query: entryQuery } = parseFullPath(entry.fullPath)
      const m = matchRoute(routePath, flatRoutes)
      if (!m) continue

      const key = m.route.component.toString()
      const comp = getCachedComponent(key)
      if (!comp) continue

      const props = m.route.props
        ? typeof m.route.props === 'function'
          ? m.route.props({ params: m.params, query: entryQuery })
          : m.route.props
        : {}

      result.push({ value: comp, path: routePath, props })
    }

    return result
  })

  function updateAllComponents() {
    const result: CachedComponent[] = []
    for (const stack of Object.values(stacks.value)) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const entry = stack[i]
        const { path: routePath, query: entryQuery } = parseFullPath(entry.fullPath)
        const m = matchRoute(routePath, flatRoutes)
        if (!m) continue

        const key = m.route.component.toString()
        const comp = getCachedComponent(key)
        if (!comp) continue

        const props = m.route.props
          ? typeof m.route.props === 'function'
            ? m.route.props({ params: m.params, query: entryQuery })
            : m.route.props
          : {}

        result.push({ value: comp, path: routePath, props })
      }
    }
    allComponents.value = result
  }

  function syncUrl(fullPath: string) {
    window.history.replaceState(null, '', fullPath)
  }

  function switchTab(tab: string) {
    if (!tabs.includes(tab)) return
    activeTab.value = tab

    const stack = stacks.value[tab]
    if (!stack.length) {
      // tab 名与 URL 无关：空栈时用该 tab 的真实根路径（由 routes 推导）
      const rootPath = getTabRootPath(flatRoutes, tab)
      stack.push(createEntry(rootPath ?? '/'))
    }

    syncUrl(stack[stack.length - 1].fullPath)
    updateAllComponents()
  }

  function touchCurrent() {
    const stack = stacks.value[activeTab.value]
    if (stack.length > 0) {
      stack[stack.length - 1].lastAccessAt = Date.now()
    }
  }

  return reactive({
    stacks,
    activeTab,
    historyStack,
    currentFullPath,
    currentPath,
    query,
    params,
    allComponents,
    currentStack,
    flatRoutes,
    createEntry,
    updateAllComponents,
    syncUrl,
    switchTab,
    touchCurrent,
  })
}
