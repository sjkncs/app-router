# @lovelymai/app-router

一个专为希望模拟原生 App 的 Web 应用设计的 Vue 3 多堆栈路由器，致力于提供**类原生应用的页面导航体验**。

### 核心特性

- **轻量级** — 零依赖
- **类原生体验** — 多标签独立路由栈，每个标签拥有自己的页面历史堆栈，切换标签时保留页面状态
- **无缝切换** — 标签切换不丢失滚动位置或组件状态，消除传统 Web 路由器的页面重绘
- **全局滑动返回** — 提供全局滑动返回手势动画，带来完全复刻原生应用的体验
- **组件即用即载** — 只加载当前需要显示的组件，其他标签页的根组件在首次切换到该标签时才加载，首屏更快
- **全局容量限制** — 可设置 `limit` 控制整个路由系统同时缓存的最大组件数量，超出时自动淘汰最早访问的页面
- **懒加载** — 基于 Vue 3 的组件懒加载，按需加载页面

## 安装

```bash
npm install @lovelymai/app-router
```

## 快速开始

### 1. 创建路由器实例

```ts
import createAppRouter from '@lovelymai/app-router'

const tabs = ['recommendation', 'product', 'shopping-bag']

const routes = {
  [tabs[0]]: {
    path: tabs[0],
    component: () => import('./pages/recommendation/index.vue'),
  },
  [tabs[1]]: {
    path: tabs[1],
    component: () => import('./pages/product/index.vue'),
    children: [
      {
        path: 'category/:name',
        component: () => import('./pages/product/category/index.vue'),
      },
      {
        path: 'detail/:name',
        component: () => import('./pages/product/detail/index.vue'),
      },
    ],
  },
  [tabs[2]]: {
    path: tabs[2],
    component: () => import('./pages/shopping-bag/index.vue'),
  },
}

const router = createAppRouter({
  tabs,
  defaultTab: tabs[0],
  routes,
  limit: 10, // 可选，全局最多缓存 10 个页面组件
})

export default router
```

### 2. 安装到 Vue 应用

```ts
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

// 导入样式
import '@lovelymai/app-router/dist/app-router.css'

createApp(App).use(router).mount('#app')
```

### 3. 在组件中使用

```vue
<script setup lang="ts">
import router from './router'

const tabs = ['recommendation', 'product', 'shopping-bag']

const onTabClick = (_item: any, index: number) => {
  if (tabs[index] === router.activeTab) {
    router.nav(`/${tabs[index]}`)
  }
  router.switchTab(tabs[index])
}
</script>

<template>
  <router-view />
</template>
```

## 工作原理

### 初始化加载

初始化时**只加载 URL 当前路径对应的组件**，不预加载所有标签页的根组件：

| URL | 栈内容 | 加载的组件 |
|-----|--------|-----------|
| `/recommendation` | `[{/recommendation}]` | 推荐页组件 |
| `/product/detail/foo` | `[{/product}, {/product/detail/foo}]` | 商品页 + 详情页组件 |

其他标签页（如 `shopping-bag`）的栈为空，切换到该标签时才首次加载其根组件。

### 弹出时预加载

`back()` 触发后退动画（300ms）的**同时**，立即异步加载目标页面的组件。如果已缓存则无缝显示，未缓存则在加载完成后即时渲染。

### 容量限制

`limit` 控制**所有标签页的栈条目总数**。每次新增条目时检查，超出则淘汰全局最早入栈的条目（根页面不例外），确保内存可控。

## API

### `createAppRouter(options)`

创建一个路由器实例。

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|-----------|------|----------|-------------|
| `tabs` | `string[]` | 是 | 标签页列表，每个标签对应一个路由堆栈 |
| `defaultTab` | `string` | 否 | 默认激活的标签页，默认 `tabs[0]` |
| `limit` | `number` | 否 | 全局最大组件缓存数量，超出时淘汰最早入栈的页面 |
| `routes` | `Record<string, RouteConfig>` | 是 | 路由配置，键为标签页名称 |

#### RouteConfig

| 属性 | 类型 | 必填 | 说明 |
|----------|------|----------|-------------|
| `path` | `string` | 是 | 路由路径。**以 `/` 开头为绝对路径**（忽略父路由路径，直接作为匹配路径）；**不带 `/` 或写 `./` 为相对路径**，基于父路由路径拼接（支持 `..` 返回上级）。`open()`/`nav()` 调用时遵循相同规则 |
| `component` | `any \| (() => Promise<any>)` | 是 | 路由组件（支持懒加载） |
| `props` | `((route: { params: Record<string, string>, query: Record<string, string> }) => Record<string, any>) \| Record<string, any>` | 否 | 路由组件的 Props |
| `children` | `RouteConfig[]` | 否 | 子路由配置 |

### 路由器实例方法

| 方法 | 说明 |
|--------|-------------|
| `router.switchTab(tab)` | 切换到指定的标签页，首次切换时自动加载根组件 |
| `router.open(path \| RouteLocation)` | 打开新页面（支持懒加载） |
| `router.back()` | 返回上一页（带动画延迟，其间预加载目标页组件） |
| `router.nav(path \| RouteLocation)` | 在当前标签堆栈中导航到指定路径 |
| `router.setQuery(query)` | 设置当前路由的查询参数 |

### 路由器实例属性

| 属性 | 类型 | 说明 |
|----------|------|-------------|
| `router.activeTab` | `string` | 当前激活的标签页名称 |
| `router.currentPath` | `string` | 当前路由路径 |
| `router.stacks` | `Record<string, CachedComponent[]>` | 所有标签页的组件堆栈 |
| `router.allComponents` | `CachedComponent[]` | 所有已渲染的组件列表（RouterView 数据源） |
| `router.currentStack` | `CachedComponent[]` | 当前标签页的组件堆栈 |
| `router.params` | `Record<string, string>` | 当前路由的路径参数 |
| `router.query` | `Record<string, string>` | 当前路由的查询参数 |

## 样式

```css
/* 在 main.ts 中导入 */
import '@lovelymai/app-router/dist/app-router.css'
```

### CSS 变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `--router-animating-z-index` | `1` | 页面动画期间的 z-index |