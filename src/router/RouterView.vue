<script setup lang="ts">
import { computed, inject, nextTick, onUnmounted, ref, watch } from 'vue'

import { checkHorizontalScroll } from '@/utils/checkScroll'
import { HistoryStack, ROUTER_KEY, BACK_NOW_KEY, ON_OPEN_KEY, ON_BACK_KEY, ON_NAV_KEY, type CachedComponent } from '@/router/createAppRouter';

const router = inject(ROUTER_KEY) as HistoryStack
const backNow = inject(BACK_NOW_KEY) as () => void
const onOpen = inject(ON_OPEN_KEY) as (callback: () => void) => void
const onBack = inject(ON_BACK_KEY) as (callback: () => void) => void
const onNav = inject(ON_NAV_KEY) as (callback: (isCurrent: boolean) => void) => void

// 动画期间保持标准流宽度：绝对定位会脱离文档流导致宽度收缩，
// 所以在绝对定位生效前测量各页面原始宽度，动画期间用固定宽度渲染
const originalWidths = ref<Record<string, number>>({})
const componentEls = new Map<string, HTMLElement>()

// 收集每个 path 对应的 DOM 根元素（v-for 函数 ref）
function collectRef(el: unknown, component: CachedComponent) {
  const root = (el as any)?.$el ?? el
  if (root instanceof HTMLElement) {
    componentEls.set(component.path, root)
  } else {
    componentEls.delete(component.path)
  }
}

// 元素仍处于标准流时测量宽度（必须在绝对定位生效前调用）
function measureWidth(path: string) {
  const el = componentEls.get(path)
  if (el) originalWidths.value[path] = el.offsetWidth
}

// 加入页面
const isOpening = ref<boolean>(false)
onOpen(async () => {
  // 等待，导致旧组件消失，页面置顶
  await nextTick()
  measureWidth(router.currentPath)
  isOpening.value = true
  // 等旧组件重新显示后，还原被置顶的滚动位置
  await nextTick()
  document.documentElement.scrollTop = scrollPositions.value[bottomPath.value!]
})

// Back 以移除页面
onBack(() => {
  // 当前页面仍是标准流，同步测量即可
  measureWidth(router.currentPath)
  isLeaving.value = true
  setTimeout(() => {
    isLeaving.value = false
  }, 300)
})

// 右滑返回手势
const enableScroll = computed(() => router.currentStack.length > 1)
const scroll = checkHorizontalScroll(document, 10, enableScroll, 300)
const isReturning = ref<boolean>(false)
const isLeaving = ref<boolean>(false)
const isBacking = computed<boolean>(() => (scroll.isTouching || isReturning.value || isLeaving.value))
watch(() => scroll.isTouching, (newTouching) => {
  if (newTouching) return
  if (scroll.speed > 0.1 || (scroll.distance > 200 && scroll.speed > -0.1)) {
    isLeaving.value = true
    setTimeout(() => {
      backNow()
      isLeaving.value = false
    }, 300)
  } else {
    isReturning.value = true
    setTimeout(() => isReturning.value = false, 300)
  }
})
onUnmounted(() => {
  scroll.cleanup()
})

// 恢复页面滚动位置
const scrollPositions = ref<Record<string, number>>({})
const isAnimating = computed<boolean>(() => isOpening.value || isBacking.value)
const bottomPath = computed<string | undefined>(() => router.currentStack.length - 2 >= 0 ? router.currentStack[router.currentStack.length - 2].path : undefined)
// 前进时恢复
onOpen(() => {
  if (!bottomPath.value) return
  scrollPositions.value[bottomPath.value] = document.documentElement.scrollTop
  scrollPositions.value[router.currentPath] = 0
  setTimeout(() => {
    document.documentElement.scrollTop = 0
  }, 300)
})
// 后退时恢复
onBack(async () => {
  scrollPositions.value[router.currentPath] = document.documentElement.scrollTop
  await nextTick()
  document.documentElement.scrollTop = scrollPositions.value[bottomPath.value as string] ?? 0
})
// 导航时恢复
onNav(async (isCurrent: boolean) => {
  if (isCurrent) return
  await nextTick()
  document.documentElement.scrollTop = scrollPositions.value[router.currentPath] ?? 0
})
// 切换标签页时恢复
watch(() => router.activeTab, async (_, oldTab) => {
  const oldStack = router.stacks[oldTab]
  if (oldStack && oldStack.length > 0) {
    scrollPositions.value[oldStack[oldStack.length - 1].path] = document.documentElement.scrollTop
  }
  await nextTick()
  document.documentElement.scrollTop = scrollPositions.value[router.currentPath] ?? 0
})
// 手指开始触摸和结束触摸时恢复
watch(() => scroll.isTouching, async (newTouching) => {
  if (newTouching) {
    measureWidth(router.currentPath)
    scrollPositions.value[router.currentPath] = document.documentElement.scrollTop
    await nextTick()
    document.documentElement.scrollTop = scrollPositions.value[bottomPath.value as string] ?? 0
    isOpening.value = false
  } else {
    if (isLeaving.value) return
    await nextTick()
    setTimeout(() => document.documentElement.scrollTop = scrollPositions.value[router.currentPath] || 0, 300)
  }
})

// 滚动位置补偿
const scrollPositionDiff = computed<number>(() => (scrollPositions.value[bottomPath.value as string] ?? 0) - (scrollPositions.value[router.currentPath] ?? 0))
</script>

<template>
  <div :class="$style.RouterView">
    <component v-for="component in router.allComponents" :is="component.value" v-bind="component.props"
      :key="component.path" :ref="(el: any) => collectRef(el, component)"
      v-show="component.path === router.currentPath || (isAnimating && component.path === bottomPath)" :style="component.path === router.currentPath && component.path !== router.currentStack[0].path && isAnimating ? {
        position: 'absolute',
        width: originalWidths[component.path] != null ? `${originalWidths[component.path]}px` : '',
        zIndex: 'var(--animating-z-index)',
        boxShadow: '0 0 20px 0 rgba(0, 0, 0, .1)',
        transform: scroll.isTouching ? `translate(${scroll.distance}px, ${scrollPositionDiff}px)` : isReturning ? `translate(0, ${scrollPositionDiff}px)` : isLeaving ? `translate(100dvw, ${scrollPositionDiff}px)` : '',
        transition: !scroll.isTouching && (isReturning || isLeaving) ? 'transform .3s' : 'none',
      } : undefined" :class="{ [$style.openAnimation]: isOpening && component.path === router.currentPath }"
      @animationend="() => isOpening = false" />
  </div>
</template>

<style module>
.RouterView {
  position: relative;
  z-index: 0;
  view-transition-name: router-view;
  --animating-z-index: 1;
}

@keyframes push {
  from {
    transform: translateX(100dvw);
  }

  to {
    transform: translateX(0);
  }
}

.openAnimation {
  animation: push .3s;
}
</style>

<style>
::view-transition-group(router-view) {
  animation: none;
}

::view-transition-old(router-view),
::view-transition-new(router-view) {
  animation-duration: 0.2s;
}

::view-transition-old(root),
::view-transition-new(root) {
  animation: none;
}
</style>