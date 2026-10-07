// 通用防抖函数
export function debounce(fn, delay) {
    let timer;
    return function (...args) {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => {
            fn.apply(this, args);
            timer = undefined;
        }, delay);
    };
}
// 通用节流函数
export function throttle(fn, interval) {
    let timer;
    return function (...args) {
        if (!timer) {
            timer = setTimeout(() => timer = undefined, interval);
            fn.apply(this, args);
        }
    };
}
// 观察 DOM
export function watchRef(elementRef, callback, immediate) {
    if (!elementRef.value) {
        return () => { };
    }
    if (immediate)
        callback({
            width: elementRef.value.offsetWidth,
            height: elementRef.value.offsetHeight
        });
    const observer = new ResizeObserver(() => {
        if (elementRef.value) {
            callback({
                width: elementRef.value.offsetWidth,
                height: elementRef.value.offsetHeight
            });
        }
    });
    observer.observe(elementRef.value);
    return () => observer.disconnect();
}
