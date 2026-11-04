"use client"

import * as React from "react"

/** Carrega dados assíncronos com estados de loading/erro e recarga manual. */
export function useLoad<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [state, setState] = React.useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [tick, setTick] = React.useState(0)
  const ref = React.useRef(fn)
  ref.current = fn
  React.useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    ref.current().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (e: unknown) => alive && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    )
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  return { ...state, reload: () => setTick((t) => t + 1) }
}
