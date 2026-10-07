// 通用防抖函数
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: number | undefined
  return function (this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn.apply(this, args)
      timer = undefined
    }, delay)
  }
}

// 通用节流函数
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  interval: number
): (...args: Parameters<T>) => void {
  let timer: number | undefined
  return function (this: any, ...args: Parameters<T>) {
    if (!timer) {
      timer = setTimeout(() => timer = undefined, interval)
      fn.apply(this, args)
    }
  }
}

// 观察 DOM
export function watchRef(
  elementRef: { value: HTMLElement | null },
  callback: (size: { width: number; height: number }) => void,
  immediate: boolean
): () => void {
  if (!elementRef.value) {
    return () => { }
  }

  if (immediate) callback({
    width: elementRef.value.offsetWidth,
    height: elementRef.value.offsetHeight
  })

  const observer = new ResizeObserver(() => {
    if (elementRef.value) {
      callback({
        width: elementRef.value.offsetWidth,
        height: elementRef.value.offsetHeight
      })
    }
  })

  observer.observe(elementRef.value)

  return () => observer.disconnect()
}

