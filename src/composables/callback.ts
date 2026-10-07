/* =============================
   回调管理
============================= */

export function createCallbackManager() {
  const openCallbacks: (() => void)[] = []
  const backCallbacks: (() => void)[] = []
  const switchCallbacks: (() => void)[] = []
  const navCallbacks: ((isCurrent: boolean) => void)[] = []

  function onOpen(callback: () => void) {
    openCallbacks.push(callback)
  }

  function onBack(callback: () => void) {
    backCallbacks.push(callback)
  }

  function onSwitch(callback: () => void) {
    switchCallbacks.push(callback)
  }

  function onNav(callback: (isCurrent: boolean) => void) {
    navCallbacks.push(callback)
  }

  function triggerOpenCallbacks() {
    openCallbacks.forEach(cb => cb())
  }

  function triggerBackCallbacks() {
    backCallbacks.forEach(cb => cb())
  }

  function triggerSwitchCallbacks() {
    switchCallbacks.forEach(cb => cb())
  }

  function triggerNavCallbacks(isCurrent: boolean) {
    navCallbacks.forEach(cb => cb(isCurrent))
  }

  return {
    onOpen,
    onBack,
    onSwitch,
    onNav,
    triggerOpenCallbacks,
    triggerBackCallbacks,
    triggerSwitchCallbacks,
    triggerNavCallbacks,
  }
}

export type CallbackManager = ReturnType<typeof createCallbackManager>
