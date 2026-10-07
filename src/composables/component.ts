import { markRaw } from 'vue'

// 组件缓存
const componentCache = new Map<string, any>()

export async function resolveComponent(component: any | (() => Promise<any>)) {
  if (typeof component === 'function') {
    const key = component.toString()
    if (componentCache.has(key)) return componentCache.get(key)
    const mod = await component()
    const resolved = markRaw(mod.default || mod)
    componentCache.set(key, resolved)
    return resolved
  }
  return markRaw(component)
}

export function getCachedComponent(key: string): any | undefined {
  return componentCache.get(key)
}

export function hasCachedComponent(key: string): boolean {
  return componentCache.has(key)
}
