import { ref, computed, watch, reactive, nextTick } from 'vue'
import RouterView from './RouterView.vue'
import { throttle } from '@/utils/common'
import { parseFullPath, buildFullPath, normalizePath } from '@/composables/path'
import { resolveComponent, getCachedComponent, hasCachedComponent } from '@/composables/component'
import { matchRoute, flattenRoutes, getTabRootPath } from '@/composables/route'
import { createCallbackManager } from '@/composables/callback'
import { createStackManager, type StackEntry } from '@/composables/stack'

/* =============================
   类型定义
============================= */

export interface RouteConfig {
  path: string
  component: any | (() => Promise<any>)
  props?: ((route: { params: Record<string, string>, query: Record<string, string> }) => Record<string, any>) | Record<string, any>
  children?: RouteConfig[]
}

export interface RouteLocation {
  path: string
  query?: Record<string, any>
}

export interface MultiHistoryOptions {
  tabs: string[]
  defaultTab?: string
  limit?: number
  routes: Record<string, RouteConfig>
}

export interface CachedComponent {
  value: any
  path: string
  props: Record<string, any>
}

/** 内部使用的 provide key（Symbol，与用户完全隔离） */
export const ROUTER_KEY = Symbol('router')
export const BACK_NOW_KEY = Symbol('backNow')
export const ON_OPEN_KEY = Symbol('onOpen')
export const ON_BACK_KEY = Symbol('onBack')
export const ON_NAV_KEY = Symbol('onNav')

/** 多栈路由实例 */
export interface HistoryStack {
  /** 当前激活的标签页名称 */
  readonly activeTab: string
  /** 当前路由路径 */
  readonly currentPath: string
  /** 所有标签页的组件栈（key 为标签页名称） */
  readonly stacks: Record<string, CachedComponent[]>
  /** 所有已渲染的组件列表（用于 RouterView 渲染） */
  readonly allComponents: CachedComponent[]
  /** 当前标签页的组件栈 */
  readonly currentStack: CachedComponent[]
  /** 当前路由的路径参数 */
  readonly params: Record<string, string>
  /** 当前路由的查询参数 */
  readonly query: Record<string, string>

  /** 切换到指定标签页（支持懒加载） */
  switchTab(tab: string): Promise<void>
  /** 打开新页面（支持懒加载） */
  open(path: string | RouteLocation): Promise<void>
  /** 返回上一页（带动画延迟） */
  back(): void
  /** 在当前标签页栈内导航到指定路径 */
  nav(path: string | RouteLocation): boolean
  /** 设置当前路由的查询参数 */
  setQuery(query: Record<string, any>): void
  /** 安装到 Vue 应用（app 用 any：插件安装点应兼容任意 Vue 副本传入，避免 npm link 双份 vue 导致的类型递归比较失败） */
  install(app: any): void
}

/* =============================
   工具函数
============================= */

/** 根据路径匹配路由，返回对应的 component 工厂函数 */
function findComponentByPath(pathWithoutQuery: string, flatRoutes: ReturnType<typeof flattenRoutes>) {
  const m = matchRoute(pathWithoutQuery, flatRoutes)
  return m ? m.route.component : null
}

/* =============================
   View Transitions（switchTab / nav 淡入淡出）
============================= */

/**
 * 用 startViewTransition 包裹一次状态变更：
 * - 旧状态捕获发生在下一帧，因此必须先把变更放进 update callback 执行，
 *   不能在调用前就改掉 DOM，否则旧快照会拍到新页面。
 * - 仅 RouterView 参与过渡：其根元素带 view-transition-name，
 *   其余页面元素通过 CSS（root 动画禁用）保持静止。
 * - 浏览器不支持时同步执行 apply() 作为兜底。
 */
function withFadeTransition(apply: () => void): Promise<void> {
  if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
    try {
      const transition = document.startViewTransition(async () => {
        apply()
        await nextTick()
      })
      // 等待 DOM 变更完成即可（updateCallbackDone），无需等待动画结束
      return Promise.resolve(transition.updateCallbackDone).catch(() => undefined)
    } catch {
      // 异常时走同步兜底
    }
  }
  apply()
  return Promise.resolve()
}

/* =============================
   核心工厂函数
============================= */

export default function createAppRouter(options: MultiHistoryOptions): HistoryStack {
  const { tabs, routes, defaultTab = tabs[0], limit } = options

  // ========== 子模块初始化 ==========
  const callback = createCallbackManager()
  const stack = createStackManager(tabs, routes, defaultTab)

  // ========== 加载计数器 ==========
  const loadingCount = ref(0)

  function addLoading() {
    loadingCount.value++
  }

  function removeLoading() {
    if (loadingCount.value > 0) {
      loadingCount.value--
    }
  }

  // ========== 全局 limit 淘汰（LRU）==========
  function enforceLimit() {
    if (limit === undefined || limit <= 0) return

    // 先把当前栈顶标记为最近访问
    stack.touchCurrent()

    // 收集所有 tab 的所有条目
    const allEntries: { tab: string; entry: StackEntry }[] = []
    for (const tab of tabs) {
      for (const entry of stack.stacks[tab]) {
        allEntries.push({ tab, entry })
      }
    }

    if (allEntries.length <= limit) return

    // 按 lastAccessAt 升序排列（最久未访问的在前）
    allEntries.sort((a, b) => a.entry.lastAccessAt - b.entry.lastAccessAt)

    // 移除最久未访问的，直到 ≤ limit
    const toRemove = allEntries.slice(0, allEntries.length - limit)
    for (const { tab, entry } of toRemove) {
      const idx = stack.stacks[tab].findIndex(e => e._id === entry._id)
      if (idx !== -1) {
        stack.stacks[tab].splice(idx, 1)
      }
    }

    stack.updateAllComponents()
  }

  // ========== 初始化 ==========
  const rawFullPath = window.location.pathname + window.location.search
  const initialFullPath = rawFullPath.replace(/\s+/g, '-')
  const { path: initialPathWithoutQuery } = parseFullPath(initialFullPath)

  const hitRecord = stack.flatRoutes.find(r => r.regex.test(initialPathWithoutQuery))

  if (!hitRecord) {
    // tab 名与 URL 无关：用 defaultTab 的真实根路径（由 routes 推导），找不到则不强制改写地址栏
    const rootPath = getTabRootPath(stack.flatRoutes, defaultTab)
    if (rootPath) {
      stack.stacks[defaultTab] = [stack.createEntry(rootPath)]
      stack.activeTab = defaultTab
      stack.syncUrl(rootPath)
    }
  } else {
    const rootPath = getTabRootPath(stack.flatRoutes, hitRecord.tab) ?? hitRecord.fullPath
    const chain = [stack.createEntry(rootPath)]

    const normalizedInitial = parseFullPath(initialFullPath).path === rootPath
      ? rootPath
      : initialFullPath

    if (normalizedInitial !== rootPath) {
      chain.push(stack.createEntry(initialFullPath))
    }

    stack.stacks[hitRecord.tab] = chain
    stack.activeTab = hitRecord.tab
    stack.syncUrl(initialFullPath)
  }

  // 根据当前栈条目加载对应的组件（需要几个加载几个）
  ; (async () => {
    const factories: any[] = []
    const activeStack = stack.stacks[stack.activeTab]

    for (const entry of activeStack) {
      const { path: routePath } = parseFullPath(entry.fullPath)
      const factory = findComponentByPath(routePath, stack.flatRoutes)
      if (factory && !factories.includes(factory)) {
        factories.push(factory)
      }
    }

    if (factories.length > 0) {
      addLoading()
      await Promise.all(factories.map(f => resolveComponent(f)))
      stack.updateAllComponents()
      removeLoading()
    }
    enforceLimit()
  })()

  // 监听路径变化
  watch(() => stack.currentPath, () => {
    stack.updateAllComponents()
  }, { immediate: true })

  // ========== 防止并发 ==========
  let isOpening = false
  let isSwitchingTab = false

  // ========== 导航方法 ==========
  async function switchTab(tab: string): Promise<void> {
    if (isOpening || isSwitchingTab) {
      console.warn('[router.switchTab] 组件加载中，switchTab 已忽略:', tab)
      return
    }
    const entries = stack.stacks[tab]
    const isEmpty = entries.length === 0

    if (isEmpty) {
      // 空 tab：先确保根组件已缓存，再 open 条目
      // tab 名与 URL 无关：根路径由 routes 推导
      const rootPath = getTabRootPath(stack.flatRoutes, tab)
      if (!rootPath) return
      const rootFactory = findComponentByPath(rootPath, stack.flatRoutes)
      if (!rootFactory) return

      const key = rootFactory.toString()
      if (!hasCachedComponent(key)) {
        isSwitchingTab = true
        await resolveComponent(rootFactory)
        isSwitchingTab = false
        await commitSwitch(tab, rootPath)
        return
      }
      await commitSwitch(tab, rootPath)
      return
    }

    await commitSwitch(tab, undefined)
  }

  function commitSwitch(tab: string, rootPath?: string): Promise<void> {
    // 状态变更放进 View Transition 的 update callback 中执行，
    // 保证旧状态捕获时页面仍是旧 tab，动画期间仅 RouterView 淡入淡出
    return withFadeTransition(() => {
      if (rootPath) {
        // 空 tab 补位：手动推入根条目
        stack.stacks[tab].push(stack.createEntry(rootPath))
        stack.activeTab = tab
        stack.syncUrl(rootPath)
        stack.updateAllComponents()
      } else {
        stack.switchTab(tab)
      }
      stack.touchCurrent()
      callback.triggerSwitchCallbacks()
      enforceLimit()
    })
  }

  async function open(location: string | RouteLocation): Promise<void> {
    const path = typeof location === 'string' ? location : location.path
    const query = typeof location === 'string' ? undefined : location.query

    const tabRootPath = getTabRootPath(stack.flatRoutes, stack.activeTab) ?? '/'
    const normalizedPath = normalizePath(parseFullPath(path).path, tabRootPath, stack.currentPath)
    const pathWithoutQuery = normalizedPath

    const currentStack = stack.stacks[stack.activeTab]
    const exists = currentStack.some(e => parseFullPath(e.fullPath).path === pathWithoutQuery)

    if (exists) {
      console.warn('[router.open] 当前栈中已存在该路由，open 已忽略:', pathWithoutQuery)
      return
    }

    const rootPath = getTabRootPath(stack.flatRoutes, stack.activeTab)
    if (rootPath && pathWithoutQuery === rootPath) {
      stack.stacks[stack.activeTab].push(stack.createEntry(rootPath))
      stack.syncUrl(rootPath)
      stack.updateAllComponents()
      stack.touchCurrent()
      callback.triggerOpenCallbacks()
      enforceLimit()
      return
    }

    if (!matchRoute(pathWithoutQuery, stack.flatRoutes)) {
      console.warn('[router.open] 未匹配到路由:', pathWithoutQuery)
      return
    }

    // 检查组件是否已缓存
    const compFactory = findComponentByPath(pathWithoutQuery, stack.flatRoutes)
    if (!compFactory) return

    const key = compFactory.toString()
    if (hasCachedComponent(key)) {
      // 组件已缓存，立即入栈并触发 onOpen
      const fullPath = buildFullPath(normalizedPath, query)
      stack.stacks[stack.activeTab].push(stack.createEntry(fullPath))
      stack.syncUrl(fullPath)
      stack.updateAllComponents()
      stack.touchCurrent()
      callback.triggerOpenCallbacks()
      enforceLimit()
      return
    }

    // 组件未缓存，需要先下载再入栈
    if (isOpening) {
      console.warn('[router.open] 组件加载中，open 已忽略')
      return
    }
    isOpening = true

    addLoading()
    await resolveComponent(compFactory)
    removeLoading()
    isOpening = false

    // 组件下载完成后，再入栈、触发动画、更新视图、触发 onOpen
    const fullPath = buildFullPath(normalizedPath, query)
    stack.stacks[stack.activeTab].push(stack.createEntry(fullPath))
    stack.syncUrl(fullPath)
    stack.updateAllComponents()
    stack.touchCurrent()
    callback.triggerOpenCallbacks()
    enforceLimit()
  }

  function back(): void {
    if (isOpening) {
      console.warn('[router.back] 组件加载中，back 已忽略')
      return
    }
    const currentStack = stack.stacks[stack.activeTab]
    if (currentStack.length <= 1) return

    callback.triggerBackCallbacks()

    // 立即异步加载 back 后栈顶的组件，加载完尽快显示
    const targetEntry = currentStack[currentStack.length - 2]
    if (targetEntry) {
      const { path: routePath } = parseFullPath(targetEntry.fullPath)
      const m = matchRoute(routePath, stack.flatRoutes)
      if (m) {
        const compFactory = m.route.component
        const key = compFactory.toString()
        if (!hasCachedComponent(key)) {
          resolveComponent(compFactory).then(() => {
            stack.updateAllComponents()
          })
        }
      }
    }

    setTimeout(() => {
      currentStack.pop()
      stack.syncUrl(currentStack[currentStack.length - 1].fullPath)
      stack.updateAllComponents()
      stack.touchCurrent()
    }, 300)
  }

  const saveBack = throttle(back, 300)

  function backNow(): void {
    if (isOpening) {
      console.warn('[router.backNow] 组件加载中，backNow 已忽略')
      return
    }
    const currentStack = stack.stacks[stack.activeTab]
    if (currentStack.length <= 1) return
    currentStack.pop()
    stack.syncUrl(currentStack[currentStack.length - 1].fullPath)
    stack.updateAllComponents()
  }

  function nav(location: string | RouteLocation): boolean {
    if (isOpening) {
      console.warn('[router.nav] 组件加载中，nav 已忽略')
      return false
    }
    const path = typeof location === 'string' ? location : location.path
    const query = typeof location === 'string' ? undefined : location.query

    const tabRootPath = getTabRootPath(stack.flatRoutes, stack.activeTab) ?? '/'
    const targetPathWithoutQuery = normalizePath(parseFullPath(path).path, tabRootPath, stack.currentPath)
    const activeTab = stack.activeTab
    const currentStack = stack.stacks[activeTab]

    const index = currentStack.findIndex(e => parseFullPath(e.fullPath).path === targetPathWithoutQuery)
    if (index === -1) {
      console.warn('[router.nav] 路径不在当前标签页历史中:', targetPathWithoutQuery)
      return false
    }

    const isCurrent = index === currentStack.length - 1

    // 状态变更放进 View Transition 的 update callback 中执行（约一帧内完成），
    // 保证旧状态捕获时页面仍是旧内容
    withFadeTransition(() => {
      stack.stacks[activeTab] = currentStack.slice(0, index + 1)

      if (query) {
        const targetEntry = stack.stacks[activeTab][stack.stacks[activeTab].length - 1]
        const { path: targetPath } = parseFullPath(targetEntry.fullPath)
        targetEntry.fullPath = buildFullPath(targetPath, query)
      }

      const targetEntry = stack.stacks[activeTab][stack.stacks[activeTab].length - 1]
      stack.syncUrl(targetEntry.fullPath)
      stack.updateAllComponents()
      stack.touchCurrent()

      callback.triggerNavCallbacks(isCurrent)
    })

    return true
  }

  function setQuery(newQuery: Record<string, any>): void {
    if (isOpening) {
      console.warn('[router.setQuery] 组件加载中，setQuery 已忽略')
      return
    }
    const currentStack = stack.stacks[stack.activeTab]
    if (!currentStack.length) return

    const current = currentStack[currentStack.length - 1]
    const { path } = parseFullPath(current.fullPath)
    const fullPath = buildFullPath(path, newQuery)

    current.fullPath = fullPath
    stack.syncUrl(fullPath)
    stack.updateAllComponents()
  }

  // ========== 构建每个 tab 对应的 CachedComponent 栈 ==========
  function buildStackByTab(): Record<string, CachedComponent[]> {
    const result: Record<string, CachedComponent[]> = {}
    for (const tab of tabs) {
      const entries = stack.stacks[tab] || []
      const components: CachedComponent[] = []
      for (const entry of entries) {
        const { path: routePath, query: entryQuery } = parseFullPath(entry.fullPath)
        const m = matchRoute(routePath, stack.flatRoutes)
        if (!m) continue

        const key = m.route.component.toString()
        const comp = getCachedComponent(key)
        if (!comp) continue

        const props = m.route.props
          ? typeof m.route.props === 'function'
            ? m.route.props({ params: m.params, query: entryQuery })
            : m.route.props
          : {}

        components.push({ value: comp, path: routePath, props })
      }
      result[tab] = components
    }
    return result
  }

  const componentsByTab = ref(buildStackByTab())

  // 在 updateAllComponents 之后同步更新 componentsByTab
  const originalUpdateAllComponents = stack.updateAllComponents
  stack.updateAllComponents = function () {
    originalUpdateAllComponents()
    componentsByTab.value = buildStackByTab()
  }

  // ========== 返回路由器对象 ==========
  const router = reactive({
    activeTab: computed(() => stack.activeTab),
    currentPath: computed(() => stack.currentPath),
    stacks: componentsByTab,
    allComponents: computed(() => stack.allComponents),
    currentStack: computed(() => stack.currentStack),
    params: computed(() => stack.params),
    query: computed(() => stack.query),
    switchTab,
    open,
    back: saveBack,
    nav,
    setQuery,

    install(app: any) {
      app.provide(ROUTER_KEY, this)
      app.provide(BACK_NOW_KEY, backNow)
      app.provide(ON_OPEN_KEY, callback.onOpen)
      app.provide(ON_BACK_KEY, callback.onBack)
      app.provide(ON_NAV_KEY, callback.onNav)
      app.component('RouterView', RouterView)
    }
  })

  return router
}
