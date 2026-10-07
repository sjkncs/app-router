import { reactive, ref, type ComputedRef, type Ref } from 'vue';

/**
 * 检测右滑返回手势
 * @param el 目标元素，可以是 Document 或 HTMLElement（从 ref.value 传入）
 * @param threshold 阈值(px)，只有手指右滑超过这个距离才开始触发
 * @param enabled 是否启用检测，传入 Ref<boolean> 或 ComputedRef<boolean>
 * @param lockTime 锁定时间(ms)，手势结束后多久内不再响应，默认 300
 * @returns reactive 对象，包含 cleanup 函数和实时更新的 distance, speed
 */
export function checkHorizontalScroll(
  el: Document | HTMLElement,
  threshold: number,
  enabled: Ref<boolean> | ComputedRef<boolean>,
  lockTime: number = 300
) {
  const distance = ref<number>(0)
  const speed = ref<number>(0)
  const isTouching = ref(false)

  // 添加锁状态
  let isLocked = false
  let lockTimer: ReturnType<typeof setTimeout> | null = null

  let startX = 0;
  let startY = 0;
  let isTracking = false;
  let isThresholdPassed = false;
  let accumulatedDistance = 0;
  let isIgnored = false;  // 是否已标记为忽略（垂直分量过大）
  let lastX = 0;  // 记录上一次触摸点的X坐标
  let lastTime = 0;  // 记录上一次触摸的时间戳
  let lastSpeed = 0;  // 记录最后一次计算的速度值
  let scrollableElement: Element | null = null; // 新增：找到的可滚动元素

  // rAF 节流
  let rafId: number | null = null
  let pendingDistance = 0
  let pendingSpeed = 0

  // 检测元素是否可以横向滚动
  function isHorizontallyScrollable(element: Element): boolean {
    const style = window.getComputedStyle(element);
    const overflowX = style.overflowX;

    // 检查是否有横向滚动条
    const hasHorizontalScrollbar = element.scrollWidth > element.clientWidth;

    // 检查是否允许横向滚动
    const canScrollHorizontally = overflowX === 'auto' || overflowX === 'scroll';

    return hasHorizontalScrollbar && canScrollHorizontally;
  }

  // 向上查找可横向滚动的父元素
  function findHorizontallyScrollableParent(element: Element | null): Element | null {
    while (element && element !== document.documentElement) {
      if (isHorizontallyScrollable(element)) {
        return element;
      }
      element = element.parentElement;
    }
    return null;
  }

  const handleTouchStart = (e: TouchEvent) => {
    if (!enabled.value) return;

    // 如果处于锁定状态，直接返回
    if (isLocked) return;

    // 只在第一个触摸点开始跟踪
    if (e.touches.length !== 1) return;

    const target = e.target as Element;

    // 检查当前元素或父元素是否可横向滚动
    scrollableElement = findHorizontallyScrollableParent(target);

    if (scrollableElement) {
      // 正常初始化，我们要跟踪它
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isTracking = true;
      isThresholdPassed = false;
      accumulatedDistance = 0;
      isIgnored = false;
      lastX = 0;
      lastTime = 0;
    } else {
      // 没有可滚动元素，正常初始化
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isTracking = true;
      isThresholdPassed = false;
      accumulatedDistance = 0;
      isIgnored = false;
      lastX = 0;
      lastTime = 0;
      scrollableElement = null;
    }
  };

  // rAF 驱动的更新，避免频繁触发 Vue 响应式
  function flushReactiveUpdate() {
    rafId = null
    distance.value = pendingDistance
    speed.value = pendingSpeed
  }

  function scheduleReactiveUpdate() {
    pendingDistance = accumulatedDistance
    pendingSpeed = lastSpeed
    if (rafId === null) {
      rafId = requestAnimationFrame(flushReactiveUpdate)
    }
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!enabled.value) return;

    // 如果处于锁定状态，直接返回
    if (isLocked) return;

    if (!isTracking || e.touches.length !== 1) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;

    // 如果已标记为忽略，直接返回
    if (isIgnored) return;

    // 如果有可滚动元素，检查是否已经滚动到最左边
    if (scrollableElement) {
      // 如果还没到最左边，让浏览器处理滚动
      if (scrollableElement.scrollLeft > 0) {
        // 还在可滚动范围内，不触发手势
        return;
      }

      // 已经滚动到最左边，但如果是左滑，让浏览器处理（回弹效果）
      if (deltaX < 0) {
        return;
      }

      // 到最左边且右滑，开始手势检测
      // 这里继续执行下面的手势逻辑
    }

    // 在阈值范围内，检测垂直分量
    if (!isThresholdPassed) {
      // 垂直分量过大，标记为忽略（约30度）
      if (Math.abs(deltaY) > Math.abs(deltaX) * Math.tan(30 * Math.PI / 180)) {
        isIgnored = true;
        return;
      }

      // 左滑则忽略（已经在上面处理了可滚动元素的左滑）
      if (!scrollableElement && deltaX < 0) return;

      // 超过阈值，开始跟踪
      if (deltaX > threshold) {
        isThresholdPassed = true;
        accumulatedDistance = deltaX - threshold;

        e.preventDefault(); // 阻止默认滚动

        isTouching.value = true
        pendingDistance = accumulatedDistance
        pendingSpeed = 0
        scheduleReactiveUpdate()
      }
    } else {
      // 已超过阈值，计算连续距离（不允许为负）
      accumulatedDistance = Math.max(0, deltaX - threshold);

      // 阻止默认行为
      e.preventDefault();

      const currentTime = Date.now();
      // 如果是第一次超过阈值，使用当前值初始化lastX和lastTime
      if (lastX === 0 && lastTime === 0) {
        lastX = currentX;
        lastTime = currentTime;
        pendingDistance = accumulatedDistance
        pendingSpeed = 0
        scheduleReactiveUpdate()
        return;
      }
      const timeDiff = currentTime - lastTime;
      const s = timeDiff > 0 ? (currentX - lastX) / timeDiff : 0;
      lastSpeed = s;
      lastX = currentX;
      lastTime = currentTime;
      scheduleReactiveUpdate()
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (!enabled.value) return;

    // 如果已经超过阈值，阻止默认行为（如可能的点击事件）
    if (isThresholdPassed) {
      e.preventDefault();
    }

    if (!isThresholdPassed) {
      // 没有超过阈值，直接重置状态，不触发回调
      isTracking = false;
      isThresholdPassed = false;
      accumulatedDistance = 0;
      scrollableElement = null;
      return;
    }

    const finalDistance = accumulatedDistance;
    isTracking = false;
    isThresholdPassed = false;
    accumulatedDistance = 0;
    scrollableElement = null;

    // 取消待执行的 rAF，避免覆盖最终值
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }

    // 使用最后一次计算的速度值
    distance.value = finalDistance
    speed.value = lastSpeed
    isTouching.value = false

    // 设置锁定状态，300ms后解锁
    isLocked = true;
    if (lockTimer) {
      clearTimeout(lockTimer);
    }
    lockTimer = setTimeout(() => {
      isLocked = false;
      lockTimer = null;
    }, lockTime);
  };

  el.addEventListener('touchstart', handleTouchStart as EventListener, { passive: true });
  el.addEventListener('touchmove', handleTouchMove as EventListener, { passive: false });
  el.addEventListener('touchend', handleTouchEnd as EventListener, { passive: false });

  const cleanup = () => {
    el.removeEventListener('touchstart', handleTouchStart as EventListener);
    el.removeEventListener('touchmove', handleTouchMove as EventListener);
    el.removeEventListener('touchend', handleTouchEnd as EventListener);
    // 清理定时器
    if (lockTimer) {
      clearTimeout(lockTimer);
      lockTimer = null;
    }
  };

  return reactive({ cleanup, distance, speed, isTouching });
}